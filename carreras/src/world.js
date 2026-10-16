// Construcción del escenario: pista, pianos, pasto, muros, alambrado,
// terreno, árboles, tribunas, boxes, pórtico de largada y carteles.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeNoise2D, fbm, mulberry32 } from './noise.js';
import * as TX from './textures.js';
import { RACE } from './config.js';
import { Vegetation } from './vegetation.js';

const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- helpers de geometría
// Cinta a lo largo de la pista entre muestras i0..i1 (incluidas, con vuelta).
// `lats` = desplazamientos laterales; `yAt(i, lat)` = altura; `uv(i, lat, k)`.
function ribbon(track, i0, count, lats, yAt, uvAt) {
  const N = track.N;
  const rows = count + 1, cols = lats.length;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  let p = 0, q = 0;
  for (let r = 0; r < rows; r++) {
    const i = (i0 + r) % N;
    for (let k = 0; k < cols; k++) {
      const lat = lats[k];
      const x = track.px[i] + track.nx[i] * lat;
      const z = track.pz[i] + track.nz[i] * lat;
      pos[p++] = x; pos[p++] = yAt(i, lat); pos[p++] = z;
      const [u, v] = uvAt(i, lat, k, r, x, z);
      uv[q++] = u; uv[q++] = v;
    }
  }
  const idx = [];
  for (let r = 0; r < count; r++) for (let k = 0; k < cols - 1; k++) {
    const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Extruye un perfil (lat, h) a lo largo de la pista. side=+1 izquierda, -1 derecha.
function extrude(track, i0, count, profile, side, baseY, uvAt) {
  const N = track.N;
  const prof = side > 0 ? profile : [...profile].reverse();
  const cols = prof.length, rows = count + 1;
  const pos = [], uv = [];
  for (let r = 0; r < rows; r++) {
    const i = (i0 + r) % N;
    for (let k = 0; k < cols; k++) {
      const { lat, h } = prof[k];
      const L = lat * side;
      pos.push(track.px[i] + track.nx[i] * L, baseY(i) + h, track.pz[i] + track.nz[i] * L);
      uv.push(...uvAt(i, r, prof[k], k));
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
    // `break` marca una arista viva entre dos puntos del perfil original
    if (side > 0 ? prof[k].break : prof[k + 1].break) continue;
    const a = r * cols + k, b = a + 1, c = a + cols, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function runs(flags, N) {
  // tramos contiguos de muestras con flag=1 (con vuelta)
  const out = [];
  let start = -1;
  for (let k = 0; k < N * 2; k++) {
    const i = k % N;
    if (flags[i] && start < 0) start = k;
    if ((!flags[i] || k === N * 2 - 1) && start >= 0) {
      if (start < N) out.push({ i0: start, count: k - start });
      start = -1;
      if (k >= N) break;
    }
  }
  if (out.length === 0 && flags[0]) out.push({ i0: 0, count: N });
  return out;
}

// ---------------------------------------------------------------- mundo
export class World {
  constructor(scene, track, renderer, quality) {
    this.scene = scene;
    this.track = track;
    this.aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
    this.quality = quality;
    this.noise = makeNoise2D(1234);
    this.startLights = [];
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  // Construye todo por etapas (permite mostrar progreso de carga).
  *build() {
    this.buildTextures(); yield 'Texturas';
    this.buildRoad(); yield 'Asfalto';
    this.buildBarriers(); yield 'Muros';
    this.buildDistanceField(); yield 'Terreno';
    this.buildTerrain(); yield 'Terreno';
    this.buildTrees(); yield 'Árboles';
    this.buildStructures(); yield 'Tribunas';
  }

  buildTextures() {
    const a = this.aniso;
    this.tex = {
      asphalt: TX.makeAsphalt(a, this.quality === 'baja' ? 512 : 1024),
      grass: TX.makeGrass(a),
      curb: TX.makeCurb(a),
      barrier: TX.makeBarrier(a),
      concrete: TX.makeConcrete(a),
      fence: TX.makeFence(),
      ads: TX.makeAds(a),
      crowd: TX.makeCrowd(a),
      checker: TX.makeChecker(),
      boards: TX.makeDistanceBoards(),
      facade: TX.makeFacade(a),
    };
    const t = this.tex;
    t.fence.repeat.set(1, 1);
    this.mat = {
      asphalt: new THREE.MeshStandardMaterial({
        map: t.asphalt.map, normalMap: t.asphalt.normalMap, roughnessMap: t.asphalt.roughnessMap,
        normalScale: new THREE.Vector2(0.9, 0.9), roughness: 1, metalness: 0,
      }),
      grass: new THREE.MeshStandardMaterial({ map: t.grass.map, normalMap: t.grass.normalMap, roughness: 1, metalness: 0, color: 0xffffff }),
      curb: new THREE.MeshStandardMaterial({ map: t.curb, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      barrier: new THREE.MeshStandardMaterial({ map: t.barrier, roughness: 0.85 }),
      concrete: new THREE.MeshStandardMaterial({ map: t.concrete, roughness: 0.9 }),
      fence: new THREE.MeshStandardMaterial({ map: t.fence, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6, transparent: false }),
      metal: new THREE.MeshStandardMaterial({ color: 0x8d949b, roughness: 0.45, metalness: 0.8 }),
      darkMetal: new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: 0.5, metalness: 0.6 }),
      ads: new THREE.MeshStandardMaterial({ map: t.ads, roughness: 0.55 }),
      crowd: new THREE.MeshStandardMaterial({ map: t.crowd, roughness: 0.9 }),
      checker: new THREE.MeshStandardMaterial({ map: t.checker, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      paint: new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
      boards: new THREE.MeshStandardMaterial({ map: t.boards, roughness: 0.6 }),
      facade: new THREE.MeshStandardMaterial({ map: t.facade, roughness: 0.6, metalness: 0.1 }),
      roof: new THREE.MeshStandardMaterial({ color: 0xe9eaec, roughness: 0.5, metalness: 0.3 }),
      glassDark: new THREE.MeshStandardMaterial({ color: 0x1b242e, roughness: 0.1, metalness: 0.9 }),
    };
  }

  buildRoad() {
    const tr = this.track, d = tr.def, N = tr.N;
    const S = (i) => tr.s[i];
    const Lroad = d.roadHalf * 2;
    // Asfalto: una sola cinta cerrada (N muestras + 1 para cerrar)
    const road = ribbon(tr, 0, N, [-d.roadHalf, -d.roadHalf / 2, 0, d.roadHalf / 2, d.roadHalf],
      (i) => tr.py[i],
      (i, lat, k, r) => [(lat + d.roadHalf) / Lroad, (r === N ? tr.length : S(i)) / Lroad]);
    const roadMesh = new THREE.Mesh(road, this.mat.asphalt);
    roadMesh.receiveShadow = true;
    this.group.add(roadMesh);

    // Pasto de escape a ambos lados (hasta detrás del muro)
    const edge = d.wallOffset + 3.5;
    const grassLats = [d.roadHalf - 0.35, d.roadHalf + d.curbWidth, d.roadHalf + d.curbWidth + 2.5, (d.wallOffset + d.roadHalf) / 2 + 1, d.wallOffset, edge];
    const gy = (i, lat) => tr.py[i] + tr.crossHeight(Math.min(Math.abs(lat), edge), tr.curb[i] === 1) - (Math.abs(lat) < d.roadHalf ? 0.04 : 0) - 0.012;
    const uvW = (i, lat, k, r, x, z) => [x / 5, z / 5];
    for (const side of [1, -1]) {
      const lats = side > 0 ? grassLats : grassLats.map(l => -l).reverse();
      const g = ribbon(tr, 0, N, lats, gy, uvW);
      const m = new THREE.Mesh(g, this.mat.grass);
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Pianos (en las curvas, ambos lados)
    const curbGeos = [];
    for (const run of runs(tr.curb, N)) {
      for (const side of [1, -1]) {
        const lats = [d.roadHalf - 0.05, d.roadHalf + d.curbWidth * 0.55, d.roadHalf + d.curbWidth].map(l => l * side);
        if (side < 0) lats.reverse();
        const g = ribbon(tr, run.i0, run.count, lats,
          (i, lat) => tr.py[i] + tr.crossHeight(lat, true) + 0.006,
          (i, lat, k, r) => [(Math.abs(lat) - d.roadHalf) / d.curbWidth, (tr.s[run.i0] + r * tr.ds) / 2.6]);
        curbGeos.push(g);
      }
    }
    if (curbGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(curbGeos), this.mat.curb);
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Línea de largada a cuadros + marcas de la parrilla
    const decals = [];
    const quadAt = (s, lat, len, wid, u0 = 0, u1 = 1) => {
      const p = tr.pointAt(s, lat);
      const fx = Math.sin(p.heading), fz = Math.cos(p.heading), lx = fz, lz = -fx;
      const y = p.y + 0.012;
      const pts = [[-len / 2, -wid / 2], [len / 2, -wid / 2], [len / 2, wid / 2], [-len / 2, wid / 2]];
      const pos = [], uv = [[u0, 0], [u0, 1], [u1, 1], [u1, 0]];
      for (const [a, b] of pts) pos.push(p.x + fx * a + lx * b, y, p.z + fz * a + lz * b);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv.flat(), 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      return g;
    };
    const checker = new THREE.Mesh(quadAt(0, 0, 1.6, d.roadHalf * 2), this.mat.checker);
    checker.receiveShadow = true;
    this.group.add(checker);
    const L = tr.length;
    for (let k = 0; k < RACE.cars; k++) {
      const s = L - 10 - k * RACE.gridSpacing + 2.6;
      const lat = (k % 2 === 0 ? 1 : -1) * RACE.gridLateral;
      decals.push(quadAt(s, lat, 0.22, 2.4));
      decals.push(quadAt(s - 1.0, lat + 1.2, 2.0, 0.14));
      decals.push(quadAt(s - 1.0, lat - 1.2, 2.0, 0.14));
    }
    const paint = new THREE.Mesh(mergeGeometries(decals), this.mat.paint);
    paint.receiveShadow = true;
    this.group.add(paint);
  }

  buildBarriers() {
    const tr = this.track, d = tr.def, N = tr.N;
    const W = d.wallOffset;
    const baseY = (i) => tr.py[i] + tr.crossHeight(W, false) - 0.12;
    const hWall = 1.12;
    const profile = [
      { lat: W, h: 0 }, { lat: W, h: hWall - 0.08, v: 0.93 }, { lat: W + 0.08, h: hWall, v: 1, break: true },
      { lat: W + 0.08, h: hWall }, { lat: W + 0.5, h: hWall, break: true },
      { lat: W + 0.5, h: hWall }, { lat: W + 0.5, h: 0 },
    ];
    const geos = [];
    for (const side of [1, -1]) {
      const g = extrude(tr, 0, N, profile, side, baseY, (i, r, pt) => [(r === N ? tr.length : tr.s[i]) / 8, pt.v !== undefined ? pt.v : pt.h / hWall]);
      geos.push(g);
    }
    const walls = new THREE.Mesh(mergeGeometries(geos), this.mat.barrier);
    walls.castShadow = true; walls.receiveShadow = true;
    this.group.add(walls);

    // Alambrado sobre el muro + postes
    if (this.quality !== 'baja') {
      const fenceGeos = [];
      for (const side of [1, -1]) {
        const g = extrude(tr, 0, N, [{ lat: W + 0.3, h: hWall - 0.02 }, { lat: W + 0.3, h: hWall + 2.6 }], side, baseY,
          (i, r, pt) => [(r === N ? tr.length : tr.s[i]) / 1.2, (pt.h - hWall) / 1.2]);
        fenceGeos.push(g);
      }
      const fence = new THREE.Mesh(mergeGeometries(fenceGeos), this.mat.fence);
      this.group.add(fence);
      const step = 5;
      const count = Math.floor(tr.length / step) * 2;
      const post = new THREE.CylinderGeometry(0.05, 0.05, 2.7, 6);
      post.translate(0, hWall + 1.3, 0);
      const inst = new THREE.InstancedMesh(post, this.mat.metal, count);
      const m4 = new THREE.Matrix4();
      let n = 0;
      for (let s = 0; s < tr.length - 1 && n < count - 1; s += step) {
        for (const side of [1, -1]) {
          const p = tr.pointAt(s, (W + 0.32) * side);
          m4.makeTranslation(p.x, baseY(p.idx), p.z);
          inst.setMatrixAt(n++, m4);
        }
      }
      inst.count = n;
      this.group.add(inst);
    }

    // Tableros de publicidad sobre la cara interna del muro
    const adGeos = [];
    const rnd = mulberry32(99);
    const boardLen = 6, adSections = [[0, 460], [tr.length - 260, tr.length], [700, 1000], [1900, 2300], [2600, 2900]];
    for (const [s0, s1] of adSections) {
      for (let s = s0; s < s1 - boardLen; s += boardLen + 0.3) {
        for (const side of [1, -1]) {
          const ad = Math.floor(rnd() * TX.AD_COUNT);
          const a = tr.pointAt(s, (W - 0.04) * side), b = tr.pointAt(s + boardLen, (W - 0.04) * side);
          const ya = baseY(a.idx) + 0.1, yb = baseY(b.idx) + 0.1;
          const v0 = 1 - (ad + 1) / TX.AD_COUNT, v1 = 1 - ad / TX.AD_COUNT;
          const pos = side > 0
            ? [a.x, ya, a.z, b.x, yb, b.z, b.x, yb + 0.95, b.z, a.x, ya + 0.95, a.z]
            : [b.x, yb, b.z, a.x, ya, a.z, a.x, ya + 0.95, a.z, b.x, yb + 0.95, b.z];
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute([0, v0, 1, v0, 1, v1, 0, v1], 2));
          g.setIndex([0, 1, 2, 0, 2, 3]);
          g.computeVertexNormals();
          adGeos.push(g);
        }
      }
    }
    const ads = new THREE.Mesh(mergeGeometries(adGeos), this.mat.ads);
    ads.receiveShadow = true;
    this.group.add(ads);
  }

  // Campo de distancias a la pista (y altura de la pista más cercana).
  buildDistanceField() {
    const tr = this.track, b = tr.bounds;
    const M = 260, cell = 6;
    const x0 = b.minX - M, z0 = b.minZ - M;
    const nx = Math.ceil((b.maxX - b.minX + 2 * M) / cell) + 1;
    const nz = Math.ceil((b.maxZ - b.minZ + 2 * M) / cell) + 1;
    const dist = new Float32Array(nx * nz).fill(1e9);
    const roadY = new Float32Array(nx * nz);
    const R = 150, rc = Math.ceil(R / cell);
    for (let i = 0; i < tr.N; i++) {
      const px = tr.px[i], pz = tr.pz[i], py = tr.py[i];
      const ci = Math.round((px - x0) / cell), cj = Math.round((pz - z0) / cell);
      for (let dj = -rc; dj <= rc; dj++) {
        const j = cj + dj; if (j < 0 || j >= nz) continue;
        for (let di = -rc; di <= rc; di++) {
          const ii = ci + di; if (ii < 0 || ii >= nx) continue;
          const wx = x0 + ii * cell, wz = z0 + j * cell;
          const dd = Math.hypot(wx - px, wz - pz);
          const k = j * nx + ii;
          if (dd < dist[k]) { dist[k] = dd; roadY[k] = py; }
        }
      }
    }
    this.df = { x0, z0, nx, nz, cell, dist, roadY };
    // Puntos para la altura base suave (interpolación por distancia inversa)
    this.idwPts = [];
    for (let i = 0; i < tr.N; i += 8) this.idwPts.push([tr.px[i], tr.pz[i], tr.py[i]]);
    let avg = 0; for (const p of this.idwPts) avg += p[2]; this.avgY = avg / this.idwPts.length;
  }

  sampleDF(x, z) {
    const f = this.df;
    const fx = (x - f.x0) / f.cell, fz = (z - f.z0) / f.cell;
    if (fx < 0 || fz < 0 || fx >= f.nx - 1 || fz >= f.nz - 1) return { dist: 1e9, roadY: this.avgY };
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const k = j * f.nx + i;
    const lerp2 = (A) => (A[k] * (1 - tx) + A[k + 1] * tx) * (1 - tz) + (A[k + f.nx] * (1 - tx) + A[k + f.nx + 1] * tx) * tz;
    return { dist: lerp2(f.dist), roadY: lerp2(f.roadY) };
  }

  // Altura del terreno natural + aplanado cerca de la pista.
  heightAt(x, z) {
    const tr = this.track, W = tr.def.wallOffset;
    const { dist, roadY } = this.sampleDF(x, z);
    let num = 0, den = 0;
    for (const p of this.idwPts) {
      const dx = x - p[0], dz = z - p[1];
      const w = 1 / (dx * dx + dz * dz + 900);
      num += w * p[2]; den += w;
    }
    const w0 = 1 / (1200 * 1200);
    const base = (num + w0 * this.avgY) / (den + w0);
    const n = this.noise;
    const hills = fbm(n, x / 420, z / 420, 4) * 16 + fbm(n, x / 110 + 7, z / 110, 3) * 3;
    const b = tr.bounds;
    const r = Math.hypot((x - b.cx) / 1.25, z - b.cz);
    const rn = fbm(n, x / 900 + 3, z / 900 - 5, 5);
    const ridge = 1 - Math.sqrt(rn * rn + 0.004);   // cresta redondeada: evita aristas filosas
    const mountains = smoothstep(950, 2300, r) * (ridge * ridge * 330 + 40);
    const natural = base + hills * smoothstep(35, 240, dist) + mountains;
    const flatten = 1 - smoothstep(W + 16, W + 30, dist);
    return natural + (roadY - 0.55 - natural) * flatten;
  }

  buildTerrain() {
    const tr = this.track, b = tr.bounds;
    const SEG = this.quality === 'baja' ? 200 : 288;
    const inner = 1150, outer = 4600, split = 0.62;
    const map = (t) => {
      const a = Math.abs(t);
      const v = a <= split ? a / split * inner : inner + Math.pow((a - split) / (1 - split), 2) * (outer - inner);
      return Math.sign(t) * v;
    };
    const verts = (SEG + 1) * (SEG + 1);
    const pos = new Float32Array(verts * 3), uv = new Float32Array(verts * 2), col = new Float32Array(verts * 3);
    const n = this.noise;
    let p = 0, q = 0, c = 0;
    for (let j = 0; j <= SEG; j++) {
      const z = b.cz + map(j / SEG * 2 - 1);
      for (let i = 0; i <= SEG; i++) {
        const x = b.cx + map(i / SEG * 2 - 1) * 1.2;
        const y = this.heightAt(x, z);
        pos[p++] = x; pos[p++] = y; pos[p++] = z;
        uv[q++] = x / 5; uv[q++] = z / 5;
        // variación de color: parches secos, zonas más oscuras, roca en altura
        const v1 = fbm(n, x / 60, z / 60, 3), v2 = fbm(n, x / 13 + 11, z / 13, 2);
        const rock = smoothstep(60, 180, y - this.avgY);
        let R = 1 + v1 * 0.12 + v2 * 0.05, G = 1 + v1 * 0.06 + v2 * 0.05, B = 1 + v1 * 0.02;
        const dry = smoothstep(0.15, 0.5, v1);
        R += dry * 0.25; G += dry * 0.08;
        // suelo de bosque más oscuro donde se agrupan los árboles
        const forest = smoothstep(-0.18, 0.05, fbm(n, x / 180, z / 180, 2)) * smoothstep(30, 90, this.sampleDF(x, z).dist);
        R *= 1 - forest * 0.22; G *= 1 - forest * 0.16; B *= 1 - forest * 0.18;
        R = R * (1 - rock) + 1.45 * rock; G = G * (1 - rock) + 1.22 * rock; B = B * (1 - rock) + 1.25 * rock;
        col[c++] = R * 0.92; col[c++] = G * 0.92; col[c++] = B * 0.92;
      }
    }
    const idx = new Uint32Array(SEG * SEG * 6);
    let t = 0;
    for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
      const a = j * (SEG + 1) + i, b2 = a + 1, c2 = a + SEG + 1, d = c2 + 1;
      idx[t++] = a; idx[t++] = c2; idx[t++] = b2;
      idx[t++] = b2; idx[t++] = c2; idx[t++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mat = this.mat.grass.clone();
    mat.vertexColors = true;
    // Roca en laderas empinadas (por píxel, con la normal geométrica)
    mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 nW = normalize( ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).xyz );
          float rock = smoothstep( 0.62, 0.86, 1.0 - nW.y );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.18, 0.17, 0.155 ) * ( 0.75 + 0.3 * vColor.g ), rock * 0.85 );
        }`);
    };
    mat.customProgramCacheKey = () => 'asfalto-terrain';
    const terrain = new THREE.Mesh(g, mat);
    terrain.receiveShadow = true;
    this.group.add(terrain);
    this.terrain = terrain;
  }

  buildTrees() {
    const tr = this.track, b = tr.bounds, W = tr.def.wallOffset;
    const rnd = mulberry32(4242);
    const q = this.quality;
    const treeCount = q === 'baja' ? 1300 : q === 'media' ? 2400 : 3400;
    const bushCount = q === 'baja' ? 400 : q === 'media' ? 900 : 1300;
    const items = [];
    const tints = {
      spruce: () => [0.37 + rnd() * 0.04, 0.12 + rnd() * 0.1, 0.84 + rnd() * 0.12],
      pine: () => [0.29 + rnd() * 0.05, 0.15 + rnd() * 0.1, 0.86 + rnd() * 0.1],
      oak: () => [0.2 + rnd() * 0.1, 0.18 + rnd() * 0.15, 0.82 + rnd() * 0.16],
      poplar: () => [0.19 + rnd() * 0.05, 0.2 + rnd() * 0.12, 0.88 + rnd() * 0.1],
      bush: () => [0.22 + rnd() * 0.08, 0.15 + rnd() * 0.12, 0.8 + rnd() * 0.14],
    };
    const heights = { spruce: [12, 22], pine: [14, 23], oak: [9, 15], poplar: [16, 24], bush: [1.4, 3.2] };
    const add = (species, x, z, sink = 0.4) => {
      const [h0, h1] = heights[species];
      items.push({ species, x, y: this.heightAt(x, z) - sink, z, h: h0 + rnd() * (h1 - h0), widthMul: 0.85 + rnd() * 0.3, rot: rnd() * Math.PI, tint: tints[species]() });
    };

    // Hileras de álamos junto a dos rectas (como en los caminos reales)
    for (const [s0, s1, side] of [[1250, 1500, 1], [2400, 2760, -1]]) {
      for (let s = s0; s < s1; s += 8 + rnd() * 3) {
        const p = tr.pointAt(s, side * (W + 19 + rnd() * 2));
        if (!this.excluded(p.x, p.z)) add('poplar', p.x, p.z);
      }
    }
    // Bosques y árboles sueltos. Casi la mitad se reserva para la franja
    // junto a la pista (lo que se ve al manejar); el resto, hacia el horizonte.
    const sx = b.maxX - b.minX + 1400, sz = b.maxZ - b.minZ + 1400;
    const nearQuota = Math.floor(treeCount * 0.45);
    let tries = 0, near = 0;
    while (near < nearQuota && tries < nearQuota * 40) {
      tries++;
      const x = b.minX - 110 + rnd() * (b.maxX - b.minX + 220), z = b.minZ - 110 + rnd() * (b.maxZ - b.minZ + 220);
      const { dist } = this.sampleDF(x, z);
      if (dist < W + 10 || dist > 95) continue;
      if (fbm(this.noise, x / 70 + 5, z / 70, 2) < -0.25) continue;   // claros entre grupos
      if (this.excluded(x, z)) continue;
      const r = rnd();
      add(r < 0.36 ? 'oak' : r < 0.64 ? 'pine' : r < 0.95 ? 'spruce' : 'poplar', x, z);
      near++;
    }
    tries = 0;
    while (items.length < treeCount && tries < treeCount * 25) {
      tries++;
      const x = b.minX - 700 + rnd() * sx, z = b.minZ - 700 + rnd() * sz;
      const { dist } = this.sampleDF(x, z);
      if (dist < 95) continue;
      // más densidad cerca de la pista (sensación de velocidad)
      const keep = dist < 120 ? 0.9 : dist < 350 ? 0.55 : 0.28;
      if (rnd() > keep) continue;
      // bosquecitos: agrupar con ruido
      if (fbm(this.noise, x / 180, z / 180, 2) < -0.15 && dist > 60) continue;
      if (this.excluded(x, z)) continue;
      // coníferas en las laderas altas; mezcla con robles en el llano
      const alt = this.heightAt(x, z) - this.avgY;
      const r = rnd();
      const species = alt > 30 ? (r < 0.6 ? 'spruce' : 'pine') : r < 0.38 ? 'oak' : r < 0.66 ? 'pine' : r < 0.94 ? 'spruce' : 'poplar';
      add(species, x, z);
    }
    // Arbustos al pie de los muros y en los bordes del bosque
    let bushes = 0;
    tries = 0;
    while (bushes < bushCount && tries < bushCount * 40) {
      tries++;
      const x = b.minX - 300 + rnd() * (sx - 800), z = b.minZ - 300 + rnd() * (sz - 800);
      const { dist } = this.sampleDF(x, z);
      if (dist < W + 3 || dist > 160) continue;
      if (dist > W + 18 && fbm(this.noise, x / 180, z / 180, 2) < -0.1) continue;
      if (fbm(this.noise, x / 40 + 9, z / 40, 2) < 0) continue;   // matorrales agrupados
      if (this.excluded(x, z)) continue;
      add('bush', x, z, 0.2);
      bushes++;
    }

    this.vegetation = new Vegetation(items, { castShadow: q !== 'baja', alphaToCoverage: q !== 'baja' });
    this.group.add(this.vegetation.mesh);
    this.treeCount = items.length;
  }

  excluded(x, z) {
    // zona de tribunas y boxes junto a la recta principal
    return x > -330 && x < 360 && z > -90 && z < 75;
  }

  buildStructures() {
    const tr = this.track, W = tr.def.wallOffset;
    const g = this.group;
    const y0 = tr.py[0];

    // --- Tribunas (lado exterior de la recta: -z) ---
    const stand = (x0, len) => {
      const grp = new THREE.Group();
      const rows = 12, depth = 0.9, rise = 0.55;
      const zFront = -(W + 7);
      const risers = [], treads = [];
      for (let k = 0; k < rows; k++) {
        const r = new THREE.PlaneGeometry(len, rise);
        r.rotateY(0); // mira hacia +z (la pista)
        const rb = new THREE.BufferGeometry().copy(r);
        rb.translate(x0 + len / 2, y0 + 0.6 + k * rise + rise / 2, zFront - k * depth);
        const uvA = rb.attributes.uv;
        for (let q = 0; q < uvA.count; q++) { uvA.setX(q, uvA.getX(q) * len / 24); uvA.setY(q, (uvA.getY(q) + k % 8) / 8); }
        risers.push(rb);
        const t = new THREE.PlaneGeometry(len, depth);
        t.rotateX(-Math.PI / 2);
        t.translate(x0 + len / 2, y0 + 0.6 + (k + 1) * rise, zFront - k * depth - depth / 2);
        treads.push(t);
      }
      const rm = new THREE.Mesh(mergeGeometries(risers), this.mat.crowd);
      const tm = new THREE.Mesh(mergeGeometries(treads), this.mat.concrete);
      rm.receiveShadow = tm.receiveShadow = true;
      grp.add(rm, tm);
      // estructura trasera y techo
      const hTop = 0.6 + rows * rise;
      const back = new THREE.Mesh(new THREE.BoxGeometry(len, hTop + 5, 0.4), this.mat.concrete);
      back.position.set(x0 + len / 2, y0 + (hTop + 5) / 2, zFront - rows * depth - 0.2);
      back.castShadow = true;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.35, rows * depth + 4), this.mat.roof);
      roof.position.set(x0 + len / 2, y0 + hTop + 5, zFront - rows * depth / 2 + 1.2);
      roof.rotation.x = -0.06;
      roof.castShadow = true;
      grp.add(back, roof);
      const cols = [];
      for (let x = x0; x <= x0 + len; x += 15) {
        const col = new THREE.BoxGeometry(0.35, hTop + 5, 0.35);
        col.translate(x, y0 + (hTop + 5) / 2, zFront - rows * depth + 1);
        cols.push(col);
      }
      grp.add(new THREE.Mesh(mergeGeometries(cols), this.mat.metal));
      g.add(grp);
    };
    stand(-250, 150);
    stand(-60, 150);
    stand(130, 110);

    // --- Edificio de boxes (lado interior: +z) ---
    const pitLen = 260;
    const pit = new THREE.Mesh(new THREE.BoxGeometry(pitLen, 9, 14), [
      this.mat.concrete, this.mat.concrete, this.mat.roof, this.mat.concrete, this.mat.concrete, this.mat.facade,
    ]);
    // la cara -z (índice 5) mira hacia la pista
    const uvA = pit.geometry.attributes.uv;
    for (let k = 20; k < 24; k++) uvA.setX(k, uvA.getX(k) * pitLen / 32);
    pit.position.set(-150 + pitLen / 2 - 40, y0 + 4.5, W + 30);
    pit.castShadow = true; pit.receiveShadow = true;
    g.add(pit);
    // voladizo del techo
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(pitLen, 0.4, 6), this.mat.roof);
    canopy.position.set(pit.position.x, y0 + 9.2, W + 21);
    canopy.castShadow = true;
    g.add(canopy);

    // --- Pórtico de largada con semáforo ---
    const gantry = new THREE.Group();
    const p0 = tr.pointAt(-4, 0);
    const span = tr.def.roadHalf * 2 + 5;
    const frame = [];
    const beamG = new THREE.BoxGeometry(span, 1.1, 1.0); beamG.translate(0, 7.6, 0); frame.push(beamG);
    for (const sx of [-1, 1]) { const pg = new THREE.BoxGeometry(0.7, 8.2, 0.7); pg.translate(sx * span / 2, 4.1, 0); frame.push(pg); }
    for (let k = 0; k < 5; k++) { const hg = new THREE.BoxGeometry(0.62, 1.55, 0.35); hg.translate((k - 2) * 0.85, 6.35, -0.45); frame.push(hg); }
    const frameMesh = new THREE.Mesh(mergeGeometries(frame), this.mat.darkMetal);
    frameMesh.castShadow = true;
    gantry.add(frameMesh);
    // Cada columna del semáforo (2 lámparas) comparte material para encenderse junta
    for (let k = 0; k < 5; k++) {
      const x = (k - 2) * 0.85;
      const mat = new THREE.MeshStandardMaterial({ color: 0x220404, emissive: 0xff1010, emissiveIntensity: 0, roughness: 0.3 });
      const pair = [];
      for (let rr = 0; rr < 2; rr++) {
        const lg = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 20);
        lg.rotateX(Math.PI / 2);
        lg.translate(x, 6.7 - rr * 0.62, -0.64);
        pair.push(lg);
      }
      gantry.add(new THREE.Mesh(mergeGeometries(pair), mat));
      this.startLights.push(mat);
    }
    gantry.position.set(p0.x, p0.y, p0.z);
    gantry.rotation.y = p0.heading;
    g.add(gantry);

    // --- Carteles de distancia antes de las frenadas fuertes ---
    const boardGeos = [];
    for (const zn of tr.brakingZones()) {
      if (zn.drop < 150 / 3.6) continue;
      const apexS = tr.s[zn.apex];
      const turnSign = Math.sign(tr.curv[zn.apex]) || 1;
      const side = -turnSign; // lado exterior de la curva
      const turnIn = apexS - 35;
      [300, 200, 100].forEach((dd, k) => {
        const p = tr.pointAt(turnIn - dd, side * (tr.def.roadHalf + 3.2));
        const plane = new THREE.PlaneGeometry(1.1, 1.1);
        const uvB = plane.attributes.uv;
        for (let q = 0; q < uvB.count; q++) uvB.setX(q, (uvB.getX(q) + k) / 3);
        plane.rotateY(p.heading + Math.PI);  // mira hacia los autos que vienen
        plane.translate(p.x, p.y + 1.25, p.z);
        boardGeos.push(plane);
        const postG = new THREE.BoxGeometry(0.08, 0.8, 0.08);
        postG.translate(p.x, p.y + 0.35, p.z);
        this.boardPosts = this.boardPosts || [];
        this.boardPosts.push(postG);
      });
    }
    if (boardGeos.length) {
      const boards = new THREE.Mesh(mergeGeometries(boardGeos), this.mat.boards);
      g.add(boards);
      g.add(new THREE.Mesh(mergeGeometries(this.boardPosts), this.mat.metal));
    }
  }

  setStartLights(n) {
    this.startLights.forEach((m, k) => {
      const on = k < n;
      m.emissiveIntensity = on ? 22 : 0;
      m.color.setHex(on ? 0xff2222 : 0x220404);
    });
  }
}
