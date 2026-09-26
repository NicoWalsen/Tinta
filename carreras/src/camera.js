// Cámaras: persecución (cerca/lejos), capó, paragolpes y órbita del menú.
import * as THREE from 'three';

const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export const CAMERA_MODES = [
  { name: 'Persecución', dist: 6.3, height: 1.95, look: 1.05, fov: 60 },
  { name: 'Lejana', dist: 9.2, height: 2.9, look: 1.15, fov: 56 },
  { name: 'Capó', hood: true, y: 1.16, z: 0.95, fov: 70 },
  { name: 'Paragolpes', hood: true, y: 0.58, z: 2.25, fov: 74 },
];

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.mode = 0;
    this.yaw = 0;
    this.y = 0;
    this.shake = 0;
    this.fov = 60;
    this.ready = false;
    this.tmp = new THREE.Vector3();
  }

  next() { this.mode = (this.mode + 1) % CAMERA_MODES.length; this.ready = false; return CAMERA_MODES[this.mode].name; }

  kick(amount) { this.shake = Math.min(1.2, this.shake + amount); }

  follow(dt, car) {
    const m = CAMERA_MODES[this.mode];
    const cam = this.cam;
    const speedK = Math.min(1, car.speed / 75);
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const vib = speedK * speedK * 0.012 + car.rough * 0.03 * Math.min(1, car.speed / 20) + this.shake * 0.12;
    const jx = (Math.random() - 0.5) * vib, jy = (Math.random() - 0.5) * vib;

    if (m.hood) {
      cam.near = 0.1;
      const lx = fz, lz = -fx;
      const pitch = car.pitch;
      const y = car.y + m.y + car.bump - pitch * m.z;
      cam.position.set(car.x + fx * m.z + lx * jx, y + jy, car.z + fz * m.z);
      this.tmp.set(car.x + fx * 30, y - 0.6 - pitch * 30, car.z + fz * 30);
      cam.lookAt(this.tmp);
      cam.rotateZ(-car.roll * 0.9);
      this.yaw = car.heading;
      this.y = y;
    } else {
      cam.near = 0.3;
      // El rumbo de la cámara sigue al auto con retraso y se abre hacia el derrape.
      let target = car.heading;
      if (car.speed > 4 && car.u > 0) {
        const velYaw = Math.atan2(car.vx, car.vz);
        target = car.heading + wrap(velYaw - car.heading) * 0.45;
      }
      // Reubicar de golpe tras un salto (reaparición) o al cambiar de cámara
      const far = Math.abs(this.y - (car.y + m.height)) > 6 || Math.hypot(cam.position.x - car.x, cam.position.z - car.z) > m.dist * 3;
      if (!this.ready || far) { this.yaw = target; this.y = car.y + m.height; this.ready = true; }
      this.yaw += wrap(target - this.yaw) * (1 - Math.exp(-dt * 6));
      const dist = m.dist + speedK * 0.9;
      const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw);
      this.y += (car.y + m.height - this.y) * (1 - Math.exp(-dt * 7));
      cam.position.set(car.x - bx * dist + jx, this.y + jy, car.z - bz * dist);
      this.tmp.set(car.x + bx * 2.2, car.y + m.look, car.z + bz * 2.2);
      cam.lookAt(this.tmp);
    }
    const fovT = m.fov + speedK * speedK * 14;
    this.fov += (fovT - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; }
    cam.updateProjectionMatrix();
  }

  orbit(time, car, radius = 8.5) {
    const cam = this.cam;
    cam.near = 0.3;
    const a = car.heading + 2.3 + time * 0.12;
    cam.position.set(car.x + Math.sin(a) * radius, car.y + 1.6 + Math.sin(time * 0.35) * 0.35, car.z + Math.cos(a) * radius);
    this.tmp.set(car.x, car.y + 0.55, car.z);
    cam.lookAt(this.tmp);
    cam.fov = 38;
    cam.updateProjectionMatrix();
    this.ready = false;
    this.fov = cam.fov;
  }
}
