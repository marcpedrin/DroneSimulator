/**
 * physics.js — Real quadcopter aerodynamics & PID flight controller
 *
 * Coordinate system (Three.js / Cannon-es): Y is UP
 * Drone body frame:
 *   +X = right,  +Y = up (thrust direction),  -Z = forward
 *
 * Motor layout (X-configuration, viewed from above):
 *   M1 = Front-Right (+X, -Z)  [CW  → reaction torque -Y]
 *   M2 = Front-Left  (-X, -Z)  [CCW → reaction torque +Y]
 *   M3 = Rear-Left   (-X, +Z)  [CW  → reaction torque -Y]
 *   M4 = Rear-Right  (+X, +Z)  [CCW → reaction torque +Y]
 *
 * Torques (body frame):
 *   Roll  (τx) = L × ((F1+F4) - (F2+F3))   [+ = roll right]
 *   Pitch (τz) = L × ((F3+F4) - (F1+F2))   [+ = nose up]  (note: -Z fwd, so rear-heavy = nose up)
 *   Yaw   (τy) = kq × ((F2+F4) - (F1+F3))  [+ = CCW from above]
 */

'use strict';

// ─── Physics Constants ────────────────────────────────────────────────────────

export const DEFAULT_PARAMS = {
  mass:             0.8,      // kg
  armLength:        0.175,    // m  (motor-to-center distance)
  thrustCoeff:      2.5e-5,   // kT  (F = kT * omega^2) — typical 5" prop
  torqueCoeff:      5.0e-7,   // kQ  (M = kQ * omega^2) — reaction torque
  maxRPM:           10000,    // max motor RPM
  maxThrust:        5.0,      // N per motor
  airDensity:       1.225,    // kg/m³ at sea level
  dragCoeff:        0.47,     // translational drag Cd
  frontalArea:      0.04,     // m² — approximate frontal area of drone
  rotDragCoeff:     0.18,     // rotational damping — higher = more stable
  turbulenceScale:  0.1,      // turbulence force multiplier (low by default)
  turbulenceFreq:   0.8,      // Hz — how fast turbulence changes
  groundFriction:   0.6,      // friction when on ground
  gravity:          9.81,     // m/s²
};

// ─── PID State ────────────────────────────────────────────────────────────────

const pid = {
  alt:   { kp: 2.0,  ki: 0.1,  kd: 1.0,   integral: 0, prevError: 0 },
  roll:  { kp: 0.4,  ki: 0.02, kd: 0.2,   integral: 0, prevError: 0 },
  pitch: { kp: 0.4,  ki: 0.02, kd: 0.2,   integral: 0, prevError: 0 },
  yaw:   { kp: 0.6,  ki: 0.01, kd: 0.2,   integral: 0, prevError: 0 },
};

