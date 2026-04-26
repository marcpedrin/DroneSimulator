import { autoPIDOutputs, resetPID } from './js/physics.js';

let state = {
  altitude: 0.1,
  roll: 5, // 5 degree roll perturbation!
  pitch: 0,
  yaw: 0,
  rollRate: 0,
  pitchRate: 0,
  yawRate: 0,
  vy: 0
};

const setpoint = {
  targetAlt: 1.0, targetRoll: 0, targetPitch: 0, targetYaw: 0,
  throttleCmd: null, rollCmd: 0, pitchCmd: 0, yawCmd: 0,
};

const params = {
  mass: 0.8,
  gravity: 9.81,
  maxThrust: 5.0
};

resetPID();

console.log("Starting simulation loop...");
let dt = 0.016;

for (let i = 0; i < 20; i++) {
  const [m1, m2, m3, m4] = autoPIDOutputs(state, setpoint, params, dt);
  
  // Very crude physics integration
  const thrust = (m1 + m2 + m3 + m4) * params.maxThrust;
  const F_net = thrust - (params.mass * params.gravity);
  const accelY = F_net / params.mass;
  
  state.vy += accelY * dt;
  state.altitude += state.vy * dt;
  
  if (state.altitude < 0.1) {
    state.altitude = 0.1;
    if (state.vy < 0) state.vy = 0;
  }
  
  console.log(`Frame ${i}: m1=${m1.toFixed(3)}, m2=${m2.toFixed(3)}, m3=${m3.toFixed(3)}, m4=${m4.toFixed(3)}`);
}
