// Vegetación: 4 especies de árboles + arbustos pintados por código en un
// atlas, dibujados en UNA sola llamada (InstancedMesh). Cada instancia elige
// su región del atlas, tiene su tono, se mece con el viento y sus hojas se
// iluminan a contraluz cuando la cámara mira hacia el sol.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const AW = 2048, AH = 1024;

// Regiones del atlas (px) y proporción ancho/alto en el mundo.
export const SPECIES = {
  spruce: { x: 0, w: 384, y: 0, h: 1024 },
  pine: { x: 384, w: 512, y: 0, h: 1024 },
  oak: { x: 896, w: 640, y: 0, h: 1024 },
  poplar: { x: 1536, w: 256, y: 0, h: 1024 },
  bush: { x: 1792, w: 256, y: 768, h: 256 },
};
for (const s of Object.values(SPECIES)) {
  s.aspect = s.w / s.h;
  // región en coordenadas de textura (v = 0 abajo)
  s.uv = [s.x / AW, s.w / AW, 1 - (s.y + s.h) / AH, s.h / AH];
}

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${Math.max(0, Math.min(100, l))}%,${a})`;

// ---------------------------------------------------------------- pintado
function leaf(ctx, x, y, rx, ry, rot, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fill();
}

// Racimo de hojas con volumen: sombra interior, luz desde arriba a la
// izquierda, variación de tono y pequeños huecos.
function leafCluster(ctx, rnd, cx, cy, r, { hue = 100, sat = 40, base = 18, range = 26, count = 300, size = 5, depth = 0.5, stretch = 1 }) {
  // sombra interior opaca (sin bordes semitransparentes que formen halos)
  ctx.fillStyle = hsl(hue, sat * 0.8, base * 0.5);
  ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.08, r * 0.78, r * 0.78 * stretch, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, rr = Math.pow(rnd(), 0.6) * r;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * stretch;
    const dx = (x - cx) / r, dy = (y - cy) / (r * stretch);
    let light = 0.55 - dx * 0.25 - dy * 0.45 + (depth - 0.5) * 0.5 + (rnd() - 0.5) * 0.5;
    light = Math.max(0, Math.min(1, light));
    const s = size * (0.6 + rnd() * 0.8);
    leaf(ctx, x, y, s, s * (0.45 + rnd() * 0.3), rnd() * Math.PI, hsl(hue + (rnd() - 0.5) * 14, sat + (rnd() - 0.5) * 12, base + light * range));
  }
}

function bark(ctx, x0, y0, x1, y1, w0, w1, c0, c1) {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, c0); g.addColorStop(1, c1);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0 - w0 / 2, y0); ctx.lineTo(x0 + w0 / 2, y0);
  ctx.lineTo(x1 + w1 / 2, y1); ctx.lineTo(x1 - w1 / 2, y1);
  ctx.closePath(); ctx.fill();
  // sombra lateral del tronco
  const s = ctx.createLinearGradient(x0 - w0 / 2, 0, x0 + w0 / 2, 0);
  s.addColorStop(0, 'rgba(255,255,255,0.08)'); s.addColorStop(0.6, 'rgba(0,0,0,0)'); s.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = s; ctx.fill();
}

function paintSpruce(ctx, rnd) {
  const { w } = SPECIES.spruce, cx = w / 2;
  bark(ctx, cx, 1024, cx, 840, 22, 14, '#2e231b', '#3e3024');
  const tiers = [];
  let y = 26;
  while (y < 930) { tiers.push({ y, half: (14 + (y - 26) / 904 * 166) * (0.8 + rnd() * 0.4) }); y += 14 + rnd() * 12 + (y / 930) * 12; }
  // Núcleo oscuro escalonado detrás de las ramas: mantiene la silueta opaca
  // también de lejos (en las versiones reducidas de la textura las agujas
  // finas se diluyen y el abeto quedaba como una espiga angosta).
  ctx.fillStyle = hsl(150, 30, 8);
  ctx.beginPath(); ctx.moveTo(cx, 30);
  for (const t of tiers) { ctx.lineTo(cx + t.half * 0.7, t.y + t.half * 0.15 + 8); ctx.lineTo(cx + t.half * 0.42, t.y + t.half * 0.15 + 16); }
  for (let i = tiers.length - 1; i >= 0; i--) { const t = tiers[i]; ctx.lineTo(cx - t.half * 0.42, t.y + t.half * 0.15 + 16); ctx.lineTo(cx - t.half * 0.7, t.y + t.half * 0.15 + 8); }
  ctx.closePath(); ctx.fill();
  // Cada piso es una rama gruesa y colgante hecha de agujas cortas.
  // Se dibuja de abajo hacia arriba: las ramas altas caen sobre las de abajo.
  for (let i = tiers.length - 1; i >= 0; i--) {
    const ty = tiers[i].y, f = (ty - 26) / 904, half = tiers[i].half;
    const n = 70 + Math.floor(330 * f);
    for (let pass = 0; pass < 2; pass++) {            // 0 = capa en sombra, 1 = capa iluminada
      for (let k = 0; k < (pass ? n : n * 0.7); k++) {
        const side = rnd() < 0.5 ? -1 : 1;
        const reach = Math.pow(rnd(), 0.7);
        const x0 = cx + side * reach * half;
        const y0 = ty + reach * reach * half * 0.3 + (rnd() - 0.5) * 14 * (0.4 + reach) + (pass ? 0 : 7);
        const a = 0.35 + rnd() * 0.9, len = 6 + rnd() * 11;
        const L = pass ? 13 + reach * 13 + (1 - f) * 5 + rnd() * 9 + (side < 0 ? 3 : -2) : 6 + rnd() * 5;
        ctx.strokeStyle = hsl(148 + rnd() * 16, 32 + rnd() * 14, L);
        ctx.lineWidth = 1.3 + rnd() * 1.8;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + side * Math.cos(a) * len, y0 + Math.sin(a) * len); ctx.stroke();
      }
    }
  }
}

function paintPine(ctx, rnd) {
  const { w } = SPECIES.pine, cx = w / 2;
  bark(ctx, cx, 1024, cx + 4, 220, 34, 12, '#4a3b30', '#b8693c');
  ctx.strokeStyle = 'rgba(30,18,10,0.55)'; ctx.lineWidth = 1.2;
  for (let k = 0; k < 40; k++) { const yy = 700 + rnd() * 320; ctx.beginPath(); ctx.moveTo(cx - 12 + rnd() * 24, yy); ctx.lineTo(cx - 12 + rnd() * 24, yy + 8 + rnd() * 20); ctx.stroke(); }
  // Copa ovalada e irregular que baja hasta ~3/4 de la altura (tronco
  // visible ~27 %): angosta arriba, ancha al medio, alternando lados.
  const clumps = [];
  for (let k = 0; k < 22; k++) {
    const f = k / 21;                                  // 0 arriba, 1 abajo
    const rx = 46 + rnd() * 38 + 14 * Math.sin(f * Math.PI);
    const env = 205 * Math.sin(0.35 + f * 2.25);       // media anchura de la copa
    const side = k % 3 === 2 ? 0 : k % 2 ? 1 : -1;
    const x = cx + side * (0.3 + 0.7 * rnd()) * env * 0.85 + (rnd() - 0.5) * 30;
    clumps.push({ x: Math.max(rx + 18, Math.min(w - rx - 18, x)), y: 72 + f * 600 + (rnd() - 0.5) * 44, rx, ry: rx * (0.5 + rnd() * 0.2), d: rnd() });
  }
  ctx.lineCap = 'round';
  for (const c of clumps) {
    ctx.strokeStyle = '#6b4128'; ctx.lineWidth = 5 + rnd() * 4;
    ctx.beginPath(); ctx.moveTo(cx + 2, Math.min(740, c.y + 90 + rnd() * 50)); ctx.quadraticCurveTo((cx + c.x) / 2, c.y + 40, c.x, c.y + 8); ctx.stroke();
  }
  clumps.sort((a, b) => a.d - b.d);
  for (const c of clumps) {
    const area = (c.rx / 75) * (c.rx / 75);
    for (let pass = 0; pass < 2; pass++) {
      const n = (pass ? 380 : 220) * area;
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
        const x = c.x + Math.cos(a) * rr * c.rx, y = c.y + Math.sin(a) * rr * c.ry + (pass ? 0 : c.ry * 0.25);
        const up = (c.y - y) / c.ry;
        const L = pass ? 14 + (up + 1) * 9 + c.d * 7 + rnd() * 8 : 6 + rnd() * 5;
        ctx.strokeStyle = hsl(118 + rnd() * 18, 30 + rnd() * 12, L);
        ctx.lineWidth = 1.2 + rnd() * 1.6;
        const ang = -Math.PI / 2 + (rnd() - 0.5) * 2.6, len = 6 + rnd() * 10;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); ctx.stroke();
      }
    }
  }
}

function paintOak(ctx, rnd) {
  const { w } = SPECIES.oak, cx = w / 2;
  bark(ctx, cx, 1024, cx - 6, 680, 46, 26, '#3a2c22', '#5a4636');
  // ramas principales
  ctx.lineCap = 'round';
  const forks = [[-150, 400], [-60, 300], [40, 270], [140, 380], [-200, 540], [190, 520]];
  for (const [dx, y] of forks) {
    ctx.strokeStyle = '#4a382b'; ctx.lineWidth = 9 + rnd() * 6;
    ctx.beginPath(); ctx.moveTo(cx - 4, 720); ctx.quadraticCurveTo(cx + dx * 0.4, (720 + y) / 2, cx + dx, y); ctx.stroke();
  }
  // copa: racimos ordenados del fondo (oscuros) al frente (claros); baja
  // hasta ~70 % de la altura para que el tronco no quede como un palo largo
  const clusters = [];
  for (let k = 0; k < 40; k++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
    clusters.push({ x: cx + Math.cos(a) * rr * 235, y: 410 + Math.sin(a) * rr * 280, r: 48 + rnd() * 52, d: rnd() });
  }
  clusters.sort((a, b) => a.d - b.d);
  for (const c of clusters) {
    leafCluster(ctx, rnd, c.x, c.y, c.r, { hue: 92 + rnd() * 18, sat: 38, base: 13 + c.d * 6, range: 24, count: 340, size: 6, depth: c.d, stretch: 0.85 });
  }
  // huecos por donde se ve el cielo
  ctx.globalCompositeOperation = 'destination-out';
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2, rr = 0.35 + rnd() * 0.6;
    ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * rr * 230, 410 + Math.sin(a) * rr * 270, 4 + rnd() * 9, 3 + rnd() * 7, rnd() * 3, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function paintPoplar(ctx, rnd) {
  const { w } = SPECIES.poplar, cx = w / 2;
  bark(ctx, cx, 1024, cx, 820, 18, 10, '#4b4136', '#6a5c4c');
  for (let i = 0; i < 6200; i++) {
    const f = rnd();                                     // 0 arriba, 1 abajo
    const y = 26 + f * 880;
    const half = Math.sin(Math.min(1, f * 1.05) * Math.PI) * 78 + 6;
    const x = cx + (rnd() * 2 - 1) * half * Math.sqrt(rnd());
    const dx = (x - cx) / (half + 1);
    const L = 20 + (1 - f) * 8 - dx * 8 + (rnd() - 0.5) * 16;
    leaf(ctx, x, y, 3 + rnd() * 3, 1.8 + rnd() * 1.5, -1.2 + rnd() * 0.6, hsl(78 + rnd() * 18, 42, L));
  }
}

function paintBush(ctx, rnd) {
  const { w, h } = SPECIES.bush;
  for (let k = 0; k < 8; k++) {
    const d = k / 7;
    leafCluster(ctx, rnd, w * (0.2 + rnd() * 0.6), h * (0.5 + rnd() * 0.25), 42 + rnd() * 34, { hue: 88 + rnd() * 25, sat: 36, base: 12 + d * 7, range: 22, count: 220, size: 5, depth: d, stretch: 0.8 });
  }
}

export function makeVegetationAtlas() {
  const c = document.createElement('canvas');
  c.width = AW; c.height = AH;
  const ctx = c.getContext('2d');
  const paint = { spruce: paintSpruce, pine: paintPine, oak: paintOak, poplar: paintPoplar, bush: paintBush };
  let seed = 11;
  for (const [name, fn] of Object.entries(paint)) {
    const s = SPECIES[name];
    ctx.save();
    ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.clip();
    ctx.translate(s.x, s.y + s.h - (name === 'bush' ? 256 : 1024));
    fn(ctx, mulberry32(seed += 7));
    ctx.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
}

// ---------------------------------------------------------------- geometría y material
// Tres planos cruzados a 60° con normales "esféricas" (luz con volumen).
function crossGeometry() {
  const parts = [0, Math.PI / 3, 2 * Math.PI / 3].map((rot) => {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    g.rotateY(rot);
    return g;
  });
  const pos = [], uv = [], nor = [], idx = [];
  for (const g of parts) {
    const o = pos.length / 3, P = g.attributes.position, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      pos.push(x, y, z); uv.push(U.getX(i), U.getY(i));
      const n = new THREE.Vector3(x * 1.6, (y - 0.45) * 1.2 + 0.3, z * 1.6).normalize();
      nor.push(n.x, n.y, n.z);
    }
    for (const k of g.index.array) idx.push(o + k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

const VERT_UV = `#include <uv_vertex>
  #ifdef USE_MAP
    vMapUv = vec2( aUv.x + uv.x * aUv.y, aUv.z + uv.y * aUv.w );
  #endif`;