function pidStep(controller, error, dt, rate = null) {
  if (dt <= 0) return controller.kp * error; // guard against dt=0 on first frame
  controller.integral = Math.max(-1, Math.min(1, controller.integral + error * dt));
  // Use true angular velocity if provided to avoid derivative kick and timestep jitter
  const derivative = rate !== null ? rate : (error - controller.prevError) / dt;
  controller.prevError = error;
  return controller.kp * error + controller.ki * controller.integral + controller.kd * derivative;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/**
 * Compute automatic PID motor outputs given current drone state.
 * Returns [m1, m2, m3, m4] in range [0, 1].
 */
export function autoPIDOutputs(state, setpoint, params, dt) {
  const { altitude, roll, pitch, yaw, rollRate, pitchRate, yawRate } = state;
  const { targetAlt, targetRoll, targetPitch, targetYaw,
          throttleCmd, rollCmd, pitchCmd, yawCmd } = setpoint;

  // Altitude: base throttle to hover = m*g / (4 * maxThrust)
  const hoverThrottle = (params.mass * params.gravity) / (4 * params.maxThrust);

  let baseThrottle, dRoll, dPitch, dYaw;

  if (throttleCmd !== null) {
    // Manual mode: commands come from user input (0..1)
    baseThrottle = hoverThrottle + throttleCmd * (1 - hoverThrottle);
    dRoll  = rollCmd  * 0.3;   // + = roll right
    dPitch = pitchCmd * 0.3;   // + = stick forward = pitch down
    dYaw   = yawCmd   * 0.3;   // + = stick right = yaw CW
  } else {
    // Fully autonomous hover / position hold
    const altErr  = clamp(targetAlt - altitude, -5, 5);
    baseThrottle  = hoverThrottle + pidStep(pid.alt, altErr, dt, -state.vy) * 0.1;

    // targetPitch: + means nose down (forward). pitch: + means nose down.
    const rollErr  = clamp(targetRoll  - roll,  -45, 45) / 45;
    const pitchErr = clamp(targetPitch - pitch, -45, 45) / 45; 
    const yawErr   = clamp(targetYaw   - yaw,   -180, 180) / 180; 

    // Use actual angular velocity (rate) to prevent extreme derivative jitter
    dRoll  = pidStep(pid.roll,  rollErr,  dt, -rollRate / 45) * 0.25;
    dPitch = pidStep(pid.pitch, pitchErr, dt, -pitchRate / 45) * 0.25;
    dYaw   = pidStep(pid.yaw,   yawErr,   dt, -yawRate / 180) * 0.15;
  }

  baseThrottle = clamp(baseThrottle, 0, 1);

  // Motor mixing (X-config)
  // M1=FR(CW), M2=FL(CCW), M3=RL(CW), M4=RR(CCW)
  // dRoll: + means roll right  → Left side (M2, M3) increase, Right side (M1, M4) decrease
  // dPitch: + means pitch down → Rear side (M3, M4) increase, Front side (M1, M2) decrease
  // dYaw: + means yaw CW       → CCW motors (M2, M4) increase, CW motors (M1, M3) decrease
  const m1 = clamp(baseThrottle - dPitch - dRoll - dYaw, 0, 1); // FR
  const m2 = clamp(baseThrottle - dPitch + dRoll + dYaw, 0, 1); // FL
  const m3 = clamp(baseThrottle + dPitch + dRoll - dYaw, 0, 1); // RL
  const m4 = clamp(baseThrottle + dPitch - dRoll + dYaw, 0, 1); // RR

  return [m1, m2, m3, m4];
}

/** Reset PID integrators (call on drone reset) */
export function resetPID() {
  for (const c of Object.values(pid)) {
    c.integral = 0;
    c.prevError = 0;
  }
}

// ─── Turbulence (Simplex-like smooth random) ─────────────────────────────────

let turbulenceTime = 0;
// Simple value noise for smooth turbulence
function smoothNoise(t) {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f); // smoothstep
  const hash = (n) => Math.sin(n * 127.1 + 311.7) * 43758.5453123 % 1;
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

/**
 * Returns a turbulence force vector {x,y,z} in Newtons.
 * Uses smooth noise to simulate realistic atmospheric turbulence.
 */
export function getTurbulenceForce(params, dt) {
  turbulenceTime += dt * params.turbulenceFreq;
  const scale = params.turbulenceScale * params.mass * params.gravity * 0.15;
  return {
    x: (smoothNoise(turbulenceTime * 1.3)       - 0.5) * 2 * scale,
    y: (smoothNoise(turbulenceTime * 0.7 + 100) - 0.5) * 2 * scale * 0.3,
    z: (smoothNoise(turbulenceTime * 1.1 + 200) - 0.5) * 2 * scale,
  };
}

/** Reset turbulence clock */
export function resetTurbulence() { turbulenceTime = 0; }

/**
 * Generate a random wind gust impulse {x,y,z} in Newtons, applied for ~gustDuration seconds.
 * Magnitude varies 5–30 N.
 */
export function generateWindGust(params) {
  const magnitude = 5 + Math.random() * 25;
  const angle = Math.random() * Math.PI * 2;
  const elevation = (Math.random() - 0.5) * 0.5; // mostly horizontal
  return {
    force: {
      x: Math.cos(angle) * Math.cos(elevation) * magnitude,
      y: Math.sin(elevation) * magnitude * 0.3,
      z: Math.sin(angle) * Math.cos(elevation) * magnitude,
    },
    duration: 0.3 + Math.random() * 0.7, // 0.3–1.0 seconds
  };
}

// ─── Main Force/Torque Calculation ───────────────────────────────────────────

/**
 * Calculate all aerodynamic forces and torques for the drone body.
 *
 * @param {Object} bodyState   - { velocity, angularVelocity, quaternion, position }
 * @param {number[]} motorPWM  - [m1,m2,m3,m4] in [0,1]
 * @param {Object} params      - physics parameters
 * @param {Object} wind        - {x,y,z} current wind force in world frame
 * @param {boolean} onGround   - whether drone is on the ground
 * @returns {{ force: {x,y,z}, torque: {x,y,z}, motorThrusts: number[] }}
 */
export function computeForces(bodyState, motorPWM, params, wind, onGround) {
  const { velocity, angularVelocity, quaternion } = bodyState;

  // ── Per-motor thrust (F = kT * throttle * maxThrust) ──────────────────────
  const motorThrusts = motorPWM.map(pwm => pwm * params.maxThrust);
  const [F1, F2, F3, F4] = motorThrusts;
  const totalThrust = F1 + F2 + F3 + F4;

  // ── Torques in body frame ─────────────────────────────────────────────────
  const L  = params.armLength;
  const kQ = params.torqueCoeff / params.thrustCoeff; // torque-to-thrust ratio

  // X-axis (Pitch): Front (F1,F2) vs Rear (F3,F4). Front thrust = positive X torque (nose up)
  const tau_x_body = L * ((F1 + F2) - (F3 + F4));
  
  // Z-axis (Roll): Right (F1,F4) vs Left (F2,F3). Right thrust = positive Z torque (roll left)
  const tau_z_body = L * ((F1 + F4) - (F2 + F3));
  
  // Y-axis (Yaw): CW motors (F1,F3) create CCW body torque (+Y). CCW motors (F2,F4) create CW body torque (-Y).
  const tau_y_body = kQ * ((F1 + F3) - (F2 + F4));

  // Rotate body-frame torques to world frame using quaternion
  const rotated = rotateByQuat(
    { x: tau_x_body, y: tau_y_body, z: tau_z_body }, quaternion
  );
  const wx = rotated.x, wy = rotated.y, wz = rotated.z;

  // ── Rotational damping (angular drag) ─────────────────────────────────────
  const kDamp = params.rotDragCoeff;
  const angDampX = -kDamp * angularVelocity.x;
  const angDampY = -kDamp * angularVelocity.y;
  const angDampZ = -kDamp * angularVelocity.z;

  // ── Translational aerodynamic drag (world frame) ──────────────────────────
  const rho = params.airDensity;
  const Cd  = params.dragCoeff;
  const A   = params.frontalArea;
  const v   = velocity;
  const vMag = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  const dragScale = -0.5 * rho * Cd * A * vMag;
  const fdx = dragScale * v.x;
  const fdy = dragScale * v.y;
  const fdz = dragScale * v.z;

  // ── Thrust vector in world frame (drone +Y rotated) ───────────────────────
  const thrustLocal = { x: 0, y: totalThrust, z: 0 };
  const thrustWorld = rotateByQuat(thrustLocal, quaternion);

  // ── Ground friction ────────────────────────────────────────────────────────
  let gfx = 0, gfz = 0;
  if (onGround) {
    gfx = -params.groundFriction * velocity.x * params.mass;
    gfz = -params.groundFriction * velocity.z * params.mass;
  }

  return {
    force: {
      x: thrustWorld.x + fdx + wind.x + gfx,
      y: thrustWorld.y + fdy + wind.y,
      z: thrustWorld.z + fdz + wind.z + gfz,
    },
    torque: {
      x: wx + angDampX,
      y: wy + angDampY,
      z: wz + angDampZ,
    },
    motorThrusts,
  };
}

// ─── Quaternion helper (manual, no Three.js dependency) ──────────────────────

/**
 * Rotate vector v by quaternion q (q * v * q_conjugate).
 * q = {x, y, z, w}
 */
function rotateByQuat(v, q) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const { x: vx, y: vy, z: vz } = v;

  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  return {
    x: vx + qw * tx + qy * tz - qz * ty,
    y: vy + qw * ty + qz * tx - qx * tz,
    z: vz + qw * tz + qx * ty - qy * tx,
  };
}


