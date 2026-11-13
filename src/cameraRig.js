import * as THREE from 'three';
import { CAR } from './car/carModel.js';

const _q = new THREE.Quaternion(), _lookQ = new THREE.Quaternion(), _euler = new THREE.Euler();

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
      // near plane just inside the closest cabin part (the visor, ~0.38 m away); a smaller
      // value starves the depth buffer and makes distant road markings flicker
      if (cam.fov !== 72) { cam.fov = 72; cam.near = 0.15; cam.updateProjectionMatrix(); }
      // update the car root first: the eye must use this frame's car pose, the same one
      // the cabin is drawn with, or the dashboard judders against the camera
      carObj.body.updateWorldMatrix(true, false);
      cam.position.copy(CAR.eye).applyMatrix4(carObj.body.matrixWorld);
      _q.setFromRotationMatrix(carObj.body.matrixWorld);
      _lookQ.setFromEuler(_euler.set(-0.04 + look.pitch, look.yaw, 0, 'YXZ'));
      cam.quaternion.copy(_q).multiply(_lookQ);
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
