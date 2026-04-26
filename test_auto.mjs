
import { autoPIDOutputs } from './js/physics.js';

const state = {
  altitude: 0,
  roll: 0,
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

try {
  console.log("Testing Frame 1 (dt=0.016):");
  const m1 = autoPIDOutputs(state, setpoint, params, 0.016);
  console.log("PWM outputs:", m1);

  // simulate drone moving up
  state.altitude = 0.5;
  state.vy = 2.0; // 2 m/s up
  
  console.log("Testing Frame 2 (moving up):");
  const m2 = autoPIDOutputs(state, setpoint, params, 0.016);
  console.log("PWM outputs:", m2);
  
} catch (e) {
  console.error("CRASH:", e);
}
