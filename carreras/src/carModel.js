// Modelo 3D procedural de un deportivo genérico.
// La carrocería es un "loft": secciones transversales suaves a lo largo del
// auto, definidas por perfiles (altura del techo, línea de cintura, ancho…).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR } from './config.js';

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
function buildBody() {
  if (_bodyGeo) return _bodyGeo;
  const ST = 156;
  const secs = [];
  for (let i = 0; i <= ST; i++) {
    const u = i / ST;
    const t = u * 0.8 + (0.5 - 0.5 * Math.cos(u * Math.PI)) * 0.2;   // algo más densa en los extremos
    secs.push({ t, ...section(t) });
  }
  const half = secs[0].pts.length;       // puntos de la mitad derecha (incluye A y G)
  const M = 2 * (half - 1);               // anillo completo
  const pos = [];
  const ringBand = [];
  for (const s of secs) {
    for (let j = 0; j < M; j++) {
      let x, y;
      if (j < half) { [x, y] = s.pts[j]; }
      else { const jj = M - j; [x, y] = s.pts[jj]; x = -x; }
      pos.push(x, y, s.z);
    }
  }
  for (let j = 0; j < M; j++) ringBand.push(j < half - 1 ? secs[0].band[j] : secs[0].band[M - j - 1]);

  const paint = [], glass = [], trim = [];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  for (let i = 0; i < ST; i++) {
    const tc = (secs[i].t + secs[i + 1].t) / 2;
    for (let j = 0; j < M; j++) {
      const j2 = (j + 1) % M;
      const a = i * M + j, b = i * M + j2, c = (i + 1) * M + j, d = (i + 1) * M + j2;
      const yc = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1] + pos[d * 3 + 1]) / 4;
      const band = ringBand[j];
      const sgm = Math.floor(band / 100), k = band % 100;
      let target = paint;
      if (sgm <= 1) target = trim;
      else if (sgm === 4) {
        // ventanilla lateral: bordes verticales (siguen la malla, sin escalones)
        if (tc > 0.372 && tc < 0.64 && k > 0) target = glass;
        else if (tc > 0.365 && tc < 0.647 && k > 0) target = trim;
      } else if (sgm === 5) {
        if (tc > 0.578 && tc < 0.688) target = k === 0 ? trim : glass;
        else if (tc > 0.305 && tc < 0.445) target = k === 0 ? trim : glass;
      }
      target.push(a, b, c, b, d, c);
    }
  }
  // Tapas delantera y trasera (negras: toma de aire y difusor)
  // Duplicar los anillos extremos para aristas vivas en las tapas
  const dupRing = (i) => {
    const base = pos.length / 3;
    for (let j = 0; j < M; j++) pos.push(pos[(i * M + j) * 3], pos[(i * M + j) * 3 + 1], pos[(i * M + j) * 3 + 2]);
    return base;
  };
  const capRing = (i, front) => {
    const base = dupRing(i);
    const s = secs[i];
    let cy = 0; for (const [, y] of s.pts) cy += y; cy /= s.pts.length;
    const center = pos.length / 3;
    pos.push(0, cy, s.z + (front ? 0.02 : -0.02));
    for (let j = 0; j < M; j++) {
      const a = base + j, b = base + (j + 1) % M;
      if (front) trim.push(center, a, b); else trim.push(center, b, a);
    }
  };
  capRing(0, false);
  capRing(ST, true);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const index = [...paint, ...glass, ...trim];
  g.setIndex(index);
  g.addGroup(0, paint.length, 0);
  g.addGroup(paint.length, glass.length, 1);
  g.addGroup(paint.length + glass.length, trim.length, 2);
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
let _wheelGeos = null;
function wheelGeos() {
  if (_wheelGeos) return _wheelGeos;
  const R = WHEEL_R, W = 0.27, rimR = 0.245;
  const prof = [
    [rimR - 0.005, -W / 2 + 0.01], [rimR + 0.04, -W / 2 - 0.004], [R - 0.022, -W / 2 + 0.004], [R - 0.004, -W / 2 + 0.03],
    [R, -W / 4], [R + 0.002, 0], [R, W / 4], [R - 0.004, W / 2 - 0.03], [R - 0.022, W / 2 - 0.004],
    [rimR + 0.04, W / 2 + 0.004], [rimR - 0.005, W / 2 - 0.01],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(prof, 40);
  tire.rotateZ(Math.PI / 2);

  const rimParts = [];
  const barrel = new THREE.CylinderGeometry(rimR - 0.01, rimR - 0.01, W - 0.03, 36, 1, true);
  barrel.rotateZ(Math.PI / 2);
  rimParts.push(barrel);
  const lip = new THREE.TorusGeometry(rimR - 0.012, 0.012, 6, 32);
  lip.rotateY(Math.PI / 2); lip.translate(W / 2 - 0.02, 0, 0);
  rimParts.push(lip);
  const hub = new THREE.CylinderGeometry(0.06, 0.07, 0.05, 20);
  hub.rotateZ(Math.PI / 2); hub.translate(W / 2 - 0.035, 0, 0);
  rimParts.push(hub);
  for (let k = 0; k < 10; k++) {
    const sp = new THREE.BoxGeometry(0.03, rimR - 0.065, k % 2 ? 0.026 : 0.034);
    sp.translate(0, (rimR - 0.065) / 2 + 0.055, 0);
    // radios levemente cóncavos: inclinados hacia adentro en el borde
    sp.rotateZ(-0.12);
    sp.translate(W / 2 - 0.035, 0, 0);
    sp.rotateX((k / 10) * Math.PI * 2);
    rimParts.push(sp);
  }
  const rim = mergeGeometries(rimParts.map(g => g.toNonIndexed()));

  const disc = new THREE.CylinderGeometry(0.19, 0.19, 0.028, 32);
  disc.rotateZ(Math.PI / 2); disc.translate(0.02, 0, 0);
  const caliper = new THREE.BoxGeometry(0.06, 0.15, 0.1);
  caliper.translate(0.045, 0.14, -0.06);
  const rimDisc = mergeGeometries([rim, disc.toNonIndexed()]);
  _wheelGeos = { tire, rim, disc, caliper, rimDisc };
  return _wheelGeos;
}

// ---------------------------------------------------------------- materiales compartidos
let _shared = null;
function sharedMaterials() {
  if (_shared) return _shared;
  _shared = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0e12, metalness: 0.0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.55, metalness: 0.1 }),
    carbon: new THREE.MeshPhysicalMaterial({ color: 0x141518, roughness: 0.35, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.88, metalness: 0, side: THREE.DoubleSide }),
    rim: new THREE.MeshStandardMaterial({ color: 0x9da3a9, roughness: 0.26, metalness: 1.0, side: THREE.DoubleSide }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.3, metalness: 1.0, side: THREE.DoubleSide }),
    disc: new THREE.MeshStandardMaterial({ color: 0x55585c, roughness: 0.45, metalness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.12, metalness: 1.0 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfefff, emissiveIntensity: 16, roughness: 0.2 }),
    headHousing: new THREE.MeshPhysicalMaterial({ color: 0x0d1014, metalness: 0.6, roughness: 0.15, clearcoat: 1 }),
    shadow: null,
  };
  return _shared;
}

