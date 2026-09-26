// Efectos: marcas de derrape, humo/polvo, chispas y llamaradas del escape.
import * as THREE from 'three';

// ---------------------------------------------------------------- marcas de derrape
export class Skidmarks {
  constructor(scene, max = 2600) {
    this.max = max;
    this.cursor = 0;
    this.last = new Map();
    const pos = new Float32Array(max * 4 * 3);
    const col = new Float32Array(max * 4 * 4);
    const idx = new Uint16Array(max * 6);
    for (let q = 0; q < max; q++) {
      const b = q * 4;
      idx.set([b, b + 2, b + 1, b, b + 3, b + 2], q * 6);
    }
    const g = new THREE.BufferGeometry();
    this.posA = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posA);
    g.setAttribute('color', this.colA);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const m = new THREE.MeshBasicMaterial({
      color: 0x0a0a0a, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  add(key, x, y, z, width, alpha) {
    const prev = this.last.get(key);
    if (!prev) { this.last.set(key, { x, y, z, a: alpha, lx: 0, lz: 0 }); return; }
    const dx = x - prev.x, dz = z - prev.z;
    const d = Math.hypot(dx, dz);
    if (d > 4) { this.last.set(key, { x, y, z, a: alpha, lx: 0, lz: 0 }); return; }
    if (d < 0.3) return;
    const lx = -dz / d * width * 0.5, lz = dx / d * width * 0.5;
    const plx = prev.lx || lx, plz = prev.lz || lz;
    const q = this.cursor;
    const p = this.posA.array, c = this.colA.array;
    const o = q * 12;
    p[o] = prev.x + plx; p[o + 1] = prev.y + 0.02; p[o + 2] = prev.z + plz;
    p[o + 3] = x + lx; p[o + 4] = y + 0.02; p[o + 5] = z + lz;
    p[o + 6] = x - lx; p[o + 7] = y + 0.02; p[o + 8] = z - lz;
    p[o + 9] = prev.x - plx; p[o + 10] = prev.y + 0.02; p[o + 11] = prev.z - plz;
    const oc = q * 16;
    for (let k = 0; k < 4; k++) {
      c[oc + k * 4] = 1; c[oc + k * 4 + 1] = 1; c[oc + k * 4 + 2] = 1;
      c[oc + k * 4 + 3] = (k === 1 || k === 2) ? alpha : prev.a;
    }
    this.posA.addUpdateRange(o, 12); this.posA.needsUpdate = true;
    this.colA.addUpdateRange(oc, 16); this.colA.needsUpdate = true;
    this.cursor = (q + 1) % this.max;
    this.last.set(key, { x, y, z, a: alpha, lx, lz });
  }

  lift(key) { this.last.delete(key); }

  clear() {
    this.posA.array.fill(0); this.colA.array.fill(0);
    this.posA.clearUpdateRanges(); this.colA.clearUpdateRanges();
    this.posA.needsUpdate = true; this.colA.needsUpdate = true;
    this.last.clear(); this.cursor = 0;
  }
}

// ---------------------------------------------------------------- partículas
const VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  attribute float aRot;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vRot;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = min(aSize * uScale / max(-mv.z, 0.1), 900.0);
    vAlpha = aAlpha; vColor = aColor; vRot = aRot;
  }`;
const FRAG = /* glsl */`
  uniform sampler2D map;
  varying float vAlpha;
  varying vec3 vColor;
  varying float vRot;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float c = cos(vRot), s = sin(vRot);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
    vec4 t = texture2D(map, p);
    gl_FragColor = vec4(vColor, t.a * vAlpha);
    if (gl_FragColor.a < 0.004) discard;
  }`;

export class Particles {
  constructor(scene, max, map, additive = false) {
    this.max = max;
    this.n = 0;
    this.p = [];
    for (let i = 0; i < max; i++) this.p.push({ life: 0 });
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setAttribute('aColor', this.aColor);
    g.setAttribute('aRot', this.aRot);
    this.uniforms = { map: { value: map }, uScale: { value: 500 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
    this.cursor = 0;
  }

  emit(o) {
    const p = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % this.max;
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = p.max = o.life;
    p.s0 = o.size0; p.s1 = o.size1;
    p.a0 = o.alpha;
    p.r = o.r; p.g = o.g; p.b = o.b;
    p.grav = o.grav || 0;
    p.drag = o.drag ?? 1.5;
    p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 1.5;
    p.fadeIn = o.fadeIn ?? 0.15;
  }

  update(dt, camera, viewportH) {
    this.uniforms.uScale.value = viewportH / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const P = this.aPos.array, S = this.aSize.array, A = this.aAlpha.array, C = this.aColor.array, R = this.aRot.array;
    for (let i = 0; i < this.max; i++) {
      const p = this.p[i];
      if (p.life <= 0) { A[i] = 0; S[i] = 0; continue; }
      p.life -= dt;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vy = p.vy * k - p.grav * dt; p.vz *= k;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rot += p.vr * dt;
      const t = 1 - Math.max(0, p.life) / p.max;
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
      S[i] = p.s0 + (p.s1 - p.s0) * t;
      const fade = Math.min(1, t / p.fadeIn) * (1 - t);
      A[i] = p.a0 * fade;
      C[i * 3] = p.r; C[i * 3 + 1] = p.g; C[i * 3 + 2] = p.b;
      R[i] = p.rot;
    }
    this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aColor.needsUpdate = this.aRot.needsUpdate = true;
  }

  clear() { for (const p of this.p) p.life = 0; }
}

// ---------------------------------------------------------------- orquestador
export class Effects {
  constructor(scene, tex) {
    this.skids = new Skidmarks(scene);
    this.smoke = new Particles(scene, 600, tex.smoke, false);
    this.sparks = new Particles(scene, 220, tex.spark, true);
    this.light = 1;
    this.emitAcc = new Map();
  }

  // Llamado por cada auto en cada cuadro.
  updateCar(car, key, dt, track) {
    const v = car.speed;
    const sinH = Math.sin(car.heading), cosH = Math.cos(car.heading);
    const fx = sinH, fz = cosH, lx = cosH, lz = -sinH;
    const S = car.spec;
    const wheels = [
      [S.cgToFront, S.halfTrack, car.skidF, 0], [S.cgToFront, -S.halfTrack, car.skidF, 1],
      [-S.cgToRear, S.halfTrack, car.skidR, 2], [-S.cgToRear, -S.halfTrack, car.skidR, 3],
    ];
    let acc = this.emitAcc.get(key) || 0;
    acc += dt;
    const doEmit = acc > 1 / 28;
    if (doEmit) acc = 0;
    this.emitAcc.set(key, acc);
    for (const [dl, dw, skid, k] of wheels) {
      const x = car.x + fx * dl + lx * dw, z = car.z + fz * dl + lz * dw;
      const surf = car.surf[k];
      const y = car.y + (surf === 1 ? 0.05 : 0);
      const wkey = key * 4 + k;
      if (surf !== 2 && skid > 0.25 && v > 1.5) this.skids.add(wkey, x, y, z, 0.24, Math.min(0.85, skid * 0.9));
      else this.skids.lift(wkey);
      if (!doEmit) continue;
      if (surf === 2 && v > 6) {
        // polvo en el pasto
        if (Math.random() < Math.min(1, v / 25)) this.smoke.emit({
          x, y: y + 0.2, z, vx: car.vx * 0.3 + (Math.random() - 0.5) * 2, vy: 1 + Math.random(), vz: car.vz * 0.3 + (Math.random() - 0.5) * 2,
          life: 1.4 + Math.random(), size0: 0.8, size1: 4.5, alpha: 0.45,
          r: 0.33 * this.light, g: 0.27 * this.light, b: 0.18 * this.light, drag: 1.2,
        });
      } else if (skid > 0.6 && v > 3) {
        this.smoke.emit({
          x, y: y + 0.25, z, vx: car.vx * 0.15 + (Math.random() - 0.5), vy: 0.6 + Math.random() * 0.6, vz: car.vz * 0.15 + (Math.random() - 0.5),
          life: 1.6 + Math.random() * 1.4, size0: 0.9, size1: 5 + skid * 3, alpha: 0.38 * skid,
          r: 0.78 * this.light, g: 0.78 * this.light, b: 0.8 * this.light, drag: 0.9,
        });
      }
    }
    // Petardeo del escape al subir de marcha
    if (car.shiftEvent !== 0) {
      if (car.shiftEvent > 0 && car.throttleVis > 0.6 && Math.random() < 0.7) {
        for (const ex of [-0.36, 0.36]) {
          const x = car.x - fx * 2.3 + lx * ex, z = car.z - fz * 2.3 + lz * ex;
          for (let n = 0; n < 3; n++) this.sparks.emit({
            x, y: car.y + 0.33, z, vx: car.vx - fx * (4 + Math.random() * 3), vy: Math.random(), vz: car.vz - fz * (4 + Math.random() * 3),
            life: 0.07 + Math.random() * 0.05, size0: 0.35, size1: 0.15, alpha: 1, r: 26, g: 9, b: 2.5, drag: 6, fadeIn: 0.01,
          });
        }
      }
      car.shiftEvent = 0;
    }
    // Chispas en choques
    if (car.impact > 2.5) {
      const n = Math.min(40, Math.floor(car.impact * 2.5));
      for (let i = 0; i < n; i++) this.sparks.emit({
        x: car.impactX, y: car.y + 0.3 + Math.random() * 0.3, z: car.impactZ,
        vx: car.vx * 0.6 + (Math.random() - 0.5) * 9, vy: 1 + Math.random() * 4, vz: car.vz * 0.6 + (Math.random() - 0.5) * 9,
        life: 0.25 + Math.random() * 0.45, size0: 0.12, size1: 0.04, alpha: 1, r: 30, g: 14, b: 3, grav: 9.8, drag: 0.8, fadeIn: 0.01,
      });
    }
  }

  update(dt, camera, viewportH) {
    this.smoke.update(dt, camera, viewportH);
    this.sparks.update(dt, camera, viewportH);
  }

  clear() { this.skids.clear(); this.smoke.clear(); this.sparks.clear(); }
}
