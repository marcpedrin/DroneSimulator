import { Euler, Quaternion } from 'three';

function rotateByQuat(v, q) {
  const { x: qx, y: qy, z: qz, w: qw } = q;
  const { x: vx, y: vy, z: vz } = v;

  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);

  return {
    x: vx + qw * tx + qy * tz - qz * ty,
    y: vy + qw * ty + qz * tx - qx * tz,
    z: vz + qw * tz + qx * ty - qy * tx,
  };
}

// 90 degrees nose down (Pitch = 90 deg)
// Nose down means rotating around X axis by -90 degrees?
// Wait, +X torque is NOSE UP. So NOSE DOWN is -X torque.
// So rotating by -90 deg around X.
const q = new Quaternion().setFromAxisAngle({x:1,y:0,z:0}, -Math.PI/2);

const v_local = { x: 0, y: 1, z: 0 }; // Local UP
const v_world = rotateByQuat(v_local, q);

console.log("Local UP rotated by -90deg Pitch:", v_world);
