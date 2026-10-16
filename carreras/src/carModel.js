// Modelo 3D procedural de un deportivo genérico.
// La carrocería es un "loft": secciones transversales suaves a lo largo del
// auto, definidas por perfiles (altura del techo, línea de cintura, ancho…).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR } from './config.js';
import { makeLiveryTexture, panelNormalMap, carbonTexture, tireTexture, fasciaTexture } from './carTextures.js';

const LEN = CAR.length, ZR = -LEN / 2;
const WHEEL_R = CAR.wheelRadius;
const AXLE_F = CAR.cgToFront, AXLE_R = -CAR.cgToRear;

// Interpolación cúbica (Hermite con tangentes tipo Catmull-Rom) por claves.
function curve1D(keys) {
  return (t) => {
    const n = keys.length;
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0;
    while (t > keys[i + 1][0]) i++;
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1];
    const km = keys[Math.max(0, i - 1)], kp = keys[Math.min(n - 1, i + 2)];
    const m0 = (v1 - km[1]) / (t1 - km[0] || 1);
    const m1 = (kp[1] - v0) / (kp[0] - t0 || 1);
    const h = t1 - t0, s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * v0 + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * v1 + (s3 - s2) * h * m1;
  };
}

// Perfiles longitudinales (t = 0 cola, 1 trompa)
const yTop = curve1D([[0, 0.60], [0.03, 0.80], [0.10, 0.93], [0.20, 0.975], [0.28, 1.02], [0.38, 1.165], [0.47, 1.225], [0.55, 1.215], [0.62, 1.10], [0.69, 0.895], [0.74, 0.835], [0.85, 0.78], [0.94, 0.68], [1.0, 0.52]]);
const yF = curve1D([[0, 0.585], [0.03, 0.79], [0.10, 0.905], [0.22, 0.955], [0.30, 1.005], [0.38, 1.135], [0.47, 1.19], [0.55, 1.18], [0.62, 1.07], [0.69, 0.875], [0.74, 0.86], [0.79, 0.862], [0.88, 0.80], [0.95, 0.68], [1.0, 0.515]]);
const wF = curve1D([[0, 0.60], [0.1, 0.70], [0.25, 0.69], [0.36, 0.62], [0.47, 0.585], [0.56, 0.59], [0.66, 0.67], [0.72, 0.76], [0.85, 0.77], [1.0, 0.62]]);
const yBelt = curve1D([[0, 0.56], [0.04, 0.76], [0.12, 0.885], [0.20, 0.905], [0.32, 0.89], [0.45, 0.87], [0.60, 0.86], [0.70, 0.845], [0.79, 0.868], [0.88, 0.805], [0.95, 0.685], [1.0, 0.50]]);
const wBody = curve1D([[0, 0.80], [0.04, 0.90], [0.14, 0.975], [0.22, 0.985], [0.35, 0.96], [0.5, 0.945], [0.65, 0.95], [0.79, 0.968], [0.9, 0.94], [0.97, 0.86], [1.0, 0.78]]);
const yBotBase = curve1D([[0, 0.34], [0.04, 0.22], [0.1, 0.17], [0.9, 0.17], [0.96, 0.2], [1.0, 0.28]]);

function yBottom(z) {
  let y = yBotBase((z - ZR) / LEN);
  const Ra = WHEEL_R + 0.065;
  for (const za of [AXLE_F, AXLE_R]) {
    const dz = z - za;
    if (Math.abs(dz) < Ra) y = Math.max(y, WHEEL_R + Math.sqrt(Ra * Ra - dz * dz));
  }
  return y;
}

// Catmull-Rom centrípeta 2D entre p1 y p2.
function cr2(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-4, 0.5);
  const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const L = (a, b, ta, tb) => [
    (tb - tt) / (tb - ta) * a[0] + (tt - ta) / (tb - ta) * b[0],
    (tb - tt) / (tb - ta) * a[1] + (tt - ta) / (tb - ta) * b[1]];
  const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}

