/**
 * simulator.js — Three.js scene, Cannon-es world, render loop
 *
 * Camera modes:
 *   'free'       — OrbitControls, user navigates freely (Blender-style)
 *   'drone-lock' — Camera FOLLOWS drone; offset is maintained so drone stays in frame
 */

'use strict';

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as CANNON from 'cannon-es';
import { Drone } from './drone.js';
import {
  DEFAULT_PARAMS, computeForces, getTurbulenceForce,
  generateWindGust, autoPIDOutputs, resetPID, resetTurbulence
} from './physics.js';

export class DroneSimulator {
  constructor(canvasContainer, onTelemetry) {
    this.container   = canvasContainer;
    this.onTelemetry = onTelemetry || (() => {});
    this.params      = { ...DEFAULT_PARAMS };

    this.cameraMode = 'free'; // 'free' | 'drone-lock'
    this.autoMode   = false;
    this.isRunning  = false;

    this.setpoint = {
      targetAlt: 1.0, targetRoll: 0, targetPitch: 0, targetYaw: 0,
      throttleCmd: null, rollCmd: 0, pitchCmd: 0, yawCmd: 0,
      holdX: undefined, holdZ: undefined,
    };

    // Wind state
    this.windForce     = { x: 0, y: 0, z: 0 };
    this.windGust      = null; // { force, duration, elapsed }
    this.turbulenceOn  = true;

    // User-provided motor function (from code editor)
    this.userMotorFn   = null;

    this._initRenderer();
    this._initScene();
    this._initPhysics();
    this._initDrone();
    this._initLights();
    this._initEnvironment();
    this._bindResize();

    this.clock = new THREE.Clock();
    this._loop();
    this.isRunning = true;
  }

  // ─── Renderer ─────────────────────────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.setClearColor(0x0a0e1a);

