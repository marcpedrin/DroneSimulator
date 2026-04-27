import * as THREE from 'three';
import * as CANNON from 'cannon-es';

const quat = new CANNON.Quaternion();
quat.set(0, 0, 0, 1);

try {
  const euler = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
  console.log("Success:", euler.x, euler.y, euler.z);
} catch (e) {
  console.error("Error:", e);
}