const SEG_DIV = [2, 3, 4, 3, 7, 7];   // subdivisiones de A-B, B-C, C-D, D-E, E-F, F-G

// Sección (mitad derecha, x ≥ 0) en la posición t. Devuelve puntos y banda.
function section(t) {
  const z = ZR + t * LEN;
  const yb = yBottom(z);
  const belt = yBelt(t);
  const endK = t > 0.92 ? Math.sqrt(1 - Math.pow((t - 0.92) / 0.08, 2) * 0.32)
    : t < 0.06 ? Math.sqrt(1 - Math.pow((0.06 - t) / 0.06, 2) * 0.28) : 1;
  const wb = wBody(t) * endK;
  const hs = Math.max(0.04, belt - yb);
  const top = yTop(t);
  let fy = yF(t), fw = wF(t) * endK;
  const ctrl = [
    [0, yb],
    [wb - 0.13, yb],
    [wb - 0.01, yb + hs * 0.22],
    [wb + 0.004, yb + hs * 0.7],
    [wb - 0.045, belt],
    [fw, fy],
    [0, top],
  ];
  const pts = [], band = [];
  const ext = [[-ctrl[1][0], ctrl[1][1]], ...ctrl, [-ctrl[5][0], ctrl[5][1]]];
  for (let sgm = 0; sgm < 6; sgm++) {
    const n = SEG_DIV[sgm];
    for (let k = 0; k < n; k++) {
      pts.push(cr2(ext[sgm], ext[sgm + 1], ext[sgm + 2], ext[sgm + 3], k / n));
      band.push(sgm * 100 + k);
    }
  }
  pts.push(ctrl[6]); band.push(600);
  return { pts, band, z };
}

let _bodyGeo = null;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Posición de banda (0..6) de un punto de la sección a partir de su código.
function bandPos(code) {
  const sgm = Math.floor(code / 100), k = code % 100;
  return sgm >= 6 ? 6 : sgm + k / SEG_DIV[sgm];
}