// ---------------------------------------------------------------- fusión de piezas
let _extras = null;
function roleMaterials() {
  const R = {};
  for (const k of ['trim', 'carbon', 'chrome', 'paint', 'head', 'headHousing', 'tail']) R[k] = new THREE.MeshBasicMaterial({ name: k });
  return R;
}
function mergeByRole(group) {
  group.updateMatrixWorld(true);
  const byRole = new Map();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const role = o.material.name;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(g);
  });
  const out = new Map();
  for (const [role, list] of byRole) out.set(role, mergeGeometries(list));
  return out;
}

// ---------------------------------------------------------------- auto completo
export function createCar({ color = 0xc4121c, rim = 'silver', caliper = 0xd01818, shadowTex = null } = {}) {
  const S = sharedMaterials();
  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.25,
  });
  const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a12, emissiveIntensity: 3.2, roughness: 0.3 });
  const caliperMat = new THREE.MeshStandardMaterial({ color: caliper, roughness: 0.45, metalness: 0.2 });

  const root = new THREE.Group();          // posición y rumbo (sobre el suelo)
  const body = new THREE.Group();          // cabeceo y balanceo
  const inner = new THREE.Group();
  body.position.y = 0.42; inner.position.y = -0.42;
  root.add(body); body.add(inner);

  const bodyMesh = new THREE.Mesh(buildBody(), [paint, S.glass, S.trim]);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  inner.add(bodyMesh);

  // Piezas fijas (faros, alerón, espejos, escapes…): se construyen una vez y se
  // fusionan por material para reducir las llamadas de dibujo por auto.
  if (!_extras) {
    const R = roleMaterials();
    const parts = new THREE.Group();
    // Chasis bajo la carrocería (tapa la vista a través de los pasos de rueda)
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.36, 3.75), R.trim);
    chassis.position.set(0, 0.36, -0.03);
    parts.add(chassis);

    // Faros delanteros
    for (const sx of [-1, 1]) {
      const p = surfacePoint(0.952, 0.6);
      const p2 = surfacePoint(0.975, 0.6);
      const slope = Math.atan2(p.y - p2.y, p2.z - p.z);
      const housing = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.26, 6, 12), R.headHousing);
      housing.rotation.z = Math.PI / 2;
      housing.scale.set(0.7, 1, 2.4);
      const hg = new THREE.Group();
      hg.add(housing);
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.018, 0.05), R.head);
      led.position.set(0, 0.018, 0.02);
      hg.add(led);
      const proj = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), R.head);
      proj.position.set(sx * -0.07, -0.01, 0.07);
      hg.add(proj);
      hg.position.set(sx * p.x, p.y - 0.01, p.z);
      hg.rotation.x = slope;
      hg.rotation.y = sx * 0.28;
      parts.add(hg);
    }

    // Barra de luz trasera + grupos ópticos
    const tailY = 0.735;
    let tz = 0.0;
    for (let t = 0; t < 0.1; t += 0.001) { if (yTop(t) >= tailY) { tz = ZR + t * LEN; break; } }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.032, 0.05), R.tail);
    bar.position.set(0, tailY, tz - 0.012);
    parts.add(bar);
    for (const sx of [-1, 1]) {
      const cl = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.075, 0.06), R.tail);
      cl.position.set(sx * 0.62, tailY - 0.015, tz + 0.004);
      cl.rotation.y = -sx * 0.18;
      parts.add(cl);
    }

    // Alerón trasero de carbono
    const wingZ = ZR + 0.3;
    const deckY = yTop(0.067);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.028, 0.3), R.carbon);
    wing.position.set(0, deckY + 0.2, wingZ);
    wing.rotation.x = -0.1;
    wing.castShadow = true;
    parts.add(wing);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.12), R.carbon);
      post.position.set(sx * 0.48, deckY + 0.09, wingZ + 0.02);
      parts.add(post);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.14, 0.36), R.carbon);
      plate.position.set(sx * 0.85, deckY + 0.19, wingZ);
      parts.add(plate);
    }

    // Espejos retrovisores
    for (const sx of [-1, 1]) {
      const t = 0.655, zz = ZR + t * LEN;
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), R.paint);
      m.scale.set(0.085, 0.052, 0.075);
      m.position.set(sx * (wBody(t) + 0.075), yBelt(t) + 0.085, zz);
      m.castShadow = true;
      parts.add(m);
      const glassM = new THREE.Mesh(new THREE.CircleGeometry(1, 16), R.chrome);
      glassM.scale.set(0.07, 0.04, 1);
      glassM.position.set(sx * (wBody(t) + 0.075), yBelt(t) + 0.085, zz - 0.076);
      glassM.rotation.y = Math.PI;
      parts.add(glassM);
      const stalk = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.04), R.trim);
      stalk.position.set(sx * (wBody(t) + 0.005), yBelt(t) + 0.06, zz + 0.01);
      parts.add(stalk);
    }

    // Escapes (cuatro salidas)
    const exG = new THREE.CylinderGeometry(0.042, 0.046, 0.14, 16, 1, true);
    exG.rotateX(Math.PI / 2);
    for (const x of [-0.42, -0.3, 0.3, 0.42]) {
      const e = new THREE.Mesh(exG, R.chrome);
      e.position.set(x, 0.33, ZR + 0.02);
      parts.add(e);
      const inside = new THREE.Mesh(new THREE.CircleGeometry(0.04, 12), R.trim);
      inside.position.set(x, 0.33, ZR + 0.05);
      inside.rotation.y = Math.PI;
      parts.add(inside);
    }
    // Splitter delantero
    const split = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.022, 0.2), R.trim);
    split.position.set(0, 0.19, LEN / 2 - 0.16);
    parts.add(split);
    _extras = mergeByRole(parts);
  }
  const roleMat = { trim: S.trim, carbon: S.carbon, chrome: S.chrome, paint, head: S.head, headHousing: S.headHousing, tail };
  for (const [role, geo] of _extras) {
    const m = new THREE.Mesh(geo, roleMat[role]);
    m.castShadow = role === 'carbon' || role === 'paint';
    inner.add(m);
  }

  // Ruedas
  const WG = wheelGeos();
  const rimMat = rim === 'dark' ? S.rimDark : S.rim;
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

export function disposeCarShared() { _bodyGeo = null; _wheelGeos = null; _shared = null; _extras = null; }
