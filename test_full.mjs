import * as CANNON from './js/lib/cannon-es.js';
import { computeForces, autoPIDOutputs, resetPID, DEFAULT_PARAMS } from './js/physics.js';
import * as THREE from './js/lib/three.module.js';

const world = new CANNON.World();
world.gravity.set(0, -9.81, 0);

const shape = new CANNON.Box(new CANNON.Vec3(0.06, 0.02, 0.06));
const body = new CANNON.Body({ mass: 0.8 });
body.addShape(shape);
body.position.set(0, 0.1, 0);
world.addBody(body);

resetPID();

const setpoint = {
  targetAlt: 1.0, targetRoll: 0, targetPitch: 0, targetYaw: 0,
  throttleCmd: null, rollCmd: 0, pitchCmd: 0, yawCmd: 0,
};

let dt = 0.016;

console.log("Starting full physics loop...");
for (let i = 0; i < 60; i++) {
  const pos = body.position;
  const vel = body.velocity;
  const angVel = body.angularVelocity;
  const quat = body.quaternion;
  
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w), 'YXZ');
  
  const state = {
    altitude:    pos.y,
    roll:        -euler.z * (180 / Math.PI),
    pitch:       -euler.x * (180 / Math.PI),
    yaw:         -euler.y * (180 / Math.PI),
    rollRate:    -angVel.z * (180 / Math.PI),
    pitchRate:   -angVel.x * (180 / Math.PI),
    yawRate:     -angVel.y * (180 / Math.PI),
    vx: vel.x, vy: vel.y, vz: vel.z,
    dt
  };
  
  // Nudge it slightly on frame 5 to see if it recovers
  if (i === 5) {
     body.angularVelocity.z = 1.0; // spin around Z (roll)
  }

  const motorPWM = autoPIDOutputs(state, setpoint, DEFAULT_PARAMS, dt);
  
  const wind = {x:0, y:0, z:0};
  const { force, torque } = computeForces(
    { velocity: vel, angularVelocity: angVel, quaternion: quat, position: pos },
    motorPWM, DEFAULT_PARAMS, wind, pos.y <= 0.1
  );

  body.applyForce(new CANNON.Vec3(force.x, force.y, force.z), body.position);
  body.torque.set(body.torque.x + torque.x, body.torque.y + torque.y, body.torque.z + torque.z);
  
  world.step(1/120, dt, 3);
  
  console.log(`Frame ${i}: Alt=${pos.y.toFixed(3)}m, Roll=${state.roll.toFixed(2)}°, Pitch=${state.pitch.toFixed(2)}°, PWM=[${motorPWM[0].toFixed(2)},${motorPWM[1].toFixed(2)},${motorPWM[2].toFixed(2)},${motorPWM[3].toFixed(2)}]`);
}