function buildBody() {
  if (_bodyGeo) return _bodyGeo;
  const ST = 156;
  const secs = [];
  for (let i = 0; i <= ST; i++) {
    const u = i / ST;
    const t = u * 0.8 + (0.5 - 0.5 * Math.cos(u * Math.PI)) * 0.2;   // algo más densa en los extremos
    secs.push({ t, ...section(t) });
  }
  const half = secs[0].pts.length;       // puntos de la mitad P (incluye A y G)
  const M = 2 * (half - 1);               // anillo completo
  const R = M + 1;                        // + vértice de costura (v = 1) bajo el auto
  const pos = [], uv = [], col = [];
  // Oclusión ambiental aproximada: más oscuro abajo y dentro de los pasos de rueda.
  const ao = (x, y, z) => {
    let a = 1 - 0.5 * (1 - smooth(0.16, 0.5, y));
    for (const za of [AXLE_F, AXLE_R]) {
      const d = Math.hypot(z - za, y - WHEEL_R);
      a *= 1 - 0.45 * (1 - smooth(WHEEL_R + 0.06, WHEEL_R + 0.3, d)) * (1 - smooth(0.6, 0.85, y));
    }
    return a;
  };
  for (const s of secs) {
    for (let j = 0; j < R; j++) {
      let x, y, b;
      if (j < half) { [x, y] = s.pts[j]; b = bandPos(s.band[j]) / 12; }
      else { const jj = M - j; [x, y] = s.pts[jj]; x = -x; b = 1 - bandPos(s.band[jj]) / 12; }
      pos.push(x, y, s.z);
      uv.push(s.t, b);
      const a = ao(x, y, s.z);
      col.push(a, a, a);
    }
  }
  const ringBand = [];
  for (let j = 0; j < M; j++) ringBand.push(j < half - 1 ? secs[0].band[j] : secs[0].band[M - j - 1]);

  const paint = [], glass = [], trim = [], fascia = [];
  for (let i = 0; i < ST; i++) {
    const tc = (secs[i].t + secs[i + 1].t) / 2;
    for (let j = 0; j < M; j++) {
      const a = i * R + j, b = a + 1, c = (i + 1) * R + j, d = c + 1;
      const band = ringBand[j];
      const sgm = Math.floor(band / 100), k = band % 100;
      let target = paint;
      if (sgm <= 1) target = trim;
      else if (sgm === 4) {
        // ventanilla lateral: bordes verticales (siguen la malla, sin escalones)
        if (tc > 0.372 && tc < 0.64 && k > 0) target = glass;
        else if (tc > 0.365 && tc < 0.647 && k > 0) target = trim;
      } else if (sgm === 5) {
        if (tc > 0.578 && tc < 0.688) target = k === 0 ? trim : tc < 0.6 ? paint : glass;  // franja del parabrisas
        else if (tc > 0.305 && tc < 0.445) target = k === 0 ? trim : glass;
      }
      target.push(a, b, c, b, d, c);
    }
  }
  // Tapas: frontal con parrilla de panal y trasera con difusor (textura compartida)
  const capRing = (i, front) => {
    const base = pos.length / 3;
    const s = secs[i];
    const u0 = front ? 0.25 : 0.75;
    for (let j = 0; j < M; j++) {
      const o = (i * R + j) * 3;
      const x = pos[o], y = pos[o + 1];
      pos.push(x, y, pos[o + 2]);
      uv.push(u0 + (front ? x : -x) / 1.5 * 0.5, (y - 0.24) / 0.36);
      col.push(1, 1, 1);
    }
    let cy = 0; for (const [, y] of s.pts) cy += y; cy /= s.pts.length;
    const center = pos.length / 3;
    pos.push(0, cy, s.z + (front ? 0.02 : -0.02));
    uv.push(u0, (cy - 0.24) / 0.36);
    col.push(1, 1, 1);
    for (let j = 0; j < M; j++) {
      const a = base + j, b = base + (j + 1) % M;
      if (front) fascia.push(center, a, b); else fascia.push(center, b, a);
    }
  };
  capRing(0, false);
  capRing(ST, true);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex([...paint, ...glass, ...trim, ...fascia]);
  let o = 0;
  for (const [list, m] of [[paint, 0], [glass, 1], [trim, 2], [fascia, 3]]) { g.addGroup(o, list.length, m); o += list.length; }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  _bodyGeo = g;
  return g;
}

// Punto de la superficie superior de la carrocería en (t, x).
function surfacePoint(t, x) {
  const s = section(t);
  let best = null, bd = Infinity;
  for (let j = 3; j < s.pts.length; j++) {
    const [px, py] = s.pts[j];
    const d = Math.abs(px - x);
    if (d < bd) { bd = d; best = [px, py]; }
  }
  return { x: best[0], y: best[1], z: s.z };
}

