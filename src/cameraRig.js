import * as THREE from 'three';
import { CAR } from './car/carModel.js';

// Chase view behind the car, or the driver's eye in the right-hand seat.
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.first = true;
  }

  toggle() {
    this.mode = this.mode === 'chase' ? 'cockpit' : 'chase';
    this.first = true;
    return this.mode;
  }

  update(dt, carObj, phys, look) {
    const cam = this.camera;
    if (this.mode === 'cockpit') {
      if (cam.fov !== 72) { cam.fov = 72; cam.near = 0.05; cam.updateProjectionMatrix(); }
      carObj.body.updateMatrixWorld(true);
      cam.position.copy(CAR.eye).applyMatrix4(carObj.body.matrixWorld);
      const q = new THREE.Quaternion().setFromRotationMatrix(carObj.body.matrixWorld);
      const lookQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.04 + look.pitch, look.yaw, 0, "YXZ"));
      cam.quaternion.copy(q).multiply(lookQ);
      return;
    }
    if (cam.fov !== 60) { cam.fov = 60; cam.near = 0.3; cam.updateProjectionMatrix(); }
    const fx = Math.sin(phys.heading), fy = Math.cos(phys.heading);
    // orbit the camera around the car by the look offset
    const ob = phys.heading - look.yaw;
    const bx = Math.sin(ob), by = Math.cos(ob);
    const back = 6.4, up = 2.35;
    const target = new THREE.Vector3(phys.x - bx * back, phys.h + up + look.pitch * 3, -(phys.y - by * back));
    const lookAt = new THREE.Vector3(phys.x + fx * 3, phys.h + 1.1, -(phys.y + fy * 3));
    if (this.first) {
      this.pos.copy(target);
      this.look.copy(lookAt);
      this.first = false;
    }
    this.pos.lerp(target, 1 - Math.exp(-dt * 7));
    this.pos.y = Math.max(this.pos.y, phys.h + 0.8); // never sink below the road
    this.look.lerp(lookAt, 1 - Math.exp(-dt * 12));
    cam.position.copy(this.pos);
    cam.lookAt(this.look);
  }
}
