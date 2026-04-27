/**
 * drone.js — Quadcopter mesh, Cannon-es rigid body, rotor animation
 *
 * Motor positions (X-config):
 *   M1 Front-Right (+X, -Z)  CW  (rotor spins clockwise from above)
 *   M2 Front-Left  (-X, -Z)  CCW
 *   M3 Rear-Left   (-X, +Z)  CW
 *   M4 Rear-Right  (+X, +Z)  CCW
 */

'use strict';

import * as THREE from 'three';
import * as CANNON from 'cannon-es';

export class Drone {
  constructor(scene, world, params) {
    this.scene  = scene;
    this.world  = world;
    this.params = params;

    // Motor state [0..1] throttle for each motor
    this.motorPWM    = [0, 0, 0, 0];
    this.motorThrusts = [0, 0, 0, 0];
    this.isArmed     = false;

    // Rotor angular positions for animation (radians)
    this.rotorAngle  = [0, 0, 0, 0];
    this.rotorSpeeds = [0, 0, 0, 0]; // rad/s for visual spin

    this._buildMesh();
    this._buildPhysicsBody();
  }

  // ─── Mesh Construction ─────────────────────────────────────────────────────

  _buildMesh() {
    this.group = new THREE.Group();

    const mat = {
      body:  new THREE.MeshPhysicalMaterial({ color: 0x1a1a2e, metalness: 0.8, roughness: 0.3 }),
      arm:   new THREE.MeshPhysicalMaterial({ color: 0x16213e, metalness: 0.6, roughness: 0.4 }),
      rotor: new THREE.MeshPhysicalMaterial({ color: 0x0f3460, metalness: 0.4, roughness: 0.5, transparent: true, opacity: 0.85 }),
      motor: new THREE.MeshPhysicalMaterial({ color: 0xe94560, metalness: 0.9, roughness: 0.2 }),
      hub:   new THREE.MeshPhysicalMaterial({ color: 0xf5a623, metalness: 0.7, roughness: 0.3 }),
      led:   new THREE.MeshStandardMaterial({ color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 2.0 }),
    };

    // ── Central body ──────────────────────────────────────────────────────────
    const bodyGeo = new THREE.BoxGeometry(0.12, 0.04, 0.12);
    const bodyMesh = new THREE.Mesh(bodyGeo, mat.body);
    bodyMesh.castShadow = true;
    this.group.add(bodyMesh);

    // ── Flight controller box ──────────────────────────────────────────────
    const fcGeo = new THREE.BoxGeometry(0.07, 0.015, 0.07);
    const fcMesh = new THREE.Mesh(fcGeo, mat.hub);
    fcMesh.position.set(0, 0.028, 0);
    this.group.add(fcMesh);

    // ── Status LED ────────────────────────────────────────────────────────
    this.statusLED = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), mat.led);
    this.statusLED.position.set(0, 0.038, 0);
    this.group.add(this.statusLED);

    // ── Arms & motors ─────────────────────────────────────────────────────
    const ARM_LEN = this.params.armLength;
    const motorPositions = [
      { x:  ARM_LEN, z: -ARM_LEN, spin:  1, name: 'FR' },
      { x: -ARM_LEN, z: -ARM_LEN, spin: -1, name: 'FL' },
      { x: -ARM_LEN, z:  ARM_LEN, spin:  1, name: 'RL' },
      { x:  ARM_LEN, z:  ARM_LEN, spin: -1, name: 'RR' },
    ];

    this.rotorMeshes = [];
    this.motorLights = [];

    motorPositions.forEach((mp, i) => {
      // Arm tube (diagonal)
      const armDir = new THREE.Vector3(mp.x, 0, mp.z).normalize();
      const armLen = ARM_LEN * Math.SQRT2 * 0.55;
      const armGeo = new THREE.CylinderGeometry(0.006, 0.008, armLen, 6);
      const armMesh = new THREE.Mesh(armGeo, mat.arm);
      armMesh.position.set(mp.x * 0.5, 0, mp.z * 0.5);
      armMesh.lookAt(mp.x, 0, mp.z);
      armMesh.rotateX(Math.PI / 2);
      armMesh.castShadow = true;
      this.group.add(armMesh);

      // Motor cylinder
      const motorGeo = new THREE.CylinderGeometry(0.013, 0.013, 0.022, 12);
      const motorMesh = new THREE.Mesh(motorGeo, mat.motor);
      motorMesh.position.set(mp.x, 0, mp.z);
      motorMesh.castShadow = true;
      this.group.add(motorMesh);

      // Rotor disc (thin flat cylinder simulating props)
      const rotorGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.003, 24);
      const rotorMesh = new THREE.Mesh(rotorGeo, mat.rotor);
      rotorMesh.position.set(mp.x, 0.015, mp.z);
      rotorMesh.castShadow = false;
      this.group.add(rotorMesh);
      this.rotorMeshes.push({ mesh: rotorMesh, spin: mp.spin });

      // Rotor blade cross (two thin boxes)
      [-1, 1].forEach(dir => {
        const bladeGeo = new THREE.BoxGeometry(0.12, 0.003, 0.016);
        const bladeMesh = new THREE.Mesh(bladeGeo, mat.rotor);
        bladeMesh.position.set(mp.x, 0.017, mp.z);
        bladeMesh.rotation.y = (dir === 1 ? 0 : Math.PI / 2);
        this.group.add(bladeMesh);
        this.rotorMeshes.push({ mesh: bladeMesh, spin: mp.spin, blade: true, idx: i });
      });

      // Motor light indicator
      const lightColor = i < 2 ? 0xff3333 : 0x33ff33; // red front, green rear
      const motorLight = new THREE.PointLight(lightColor, 0, 0.3);
      motorLight.position.set(mp.x, 0.02, mp.z);
      this.group.add(motorLight);
      this.motorLights.push(motorLight);
    });

    // ── Camera gimbal (cosmetic) ───────────────────────────────────────────
    const gimbalGeo = new THREE.SphereGeometry(0.015, 8, 8);
    const gimbalMesh = new THREE.Mesh(gimbalGeo, mat.hub);
    gimbalMesh.position.set(0, -0.025, -0.06);
    this.group.add(gimbalMesh);

    this.group.castShadow = true;
    this.scene.add(this.group);
  }

  _buildPhysicsBody() {
    // Cannon-es body — box shape matching visual body
    const shape = new CANNON.Box(new CANNON.Vec3(0.18, 0.025, 0.18));
    this.body = new CANNON.Body({
      mass:              this.params.mass,
      shape:             shape,
      linearDamping:     0.05,   // small — aerodynamics handles most drag
      angularDamping:    0.18,   // enough to resist flip oscillation
      allowSleep:        false,
    });

    this.body.position.set(0, 0.5, 0);  // start 0.5m above ground
    this.world.addBody(this.body);
  }

  // ─── Per-Frame Update ──────────────────────────────────────────────────────

  update(dt, motorThrusts) {
    this.motorThrusts = motorThrusts;

    // ── Sync Three.js mesh with Cannon-es body ─────────────────────────────
    this.group.position.copy(this.body.position);
    this.group.quaternion.copy(this.body.quaternion);

    // ── Rotor animation ────────────────────────────────────────────────────
    const maxVisualSpeed = 60; // rad/s at full throttle
    this.rotorMeshes.forEach((r, idx) => {
      const motorIdx = Math.floor(idx / 3); // 3 mesh objects per motor
      const throttle = this.motorPWM[Math.min(motorIdx, 3)] || 0;
      const speed = throttle * maxVisualSpeed * r.spin;
      r.mesh.rotation.y += speed * dt;
    });

    // ── Motor glow lights ─────────────────────────────────────────────────
    this.motorLights.forEach((light, i) => {
      light.intensity = this.motorPWM[i] * 2.0;
    });

    // ── Status LED blink (armed = solid, disarmed = slow blink) ───────────
    const t = performance.now() / 1000;
    if (this.isArmed) {
      this.statusLED.material.emissiveIntensity = 2.0;
    } else {
      this.statusLED.material.emissiveIntensity = Math.sin(t * 2) > 0 ? 1.5 : 0;
    }
  }

  // ─── Reset ────────────────────────────────────────────────────────────────

  reset(startPos = { x: 0, y: 0.5, z: 0 }) {
    this.body.position.set(startPos.x, startPos.y, startPos.z);
    this.body.velocity.set(0, 0, 0);
    this.body.angularVelocity.set(0, 0, 0);
    this.body.quaternion.set(0, 0, 0, 1);
    this.motorPWM    = [0, 0, 0, 0];
    this.motorThrusts = [0, 0, 0, 0];
    this.isArmed     = false;
  }

  // ─── Getters ──────────────────────────────────────────────────────────────

  getPosition()        { return this.body.position; }
  getQuaternion()      { return this.body.quaternion; }
  getVelocity()        { return this.body.velocity; }
  getAngularVelocity() { return this.body.angularVelocity; }
  isOnGround()         { return this.body.position.y <= 0.12; }

  dispose() {
    this.world.removeBody(this.body);
    this.scene.remove(this.group);
  }
}