// ---------------------------------------------------------------- ruedas
// Asigna un color de vértice: en las llantas separa la cara mecanizada
// (brillante) de los laterales y el barril (oscuros).
function tint(g, fn) {
  g = g.index ? g.toNonIndexed() : g;
  const n = g.attributes.position.count, N = g.attributes.normal;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const [r, gg, b] = fn(N.getX(i), N.getY(i), N.getZ(i)); c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

let _wheelGeos = null;
function wheelGeos() {
  if (_wheelGeos) return _wheelGeos;
  const R = WHEEL_R, W = 0.28, rimR = 0.25;
  // Slick de competición: flanco bajo y hombro cuadrado
  const prof = [
    [rimR - 0.004, -W / 2 + 0.012], [rimR + 0.03, -W / 2 - 0.006], [R - 0.03, -W / 2 - 0.002], [R - 0.008, -W / 2 + 0.022],
    [R - 0.001, -W / 4], [R + 0.002, 0], [R - 0.001, W / 4], [R - 0.008, W / 2 - 0.022], [R - 0.03, W / 2 + 0.002],
    [rimR + 0.03, W / 2 + 0.006], [rimR - 0.004, W / 2 - 0.012],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(prof, 44);
  tire.rotateZ(Math.PI / 2);

  const face = W / 2 - 0.03;
  const parts = [];
  const dark = [0.32, 0.32, 0.34];
  // Barril interior y labio pulido
  const barrel = new THREE.CylinderGeometry(rimR - 0.008, rimR - 0.008, W - 0.03, 40, 1, true);
  barrel.rotateZ(Math.PI / 2);
  parts.push(tint(barrel, () => dark));
  const lip = new THREE.TorusGeometry(rimR - 0.01, 0.011, 6, 40);
  lip.rotateY(Math.PI / 2); lip.translate(face + 0.008, 0, 0);
  parts.push(tint(lip, () => [1, 1, 1]));
  // Cubo y tuerca central de competición (hexagonal, roja)
  const hub = new THREE.CylinderGeometry(0.07, 0.08, 0.04, 24);
  hub.rotateZ(Math.PI / 2); hub.translate(face - 0.01, 0, 0);
  parts.push(tint(hub, () => [0.55, 0.55, 0.58]));
  const nut = new THREE.CylinderGeometry(0.042, 0.042, 0.05, 6);
  nut.rotateZ(Math.PI / 2); nut.translate(face + 0.012, 0, 0);
  parts.push(tint(nut, () => [1.0, 0.16, 0.12]));
  const cap = new THREE.CylinderGeometry(0.018, 0.024, 0.025, 12);
  cap.rotateZ(Math.PI / 2); cap.translate(face + 0.045, 0, 0);
  parts.push(tint(cap, () => [1, 1, 1]));
  // 5 radios dobles, ahusados y con cara mecanizada
  for (let k = 0; k < 5; k++) {
    for (const off of [-0.15, 0.15]) {
      const len = rimR - 0.075;
      const sp = new THREE.BoxGeometry(0.034, len, 0.03, 1, 2, 1);
      const P = sp.attributes.position;
      for (let i = 0; i < P.count; i++) {
        const tt = (P.getY(i) + len / 2) / len;            // 0 cubo → 1 llanta
        P.setZ(i, P.getZ(i) * (1.15 - 0.45 * tt));
        P.setX(i, P.getX(i) - tt * 0.02);                  // cóncavo hacia el borde
      }
      sp.computeVertexNormals();
      sp.translate(face - 0.005, len / 2 + 0.065, 0);
      sp.rotateX(k * Math.PI * 2 / 5 + off);
      parts.push(tint(sp, (nx) => (nx > 0.6 ? [1, 1, 1] : [0.38, 0.38, 0.4])));
    }
  }
  // Disco de freno ventilado con campana central
  const disc = new THREE.CylinderGeometry(0.205, 0.205, 0.032, 40);
  disc.rotateZ(Math.PI / 2); disc.translate(0.01, 0, 0);
  parts.push(tint(disc, () => [0.62, 0.6, 0.58]));
  const bell = new THREE.CylinderGeometry(0.095, 0.095, 0.05, 24);
  bell.rotateZ(Math.PI / 2); bell.translate(0.03, 0, 0);
  parts.push(tint(bell, () => [0.25, 0.25, 0.27]));
  const rimDisc = mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g; }));

  // Pinza de freno grande (no gira)
  const caliper = new THREE.BoxGeometry(0.075, 0.2, 0.13, 1, 3, 1);
  const CP = caliper.attributes.position;
  for (let i = 0; i < CP.count; i++) { const yy = CP.getY(i); CP.setZ(i, CP.getZ(i) - yy * yy * 1.2); }   // curva siguiendo el disco
  caliper.computeVertexNormals();
  caliper.translate(0.055, 0.145, -0.07);
  caliper.rotateX(-0.35);
  _wheelGeos = { tire, caliper, rimDisc };
  return _wheelGeos;
}

