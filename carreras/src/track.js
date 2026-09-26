// Datos de la pista: muestreo del trazado, consultas de posición,
// línea de carrera y perfil de velocidades para la IA.
// No depende del DOM: se puede ejecutar en Node para pruebas.
import * as THREE from 'three';
import { TRACK, CAR } from './config.js';

const G = 9.81;

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class Track {
  constructor(def = TRACK) {
    this.def = def;
    const ctrl = def.points.map(p => new THREE.Vector3(p[0], (p[2] || 0) * def.elevScale, p[1]));
    const curve = new THREE.CatmullRomCurve3(ctrl, true, 'centripetal');
    const N = Math.round(curve.getLength() / def.spacing);
    const sp = curve.getSpacedPoints(N);
    this.N = N;

    const px = this.px = new Float32Array(N);
    const py = this.py = new Float32Array(N);
    const pz = this.pz = new Float32Array(N);
    for (let i = 0; i < N; i++) { px[i] = sp[i].x; py[i] = sp[i].y; pz[i] = sp[i].z; }

    // Suaviza la altura para que no haya escalones entre muestras.
    for (let pass = 0; pass < 6; pass++) {
      const tmp = py.slice();
      for (let i = 0; i < N; i++) {
        let acc = 0;
        for (let k = -6; k <= 6; k++) acc += tmp[(i + k + N) % N];
        py[i] = acc / 13;
      }
    }

    // Tangente (adelante) y normal izquierda.
    const tx = this.tx = new Float32Array(N);
    const tz = this.tz = new Float32Array(N);
    const nx = this.nx = new Float32Array(N);
    const nz = this.nz = new Float32Array(N);
    const heading = this.heading = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 1 + N) % N, b = (i + 1) % N;
      let dx = px[b] - px[a], dz = pz[b] - pz[a];
      const l = Math.hypot(dx, dz);
      dx /= l; dz /= l;
      tx[i] = dx; tz[i] = dz;
      nx[i] = dz; nz[i] = -dx;          // izquierda = (fz, -fx)
      heading[i] = Math.atan2(dx, dz);  // convención: adelante = (sin h, cos h)
    }

    // Distancia acumulada (en planta) y largo de cada segmento.
    const segLen = this.segLen = new Float32Array(N);
    const s = this.s = new Float32Array(N + 1);
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      segLen[i] = Math.hypot(px[j] - px[i], pz[j] - pz[i]);
      s[i + 1] = s[i] + segLen[i];
    }
    this.length = s[N];
    this.ds = this.length / N;

    // Pendiente (dy/ds) por muestra.
    const slope = this.slope = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      slope[i] = (py[b] - py[a]) / (4 * this.ds);
    }

    // Curvatura con signo (positiva = curva a la izquierda), suavizada.
    const curvRaw = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = (i - 2 + N) % N, b = (i + 2) % N;
      curvRaw[i] = wrapAngle(heading[b] - heading[a]) / (4 * this.ds);
    }
    const curv = this.curv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -4; k <= 4; k++) acc += curvRaw[(i + k + N) % N];
      curv[i] = acc / 9;
    }

    // Pianos: en curvas con radio menor a ~230 m, extendidos antes y después.
    const curb = this.curb = new Uint8Array(N);
    const EXT = 14;
    for (let i = 0; i < N; i++) {
      if (Math.abs(curv[i]) > 1 / 230) {
        for (let k = -EXT; k <= EXT; k++) curb[(i + k + N) % N] = 1;
      }
    }

    this.bounds = this._bounds();
    this.computeRacingLine();
  }

  _bounds() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < this.N; i++) {
      minX = Math.min(minX, this.px[i]); maxX = Math.max(maxX, this.px[i]);
      minZ = Math.min(minZ, this.pz[i]); maxZ = Math.max(maxZ, this.pz[i]);
    }
    return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 };
  }

  // Altura del perfil transversal respecto al eje: asfalto plano,
  // piano levemente elevado y pasto con una caída suave hacia el muro.
  crossHeight(lat, curbHere) {
    const a = Math.abs(lat), d = this.def;
    if (a <= d.roadHalf) return 0;
    if (curbHere && a <= d.roadHalf + d.curbWidth) {
      const t = (a - d.roadHalf) / d.curbWidth;
      return 0.05 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
    }
    const edge = d.roadHalf + (curbHere ? d.curbWidth : 0);
    return -0.04 - (a - edge) * 0.018;
  }

  // Tipo de superficie: 0 asfalto, 1 piano, 2 pasto.
  surfaceAt(lat, curbHere) {
    const a = Math.abs(lat), d = this.def;
    if (a <= d.roadHalf) return 0;
    if (curbHere && a <= d.roadHalf + d.curbWidth) return 1;
    return 2;
  }

  // Proyecta (x, z) sobre la pista. `hint` es el índice de la última
  // proyección (búsqueda local); con hint < 0 recorre toda la pista.
  project(x, z, hint, out) {
    const { N, px, pz } = this;
    let best = 0, bd = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    } else {
      for (let k = -14; k <= 14; k++) {
        const i = (hint + k + N) % N;
        const dx = x - px[i], dz = z - pz[i], d = dx * dx + dz * dz;
        if (d < bd) { bd = d; best = i; }
      }
    }
    let i0 = best, i1 = (best + 1) % N;
    let t = this._segT(i0, i1, x, z);
    if (t < 0) {
      i1 = i0; i0 = (best - 1 + N) % N;
      t = this._segT(i0, i1, x, z);
    }
    t = Math.min(1, Math.max(0, t));
    const ex = px[i0] + (px[i1] - px[i0]) * t;
    const ez = pz[i0] + (pz[i1] - pz[i0]) * t;
    let lx = this.nx[i0] + (this.nx[i1] - this.nx[i0]) * t;
    let lz = this.nz[i0] + (this.nz[i1] - this.nz[i0]) * t;
    const ll = Math.hypot(lx, lz); lx /= ll; lz /= ll;
    out.idx = i0;
    out.t = t;
    out.s = this.s[i0] + t * this.segLen[i0];
    out.lat = (x - ex) * lx + (z - ez) * lz;
    out.y = this.py[i0] + (this.py[i1] - this.py[i0]) * t;
    out.lx = lx; out.lz = lz;
    out.curb = this.curb[i0] === 1;
    out.slope = this.slope[i0];
    return out;
  }

  _segT(i0, i1, x, z) {
    const ax = this.px[i0], az = this.pz[i0];
    const dx = this.px[i1] - ax, dz = this.pz[i1] - az;
    return ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz);
  }

  // Punto de la pista a distancia s con desplazamiento lateral `lat`.
  pointAt(s, lat = 0) {
    const L = this.length;
    s = ((s % L) + L) % L;
    let i = Math.min(this.N - 1, Math.floor(s / this.ds));
    while (i > 0 && this.s[i] > s) i--;
    while (i < this.N - 1 && this.s[i + 1] < s) i++;
    const j = (i + 1) % this.N;
    const t = (s - this.s[i]) / this.segLen[i];
    const x = this.px[i] + (this.px[j] - this.px[i]) * t + this.nx[i] * lat;
    const z = this.pz[i] + (this.pz[j] - this.pz[i]) * t + this.nz[i] * lat;
    const y = this.py[i] + (this.py[j] - this.py[i]) * t;
    return { x, y, z, heading: this.heading[i], idx: i };
  }

  // Línea de carrera: suavizado laplaciano multi-escala del trazado,
  // restringido al ancho de la pista. Aproxima la línea de mínima curvatura.
  computeRacingLine() {
    const { N, px, pz, nx, nz } = this;
    const maxOff = this.def.roadHalf - 1.25;
    const off = new Float32Array(N);
    const schedule = [[24, 120], [12, 140], [6, 140], [3, 80]];
    for (const [k, iters] of schedule) {
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < N; i++) {
          const a = (i - k + N) % N, b = (i + k) % N;
          const mx = (px[a] + nx[a] * off[a] + px[b] + nx[b] * off[b]) * 0.5;
          const mz = (pz[a] + nz[a] * off[a] + pz[b] + nz[b] * off[b]) * 0.5;
          const target = (mx - px[i]) * nx[i] + (mz - pz[i]) * nz[i];
          let o = off[i] + (target - off[i]) * 0.6;
          off[i] = Math.max(-maxOff, Math.min(maxOff, o));
        }
      }
    }
    this.lineOff = off;

    // Curvatura de la línea (circunferencia por 3 puntos separados 10 m).
    const lx = new Float32Array(N), lz = new Float32Array(N);
    for (let i = 0; i < N; i++) { lx[i] = px[i] + nx[i] * off[i]; lz[i] = pz[i] + nz[i] * off[i]; }
    const kRaw = new Float32Array(N);
    const K = 5;
    for (let i = 0; i < N; i++) {
      const a = (i - K + N) % N, b = (i + K) % N;
      const ax = lx[a], az = lz[a], bx = lx[i], bz = lz[i], cx = lx[b], cz = lz[b];
      const ab = Math.hypot(bx - ax, bz - az), bc = Math.hypot(cx - bx, cz - bz), ac = Math.hypot(cx - ax, cz - az);
      const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      kRaw[i] = (2 * cross) / (ab * bc * ac + 1e-6);
    }
    const lineCurv = this.lineCurv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let k = -3; k <= 3; k++) acc += Math.abs(kRaw[(i + k + N) % N]);
      lineCurv[i] = acc / 7;
    }
    this.speedProfile = this.buildSpeedProfile(CAR.mu * 0.97, 86);
  }

  // Velocidad máxima por muestra: límite de adherencia en curva
  // (con carga aerodinámica) y frenada hacia atrás desde cada curva.
  buildSpeedProfile(mu, vmax) {
    const { N } = this;
    const v = new Float32Array(N);
    const kdm = CAR.downforce / CAR.mass;
    for (let i = 0; i < N; i++) {
      const k = this.lineCurv[i];
      const denom = k - mu * kdm;
      v[i] = denom > 0 ? Math.min(vmax, Math.sqrt(mu * G / denom)) : vmax;
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = N - 1; i >= 0; i--) {
        const j = (i + 1) % N;
        const aero = kdm * v[j] * v[j] * mu;
        const decel = (mu * G + aero) * 0.78;
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * decel * this.segLen[i]));
      }
    }
    return v;
  }

  // Zonas de frenada fuertes (para carteles de 100/200/300 m).
  brakingZones() {
    const zones = [];
    const v = this.speedProfile, N = this.N;
    for (let i = 0; i < N; i++) {
      const prev = v[(i - 1 + N) % N];
      if (v[i] < prev - 0.05) {
        // inicio de frenada: buscar el mínimo que sigue
        let j = i, minV = v[i];
        for (let k = 0; k < 250; k++) {
          const idx = (i + k) % N;
          if (v[idx] < minV) { minV = v[idx]; j = idx; }
          if (v[idx] > minV + 1) break;
        }
        if (prev - minV > 22) zones.push({ start: i, apex: j, drop: prev - minV });
        i = Math.max(i, j) + 1;
      }
    }
    return zones;
  }
}