    this.container.appendChild(this.renderer.domElement);
    this._resize();
  }

  // ─── Scene ────────────────────────────────────────────────────────────────

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0e1a, 0.025);

    // Camera
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, w / h, 0.01, 500);
    this.camera.position.set(3, 2.5, 4);

    // Blender-style OrbitControls:
    //   Middle-mouse drag → orbit
    //   Shift+Middle       → pan
    //   Scroll            → zoom
    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.mouseButtons  = {
      LEFT:   null,           // disable left-drag orbit (left = nothing / selection later)
      MIDDLE: THREE.MOUSE.ROTATE,
      RIGHT:  THREE.MOUSE.PAN,
    };
    this.orbitControls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.orbitControls.zoomSpeed  = 1.2;
    this.orbitControls.panSpeed   = 0.8;
    this.orbitControls.target.set(0, 0.5, 0);
    this.orbitControls.update();

    // Drone-lock: store camera→target offset so camera moves WITH drone
    this._lockCamOffset = new THREE.Vector3(3, 2.5, 4); // will be updated on mode switch
  }

  // ─── Physics World ────────────────────────────────────────────────────────

  _initPhysics() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, -this.params.gravity, 0);
    this.world.broadphase = new CANNON.NaiveBroadphase();
    this.world.solver.iterations = 20;
    this.world.solver.tolerance  = 0.001;

    // Ground plane body (static, infinite)
    const groundBody = new CANNON.Body({
      mass: 0,
      shape: new CANNON.Plane(),
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

    // Register preStep ONCE here so it's always alive
    this._hasPreStepHandler = false;
  }

  // ─── Drone ────────────────────────────────────────────────────────────────

  _initDrone() {
    this.drone = new Drone(this.scene, this.world, this.params);
  }

  // ─── Lights ───────────────────────────────────────────────────────────────

  _initLights() {
    // Ambient
    const ambient = new THREE.AmbientLight(0x334466, 1.2);
    this.scene.add(ambient);

    // Hemisphere
    const hemi = new THREE.HemisphereLight(0x334466, 0x112233, 0.8);
    this.scene.add(hemi);

    // Main directional sun
    const sun = new THREE.DirectionalLight(0xffffff, 2.5);
    sun.position.set(10, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near   = 0.1;
    sun.shadow.camera.far    = 100;
    sun.shadow.camera.left   = -20;
    sun.shadow.camera.right  = 20;
    sun.shadow.camera.top    = 20;
    sun.shadow.camera.bottom = -20;
    sun.shadow.bias          = -0.001;
    this.scene.add(sun);

    // Subtle rim light
    const rim = new THREE.DirectionalLight(0x4477ff, 0.8);
    rim.position.set(-10, 5, -10);
    this.scene.add(rim);
  }

  // ─── Ground Environment ───────────────────────────────────────────────────

  _initEnvironment() {
    // ── Ground plane ──────────────────────────────────────────────────────
    const groundGeo = new THREE.PlaneGeometry(200, 200, 50, 50);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0d1b2a,
      roughness: 0.95,
      metalness: 0.1,
      wireframe: false,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // ── Grid helper ────────────────────────────────────────────────────────
    const gridHelper = new THREE.GridHelper(100, 100, 0x1a3a5c, 0x0f2540);
    gridHelper.position.y = 0.001;
    this.scene.add(gridHelper);

    // ── Axis indicators ────────────────────────────────────────────────────
    const axisHelper = new THREE.AxesHelper(1.0);
    axisHelper.position.y = 0.002;
    this.scene.add(axisHelper);

    // ── Distance circles ───────────────────────────────────────────────────
    [5, 10, 20, 50].forEach(r => {
      const points = [];
      for (let i = 0; i <= 64; i++) {
        const a = (i / 64) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * r, 0.003, Math.sin(a) * r));
      }
      const geo  = new THREE.BufferGeometry().setFromPoints(points);
      const mat  = new THREE.LineBasicMaterial({ color: 0x1a3a5c, opacity: 0.5, transparent: true });
      this.scene.add(new THREE.Line(geo, mat));
    });

    // ── Skybox ─────────────────────────────────────────────────────────────
    const skyGeo = new THREE.SphereGeometry(400, 16, 8);
    const skyMat = new THREE.MeshBasicMaterial({
      color: 0x060d1a, side: THREE.BackSide,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // ── Stars ──────────────────────────────────────────────────────────────
    const starGeo = new THREE.BufferGeometry();
    const starVerts = [];
    for (let i = 0; i < 3000; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 350 + Math.random() * 40;
      starVerts.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.sin(theta)
      );
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
    const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true });
    this.scene.add(new THREE.Points(starGeo, starMat));
  }

  // ─── Resize Handling ──────────────────────────────────────────────────────

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  _bindResize() {
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(this.container);
  }

  // ─── Main Loop ────────────────────────────────────────────────────────────

  _loop() {
    this._animId = requestAnimationFrame(() => this._loop());

    const rawDt = this.clock.getDelta();
    const dt    = Math.min(rawDt, 0.05); // cap at 50ms to avoid physics explosion

    // ── Physics step ──────────────────────────────────────────────────────
    if (!this._frameCount) this._frameCount = 0;
    this._frameCount++;
    this._physicsStep(dt, this._frameCount);

    // ── Camera update ──────────────────────────────────────────────────────
    if (this.cameraMode === 'drone-lock') {
      const dronePos = this.drone.getPosition();
      const droneVec = new THREE.Vector3(dronePos.x, dronePos.y, dronePos.z);

      // Move BOTH camera position and target together so the view stays locked
      const newTarget = droneVec.clone();
      const newCamPos = droneVec.clone().add(this._lockCamOffset);

      // Smoothly interpolate for a cinematic feel
      this.orbitControls.target.lerp(newTarget, 0.12);
      this.camera.position.lerp(newCamPos, 0.12);
    }
    this.orbitControls.update();

    // ── Render ────────────────────────────────────────────────────────────
    this.renderer.render(this.scene, this.camera);
  }

  _physicsStep(dt, frameCount) {
    const droneBody = this.drone.body;
    const pos = droneBody.position;
    const vel = droneBody.velocity;
    const angVel = droneBody.angularVelocity;
    const quat = droneBody.quaternion;
    const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w), 'YXZ');
    
    // Build state object (for user code and PID)
    const state = {
      altitude:    pos.y,
      roll:        -euler.z * (180 / Math.PI),  // + means roll right (right side down)
      pitch:       -euler.x * (180 / Math.PI),  // + means pitch down (nose down)
      yaw:         -euler.y * (180 / Math.PI),  // + means yaw CW (right)
      rollRate:    -angVel.z * (180 / Math.PI), // Roll is around Z axis
      pitchRate:   -angVel.x * (180 / Math.PI), // Pitch is around X axis
      yawRate:     -angVel.y * (180 / Math.PI), // Yaw is around Y axis
      vx: vel.x, vy: vel.y, vz: vel.z,
      posX: pos.x, posZ: pos.z,
      dt,
      // Stick commands — readable in Arduino loop()
      throttle:  this.setpoint.throttleCmd ?? 0,
      yawCmd:    this.setpoint.yawCmd      ?? 0,
      pitchCmd:  this.setpoint.pitchCmd    ?? 0,
      rollCmd:   this.setpoint.rollCmd     ?? 0,
    };

    // ── Determine motor PWM ────────────────────────────────────────────────
    let motorPWM = [0, 0, 0, 0];

    if (this.drone.isArmed) {
      if (this.autoMode) {
        // Yaw: rotate target heading at yawCmd rate
        this.setpoint.targetYaw += this.setpoint.yawCmd * 90 * dt; // +/- 90 deg/sec
        // Wrap target yaw to [-180, 180]
        if (this.setpoint.targetYaw > 180) this.setpoint.targetYaw -= 360;
        if (this.setpoint.targetYaw < -180) this.setpoint.targetYaw += 360;

        motorPWM = autoPIDOutputs(state, this.setpoint, this.params, dt);
      } else if (this.userMotorFn) {
        try {
          const result = this.userMotorFn(state);
          if (Array.isArray(result) && result.length === 4) {
            motorPWM = result.map(v => Math.max(0, Math.min(1, Number(v) || 0)));
          }
        } catch (e) {
          console.error("Flight controller error:", e);
        }
      } else {
        // Keyboard/joystick direct control via PID
        motorPWM = autoPIDOutputs(state, this.setpoint, this.params, dt);
      }
    }

    this.drone.motorPWM = motorPWM;

    // ── NaN guard — reset body if physics has diverged ────────────────────
    const p = droneBody.position;
    if (isNaN(p.x) || isNaN(p.y) || isNaN(p.z)) {
      console.warn('[Physics] NaN detected — resetting drone body');
      droneBody.position.set(0, 1, 0);
      droneBody.velocity.setZero();
      droneBody.angularVelocity.setZero();
      droneBody.quaternion.set(0, 0, 0, 1);
      droneBody.force.setZero();
      droneBody.torque.setZero();
    }

    // ── Wind gust ─────────────────────────────────────────────────────────
    if (this.windGust) {
      this.windGust.elapsed += dt;
      if (this.windGust.elapsed >= this.windGust.duration) {
        this.windGust = null;
        this.windForce = { x: 0, y: 0, z: 0 };
      } else {
        // Ease in/out
        const t = this.windGust.elapsed / this.windGust.duration;
        const env = 4 * t * (1 - t); // parabolic envelope
        this.windForce = {
          x: this.windGust.force.x * env,
          y: this.windGust.force.y * env,
          z: this.windGust.force.z * env,
        };
      }
    }

    // ── Turbulence ────────────────────────────────────────────────────────
    const turbulence = this.turbulenceOn && this.drone.isArmed
      ? getTurbulenceForce(this.params, dt)
      : { x: 0, y: 0, z: 0 };

    const totalWind = {
      x: this.windForce.x + turbulence.x,
      y: this.windForce.y + turbulence.y,
      z: this.windForce.z + turbulence.z,
    };

    // ── Pre-Step Physics Update (registered only ONCE) ────────────────────
    if (!this._hasPreStepHandler) {
      this.world.addEventListener('preStep', () => {
        if (!this.isRunning) return;
        
        const droneBody = this.drone.body;
        const vel = droneBody.velocity;
        const angVel = droneBody.angularVelocity;
        const quat = droneBody.quaternion;
        const pos = droneBody.position;

        const { force, torque } = computeForces(
          { velocity: vel, angularVelocity: angVel, quaternion: quat, position: pos },
          this.drone.motorPWM,
          this.params,
          this._currentWind || { x: 0, y: 0, z: 0 },
          this.drone.isOnGround()
        );

        droneBody.applyForce(
          new CANNON.Vec3(force.x, force.y, force.z),
          new CANNON.Vec3(0, 0, 0)
        );
        droneBody.torque.set(
          droneBody.torque.x + torque.x,
          droneBody.torque.y + torque.y,
          droneBody.torque.z + torque.z
        );
      });
      this._hasPreStepHandler = true;
    }

    // Store current wind so preStep handler can access it
    this._currentWind = totalWind;

    // ── Step world ────────────────────────────────────────────────────────
    this.world.step(1 / 120, dt, 3);

    // ── Clamp to ground ───────────────────────────────────────────────────
    if (droneBody.position.y < 0.1) {
      droneBody.position.y = 0.1;
      if (droneBody.velocity.y < 0) droneBody.velocity.y = 0;
    }

    // ── Update drone visuals ──────────────────────────────────────────────
    const motorThrusts = this.drone.motorPWM.map(pwm => pwm * this.params.maxThrust);
    this.drone.update(dt, motorThrusts);

    // ── Emit telemetry ────────────────────────────────────────────────────
    this.onTelemetry({
      ...state,
      motorPWM,
      motorThrusts,
      armed: this.drone.isArmed,
      windX: this.windForce.x,
      windZ: this.windForce.z,
      cameraMode: this.cameraMode,
    });
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  toggleCameraMode() {
    if (this.cameraMode === 'free') {
      this.cameraMode = 'drone-lock';
      // Capture the current camera-to-target offset so the view doesn't jump
      const target = this.orbitControls.target.clone();
      this._lockCamOffset = this.camera.position.clone().sub(target);
    } else {
      this.cameraMode = 'free';
    }
    return this.cameraMode;
  }

  triggerWindGust() {
    this.windGust = { ...generateWindGust(this.params), elapsed: 0 };
  }

  reset() {
    this.drone.reset();
    this.windForce = { x: 0, y: 0, z: 0 };
    this.windGust  = null;
    this._currentWind = { x: 0, y: 0, z: 0 };
    resetPID();
    resetTurbulence();
    this.setpoint = {
      targetAlt: 1.0, targetRoll: 0, targetPitch: 0, targetYaw: 0,
      throttleCmd: null, rollCmd: 0, pitchCmd: 0, yawCmd: 0,
      holdX: undefined, holdZ: undefined,
    };
    this.orbitControls.target.set(0, 0.5, 0);
    this.camera.position.set(3, 2.5, 4);
    this.orbitControls.update();
  }

  setControlInput(throttle, yaw, pitch, roll) {
    // throttle=null means auto-mode handles it
    this.setpoint.throttleCmd = throttle !== null ? Math.max(0, Math.min(1, throttle)) : null;
    this.setpoint.yawCmd      = Math.max(-1, Math.min(1, yaw   || 0));
    this.setpoint.pitchCmd    = Math.max(-1, Math.min(1, pitch || 0));
    this.setpoint.rollCmd     = Math.max(-1, Math.min(1, roll  || 0));
  }

  setArmState(armed) {
    this.drone.isArmed = armed;
    if (!armed) {
      this.drone.motorPWM = [0, 0, 0, 0];
      resetPID();
    } else if (this.autoMode) {
      // When arming in auto mode, lock current position as hold target
      const pos = this.drone.body.position;
      this.setpoint.holdX = pos.x;
      this.setpoint.holdZ = pos.z;
    }
  }

  setAutoMode(on) {
    this.autoMode = on;
    if (on) {
      // Clear manual throttle command so target altitude doesn't instantly dive
      this.setpoint.throttleCmd = null;
      // Reset target angles to hover straight
      this.setpoint.targetRoll = 0;
      this.setpoint.targetPitch = 0;
      // Capture current yaw as target
      const quat = this.drone.body?.quaternion;
      if (quat) {
        const euler = new THREE.Euler().setFromQuaternion(
          new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w), 'YXZ'
        );
        this.setpoint.targetYaw = -euler.y * (180 / Math.PI);
      }
      // Lock current horizontal position
      const pos = this.drone.body?.position;
      if (pos) {
        this.setpoint.holdX = pos.x;
        this.setpoint.holdZ = pos.z;
      }
    } else {
      this.setpoint.holdX = undefined;
      this.setpoint.holdZ = undefined;
    }
    resetPID();
  }

  setUserMotorFn(fn) {
    this.userMotorFn = fn;
  }

  updateParams(newParams) {
    Object.assign(this.params, newParams);
    this.world.gravity.set(0, -this.params.gravity, 0);
    this.drone.body.mass = this.params.mass;
    this.drone.body.updateMassProperties();
  }

  dispose() {
    this._resizeObserver.disconnect();
    cancelAnimationFrame(this._animId);
    this.renderer.dispose();
  }
}