// ---------------------------------------------------------------- materiales compartidos
let _shared = null;
function sharedMaterials() {
  if (_shared) return _shared;
  const carbonMap = carbonTexture();
  _shared = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, metalness: 0.0, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.015, envMapIntensity: 1.8 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.55, metalness: 0.1 }),
    fascia: new THREE.MeshStandardMaterial({ map: fasciaTexture(), roughness: 0.45, metalness: 0.4 }),
    carbon: new THREE.MeshPhysicalMaterial({ map: carbonMap, color: 0xffffff, roughness: 0.45, metalness: 0.2, clearcoat: 0.35, clearcoatRoughness: 0.1, envMapIntensity: 0.6 }),
    rubber: new THREE.MeshStandardMaterial({ map: tireTexture(), color: 0xffffff, roughness: 0.86, metalness: 0, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ color: 0xc9ced3, roughness: 0.22, metalness: 1.0, vertexColors: true, side: THREE.DoubleSide }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.28, metalness: 1.0, vertexColors: true, side: THREE.DoubleSide }),
    rimGold: new THREE.MeshStandardMaterial({ color: 0xc8a14a, roughness: 0.26, metalness: 1.0, vertexColors: true, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xe6e6e6, roughness: 0.08, metalness: 1.0 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe4f0ff, emissiveIntensity: 16, roughness: 0.2 }),
    headHousing: new THREE.MeshPhysicalMaterial({ color: 0x07090c, metalness: 0.5, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xe0261c, roughness: 0.55, metalness: 0.1 }),
  };
  return _shared;
}