const VERT_WIND = `#include <begin_vertex>
  {
    float hh = position.y * position.y;
    vec3 ip = vec3( instanceMatrix[ 3 ][ 0 ], 0.0, instanceMatrix[ 3 ][ 2 ] );
    float ph = uTime * 1.35 + ip.x * 0.071 + ip.z * 0.053;
    transformed.x += ( sin( ph ) * 0.013 + sin( ph * 2.7 ) * 0.004 ) * hh;
    transformed.z += cos( ph * 0.83 ) * 0.009 * hh;
  }`;

function patchVertex(shader, uniforms) {
  shader.uniforms.uTime = uniforms.uTime;
  shader.vertexShader = 'attribute vec4 aUv;\nuniform float uTime;\n' + shader.vertexShader
    .replace('#include <uv_vertex>', VERT_UV)
    .replace('#include <begin_vertex>', VERT_WIND);
}

export class Vegetation {
  constructor(instances, { castShadow = true, alphaToCoverage = true } = {}) {
    const atlas = makeVegetationAtlas();
    const geo = crossGeometry();
    const n = instances.length;
    const aUv = new Float32Array(n * 4);
    instances.forEach((it, k) => aUv.set(SPECIES[it.species].uv, k * 4));
    geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(aUv, 4));

    this.uniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1.0, 0.84, 0.6).multiplyScalar(1.0) },
    };
    const U = this.uniforms;
    const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.92, metalness: 0 });
    mat.alphaToCoverage = alphaToCoverage;
    mat.onBeforeCompile = (sh) => {
      patchVertex(sh, U);
      sh.uniforms.uSunDir = U.uSunDir;
      sh.uniforms.uSunCol = U.uSunCol;
      sh.fragmentShader = 'uniform vec3 uSunDir;\nuniform vec3 uSunCol;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          // hojas a contraluz: la luz del sol atraviesa la copa hacia la cámara
          vec3 sv = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
          float back = pow( max( dot( normalize( -vViewPosition ), sv ), 0.0 ), 6.0 );
          totalEmissiveRadiance += diffuseColor.rgb * uSunCol * back;
        }`);
    };
    mat.customProgramCacheKey = () => 'asfalto-vegetation';
    this.material = mat;

    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
    depth.onBeforeCompile = (sh) => patchVertex(sh, U);
    depth.customProgramCacheKey = () => 'asfalto-vegetation-depth';

    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    instances.forEach((it, k) => {
      const s = SPECIES[it.species];
      const wdt = it.h * s.aspect * it.widthMul;
      q.setFromAxisAngle(up, it.rot);
      m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, new THREE.Vector3(wdt, it.h, wdt));
      mesh.setMatrixAt(k, m4);
      col.setHSL(it.tint[0], it.tint[1], it.tint[2]);
      mesh.setColorAt(k, col);
    });
    mesh.customDepthMaterial = depth;
    mesh.castShadow = castShadow;
    mesh.receiveShadow = false;
    mesh.computeBoundingSphere();
    this.mesh = mesh;
  }

  setSun(dir) { this.uniforms.uSunDir.value.copy(dir).normalize(); }
  update(time) { this.uniforms.uTime.value = time; }
  setAlphaToCoverage(on) { if (this.material.alphaToCoverage !== on) { this.material.alphaToCoverage = on; this.material.needsUpdate = true; } }
}