// Pintura de competición: decoración + relieve de paneles + destellos metálicos.
// Los destellos son microfacetas aleatorias en la capa base (bajo el barniz)
// que se apagan solas cuando son más chicas que un píxel (sin parpadeo).
function paintMaterial(livery) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: makeLiveryTexture(livery), normalMap: panelNormalMap(), normalScale: new THREE.Vector2(0.9, 0.9),
    vertexColors: true, metalness: 0.35, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.35,
  });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec2 fuv = vMapUv * vec2( 6000.0, 4200.0 );
        vec2 cell = floor( fuv );
        vec3 h = fract( sin( vec3( dot( cell, vec2( 127.1, 311.7 ) ), dot( cell, vec2( 269.5, 183.3 ) ), dot( cell, vec2( 419.2, 371.9 ) ) ) ) * 43758.5453 );
        float fw = fwidth( fuv.x ) + fwidth( fuv.y );
        normal = normalize( normal + ( h - 0.5 ) * 0.3 * clamp( 1.5 - fw, 0.0, 1.0 ) );
      }`);
  };
  m.customProgramCacheKey = () => 'asfalto-paint';
  return m;
}

// ---------------------------------------------------------------- fusión de piezas
let _extras = null;
const ROLES = ['trim', 'carbon', 'chrome', 'paintSolid', 'head', 'headHousing', 'tail', 'accent'];
function roleMaterials() {
  const R = {};
  for (const k of ROLES) R[k] = new THREE.MeshBasicMaterial({ name: k });
  return R;
}
// Coordenadas de textura por proyección de caja (densidad uniforme de la trama de carbono).
function boxUV(g, scale) {
  const P = g.attributes.position, N = g.attributes.normal;
  const uv = new Float32Array(P.count * 2);
  for (let i = 0; i < P.count; i++) {
    const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = P.getZ(i); v = P.getY(i); }
    else if (ay >= az) { u = P.getX(i); v = P.getZ(i); }
    else { u = P.getX(i); v = P.getY(i); }
    uv[i * 2] = u * scale; uv[i * 2 + 1] = v * scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function mergeByRole(group) {
  group.updateMatrixWorld(true);
  const byRole = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const role = o.material.name;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(g);
  });
  const out = new Map();
  for (const [role, list] of byRole) {
    const g = mergeGeometries(list);
    if (role === 'carbon') boxUV(g, 12);
    out.set(role, g);
  }
  return out;
}

const tube = (pts, r, seg = 24) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), seg, r, 6, false);

function buildExtras() {
  const R = roleMaterials();
  const parts = new THREE.Group();
  const add = (geo, role, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, R[role]);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    parts.add(m);
    return m;
  };

  // Chasis bajo la carrocería (tapa la vista a través de los pasos de rueda)
  add(new THREE.BoxGeometry(1.5, 0.36, 3.75), 'trim', 0, 0.36, -0.03);

  // --- Faros: carcasa negra brillante, firma LED en "palo de hockey" y dos proyectores
  for (const sx of [-1, 1]) {
    const p = surfacePoint(0.952, 0.6), p2 = surfacePoint(0.975, 0.6);
    const slope = Math.atan2(p.y - p2.y, p2.z - p.z);
    const hg = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.26, 6, 14), R.headHousing);
    housing.rotation.z = Math.PI / 2;
    housing.scale.set(0.62, 1, 1.9);
    hg.add(housing);
    // firma LED sobre la cara frontal de la carcasa
    hg.add(new THREE.Mesh(tube([[-0.15 * sx, 0.012, 0.094], [-0.02 * sx, 0.015, 0.104], [0.11 * sx, 0.014, 0.102], [0.158 * sx, 0.004, 0.088], [0.168 * sx, -0.016, 0.07]], 0.0062), R.head));
    for (const px of [-0.07, 0.03]) {
      const lens = new THREE.Mesh(new THREE.SphereGeometry(0.019, 16, 10), R.head);
      lens.scale.z = 0.55;
      lens.position.set(px * sx, -0.014, 0.1);
      hg.add(lens);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.005, 6, 18), R.chrome);
      ring.position.set(px * sx, -0.014, 0.101);
      hg.add(ring);
    }
    hg.position.set(sx * p.x, p.y - 0.028, p.z);
    hg.rotation.x = slope;
    hg.rotation.y = sx * 0.28;
    parts.add(hg);
  }

  // --- Pilotos traseros: lente ahumada, barra LED y grupos en "C"
  const tailY = 0.735;
  let tz = 0;
  for (let t = 0; t < 0.1; t += 0.001) { if (yTop(t) >= tailY) { tz = ZR + t * LEN; break; } }
  add(new THREE.BoxGeometry(1.4, 0.07, 0.03), 'headHousing', 0, tailY - 0.004, tz - 0.004);
  add(tube([[-0.66, tailY + 0.012, tz - 0.022], [0, tailY + 0.016, tz - 0.024], [0.66, tailY + 0.012, tz - 0.022]], 0.0055, 30), 'tail');
  for (const sx of [-1, 1]) {
    add(tube([[0.5 * sx, tailY + 0.024, tz - 0.024], [0.64 * sx, tailY + 0.024, tz - 0.022], [0.69 * sx, tailY, tz - 0.018], [0.64 * sx, tailY - 0.026, tz - 0.022], [0.5 * sx, tailY - 0.026, tz - 0.024]], 0.007, 20), 'tail');
  }
  // Luz de lluvia (FIA) en el difusor
  add(new THREE.BoxGeometry(0.1, 0.045, 0.025), 'tail', 0, 0.43, ZR - 0.03);

  // --- Alerón GT con soportes "cuello de cisne", placas laterales y gurney
  const wingZ = ZR + 0.33, deckY = yTop(0.07), wingY = deckY + 0.25;
  add(new THREE.BoxGeometry(1.8, 0.026, 0.33), 'carbon', 0, wingY, wingZ, -0.12);
  add(new THREE.BoxGeometry(1.8, 0.032, 0.008), 'carbon', 0, wingY + 0.02, wingZ - 0.163);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.012, 0.26, 0.46), 'carbon', sx * 0.9, wingY - 0.03, wingZ - 0.02);
    add(new THREE.BoxGeometry(0.018, 0.3, 0.085), 'carbon', sx * 0.42, deckY + 0.13, wingZ - 0.09, 0.28);
    add(new THREE.BoxGeometry(0.018, 0.03, 0.13), 'carbon', sx * 0.42, wingY + 0.03, wingZ - 0.03);
  }

  // --- Espejos aerodinámicos con brazo de carbono
  for (const sx of [-1, 1]) {
    const t = 0.655, zz = ZR + t * LEN, x0 = wBody(t), y0 = yBelt(t);
    const m = add(new THREE.SphereGeometry(1, 18, 12), 'paintSolid', sx * (x0 + 0.085), y0 + 0.09, zz);
    m.scale.set(0.1, 0.052, 0.07);
    add(new THREE.CircleGeometry(1, 18), 'chrome', sx * (x0 + 0.085), y0 + 0.09, zz - 0.071, 0, Math.PI).scale.set(0.085, 0.042, 1);
    add(new THREE.BoxGeometry(0.11, 0.016, 0.04), 'carbon', sx * (x0 + 0.02), y0 + 0.06, zz + 0.012, 0, 0, sx * 0.35);
  }

  // --- Escapes (cuatro salidas) entre las aletas del difusor
  const exG = new THREE.CylinderGeometry(0.042, 0.046, 0.14, 18, 1, true);
  exG.rotateX(Math.PI / 2);
  for (const x of [-0.42, -0.3, 0.3, 0.42]) {
    add(exG, 'chrome', x, 0.33, ZR + 0.02);
    add(new THREE.CircleGeometry(0.04, 14), 'trim', x, 0.33, ZR + 0.05, 0, Math.PI);
  }
  // --- Difusor: piso inclinado y aletas verticales
  add(new THREE.BoxGeometry(1.3, 0.01, 0.3), 'carbon', 0, 0.19, ZR + 0.15, -0.18);
  for (const x of [-0.62, -0.18, -0.06, 0.06, 0.18, 0.62]) add(new THREE.BoxGeometry(0.01, 0.12, 0.22), 'carbon', x, 0.25, ZR + 0.1);

  // --- Splitter delantero con placas laterales y aletas (canards)
  add(new THREE.BoxGeometry(1.68, 0.016, 0.2), 'carbon', 0, 0.165, LEN / 2 - 0.24);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.01, 0.05, 0.19), 'carbon', sx * 0.84, 0.185, LEN / 2 - 0.24);
    add(new THREE.BoxGeometry(0.16, 0.006, 0.09), 'carbon', sx * 0.87, 0.33, 2.0, 0, sx * 0.45, sx * 0.3);
    add(new THREE.BoxGeometry(0.12, 0.006, 0.08), 'carbon', sx * 0.86, 0.41, 1.96, 0, sx * 0.45, sx * 0.3);
    // faldones laterales
    add(new THREE.BoxGeometry(0.08, 0.05, 1.62), 'carbon', sx * 0.875, 0.19, -0.05);
  }

  // --- Ganchos de remolque rojos y antena de techo
  add(new THREE.TorusGeometry(0.032, 0.009, 6, 14), 'accent', 0.42, 0.24, LEN / 2 + 0.02, 0, Math.PI / 2);
  add(new THREE.BoxGeometry(0.05, 0.012, 0.09), 'accent', 0.42, 0.24, LEN / 2 - 0.02);
  add(new THREE.TorusGeometry(0.032, 0.009, 6, 14), 'accent', -0.5, 0.38, ZR - 0.04, 0, Math.PI / 2);
  const fin = add(new THREE.SphereGeometry(1, 12, 8), 'trim', 0, yTop(0.43) + 0.012, ZR + 0.43 * LEN);
  fin.scale.set(0.014, 0.03, 0.075);

  return mergeByRole(parts);
}

// ---------------------------------------------------------------- auto completo
// livery: { base, stripe, accent, number, ink, board, numberColor } (colores CSS)
export function createCar({ livery, rim = 'silver', caliper = 0xd01818, shadowTex = null } = {}) {
  const S = sharedMaterials();
  const paint = paintMaterial(livery);
  const paintSolid = new THREE.MeshPhysicalMaterial({ color: livery.base, metalness: 0.35, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.35 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a12, emissiveIntensity: 3.2, roughness: 0.3 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: caliper, roughness: 0.4, metalness: 0.25 });

  const root = new THREE.Group();          // posición y rumbo (sobre el suelo)
  const body = new THREE.Group();          // cabeceo y balanceo
  const inner = new THREE.Group();
  body.position.y = 0.42; inner.position.y = -0.42;
  root.add(body); body.add(inner);

  const bodyMesh = new THREE.Mesh(buildBody(), [paint, S.glass, S.trim, S.fascia]);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  inner.add(bodyMesh);

  // Piezas fijas: se construyen una vez y se fusionan por material
  // para reducir las llamadas de dibujo por auto.
  if (!_extras) _extras = buildExtras();
  const roleMat = { trim: S.trim, carbon: S.carbon, chrome: S.chrome, paintSolid, head: S.head, headHousing: S.headHousing, tail, accent: S.accent };
  for (const [role, geo] of _extras) {
    const m = new THREE.Mesh(geo, roleMat[role]);
    m.castShadow = role === 'carbon' || role === 'paintSolid';
    inner.add(m);
  }

  // Ruedas
  const WG = wheelGeos();
  const rimMat = rim === 'dark' ? S.rimDark : rim === 'gold' ? S.rimGold : S.rim;
  const wheels = [];
  for (const [zAxle, front] of [[AXLE_F, true], [AXLE_R, false]]) {
    for (const side of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * CAR.halfTrack, WHEEL_R, zAxle);
      const flip = new THREE.Group();
      if (side < 0) flip.rotation.y = Math.PI;
      pivot.add(flip);
      const spin = new THREE.Group();
      flip.add(spin);
      const tire = new THREE.Mesh(WG.tire, S.rubber);
      tire.castShadow = true;
      spin.add(tire);
      spin.add(new THREE.Mesh(WG.rimDisc, rimMat));
      flip.add(new THREE.Mesh(WG.caliper, caliperMat));
      root.add(pivot);
      wheels.push({ pivot, spin, side, front });
    }
  }

  // Sombra de contacto (oscurece el suelo bajo el auto)
  if (shadowTex) {
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 5.2), new THREE.MeshBasicMaterial({
      map: shadowTex, transparent: true, opacity: 0.8, depthWrite: false, color: 0x000000,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    sm.material.alphaMap = shadowTex;
    sm.rotation.x = -Math.PI / 2;
    sm.position.y = 0.03;
    sm.renderOrder = 1;
    root.add(sm);
  }

  return {
    root, body, wheels, paint, tail,
    // Cambia la decoración (p. ej. al elegir otro color en el menú)
    setLivery(next) {
      const old = paint.map;
      paint.map = makeLiveryTexture(next);
      old.dispose();
      paintSolid.color.set(next.base);
    },
    // Reflejos del paisaje real del circuito en pintura, vidrios y metales
    setEnvMap(env) {
      for (const m of [paint, paintSolid]) { m.envMap = env; m.needsUpdate = true; }
    },
    update(v) {
      root.position.set(v.x, v.y + v.bump, v.z);
      root.rotation.y = v.heading;
      body.rotation.set(v.pitch + v.bump * 0.4, 0, v.roll, 'YXZ');
      for (const w of wheels) {
        if (w.front) w.pivot.rotation.y = v.steerAngle;
        const a = w.front ? v.wheelRotF : v.wheelRotR;
        w.spin.rotation.x = w.side > 0 ? a : -a;
      }
      const braking = v.gear === -1 ? v.input.throttle > 0.1 : v.input.brake > 0.1;
      tail.emissiveIntensity = braking ? 15 : 3.2;
    },
  };
}

// Reflejos compartidos (vidrios, carbono, cromados, llantas)
export function setSharedCarEnvMap(env) {
  const S = sharedMaterials();
  for (const k of ['glass', 'carbon', 'chrome', 'rim', 'rimDark', 'rimGold', 'headHousing', 'fascia']) {
    S[k].envMap = env; S[k].needsUpdate = true;
  }
}

export function disposeCarShared() { _bodyGeo = null; _wheelGeos = null; _shared = null; _extras = null; }
