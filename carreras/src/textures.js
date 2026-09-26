// Texturas procedurales dibujadas en <canvas> al iniciar.
// Evita descargar imágenes: todo el juego pesa unos pocos cientos de KB.
import * as THREE from 'three';
import { makePeriodicNoise, periodicFbm, mulberry32 } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function toTexture(c, { srgb = true, repeat = true, aniso = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// Normal map a partir de un campo de alturas periódico.
function normalFromHeight(h, w, hh, strength) {
  const c = canvas(w, hh);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, hh);
  const d = img.data;
  for (let y = 0; y < hh; y++) {
    const ym = ((y - 1 + hh) % hh) * w, yp = ((y + 1) % hh) * w, yc = y * w;
    for (let x = 0; x < w; x++) {
      const xm = (x - 1 + w) % w, xp = (x + 1) % w;
      const dx = (h[yc + xp] - h[yc + xm]) * strength;
      const dy = (h[yp + x] - h[ym + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yc + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------------------------------------------------------- Asfalto
// u = ancho de la pista (13 m), v = largo (13 m por repetición).
export function makeAsphalt(aniso, size = 1024) {
  const W = size, H = size;
  const pn = makePeriodicNoise(11);
  const rnd = mulberry32(5);
  const height = new Float32Array(W * H);
  const cCol = canvas(W, H), cRough = canvas(W, H);
  const ictx = cCol.getContext('2d'), rctx = cRough.getContext('2d');
  const img = ictx.createImageData(W, H), rim = rctx.createImageData(W, H);
  const d = img.data, r = rim.data;
  const lineW = 0.024, lineIn = 0.006;
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      const large = periodicFbm(pn, u, v, 6, 3);
      const mid = periodicFbm(pn, u + 0.37, v + 0.11, 48, 2);
      const grain = rnd() * 2 - 1;
      const stone = grain > 0.86 ? 1 : grain < -0.9 ? -1 : 0;
      const idx = y * W + x;
      height[idx] = mid * 0.5 + grain * 0.35 + stone * 0.4;
      // Goma acumulada en la zona central de la pista (trazada)
      const rubber = Math.exp(-((u - 0.5) ** 2) / 0.04) * 0.45 + Math.exp(-((u - 0.28) ** 2) / 0.005) * 0.2 + Math.exp(-((u - 0.72) ** 2) / 0.005) * 0.2;
      let g = 70 + large * 12 + mid * 10 + grain * 13 + stone * 20 - rubber * 14;
      let rough = 0.9 - rubber * 0.18 + grain * 0.04;
      // Líneas blancas de borde (gastadas)
      const edge = Math.min(u, 1 - u);
      if (edge > lineIn && edge < lineIn + lineW) {
        const wear = periodicFbm(pn, u * 3, v, 24, 3);
        if (wear > -0.35 || grain > 0.2) { g = 206 + grain * 16 + large * 10; rough = 0.62; height[idx] = 0.6 + grain * 0.05; }
      }
      const i = idx * 4;
      d[i] = g * 0.98; d[i + 1] = g; d[i + 2] = g * 1.04; d[i + 3] = 255;
      const rv = Math.max(0, Math.min(255, rough * 255));
      r[i] = rv; r[i + 1] = rv; r[i + 2] = rv; r[i + 3] = 255;
    }
  }
  ictx.putImageData(img, 0, 0);
  rctx.putImageData(rim, 0, 0);
  const nC = normalFromHeight(height, W, H, 1.6);
  return {
    map: toTexture(cCol, { aniso }),
    roughnessMap: toTexture(cRough, { srgb: false, aniso }),
    normalMap: toTexture(nC, { srgb: false, aniso }),
  };
}

// ---------------------------------------------------------------- Pasto
export function makeGrass(aniso, size = 512) {
  const W = size, H = size;
  const pn = makePeriodicNoise(23);
  const rnd = mulberry32(9);
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const n1 = periodicFbm(pn, u, v, 4, 4);
      const n2 = periodicFbm(pn, u + 0.5, v + 0.5, 32, 3);
      const grain = rnd();
      const idx = y * W + x;
      height[idx] = n2 * 0.6 + grain * 0.5;
      const t = Math.max(0, Math.min(1, 0.5 + n1 * 0.9));
      let R = 52 + t * 38 + n2 * 10, G = 78 + t * 36 + n2 * 14, B = 30 + t * 12;
      const k = 0.75 + grain * 0.4;
      const i = idx * 4;
      d[i] = R * k; d[i + 1] = G * k; d[i + 2] = B * k; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Briznas: trazos cortos con colores variados (dibujados con envoltura)
  ctx.lineCap = 'round';
  for (let n = 0; n < 9000; n++) {
    const x = rnd() * W, y = rnd() * H;
    const a = rnd() * Math.PI * 2, len = 2 + rnd() * 6;
    const dry = rnd() < 0.08;
    const l = 30 + rnd() * 40;
    ctx.strokeStyle = dry ? `hsl(${45 + rnd() * 15},${35 + rnd() * 20}%,${40 + rnd() * 20}%)` : `hsl(${80 + rnd() * 30},${35 + rnd() * 25}%,${l * 0.6}%)`;
    ctx.lineWidth = 0.8 + rnd() * 1.2;
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
    for (const ox of [0, -W, W]) for (const oy of [0, -H, H]) {
      if ((ox && Math.abs(x + ox - W / 2) > W / 2 + len) || (oy && Math.abs(y + oy - H / 2) > H / 2 + len)) continue;
      ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + dx, y + oy + dy); ctx.stroke();
    }
  }
  return { map: toTexture(c, { aniso }), normalMap: toTexture(normalFromHeight(height, W, H, 1.2), { srgb: false, aniso }) };
}

// ---------------------------------------------------------------- Pianos
export function makeCurb(aniso) {
  const W = 64, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(3);
  ctx.fillStyle = '#c8161d'; ctx.fillRect(0, 0, W, H / 2);
  ctx.fillStyle = '#ecebe6'; ctx.fillRect(0, H / 2, W, H / 2);
  // suciedad y desgaste
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(20,20,20,${rnd() * 0.12})`;
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(0.15, 'rgba(0,0,0,0)');
  g.addColorStop(0.85, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  return toTexture(c, { aniso });
}

// ---------------------------------------------------------------- Muro de hormigón pintado
// Repite cada 8 m: bloque blanco + bloque rojo, 1,1 m de alto.
export function makeBarrier(aniso) {
  const W = 512, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(17);
  ctx.fillStyle = '#e8e6e0'; ctx.fillRect(0, 0, W / 2, H);
  ctx.fillStyle = '#b3141b'; ctx.fillRect(W / 2, 0, W / 2, H);
  // manchas de goma y tierra en la parte baja
  const g = ctx.createLinearGradient(0, H, 0, 0);
  g.addColorStop(0, 'rgba(40,34,28,0.55)'); g.addColorStop(0.35, 'rgba(40,34,28,0.08)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 2500; i++) {
    const y = H - Math.pow(rnd(), 2) * H;
    ctx.fillStyle = `rgba(30,28,26,${rnd() * 0.15})`;
    ctx.fillRect(rnd() * W, y, 1 + rnd() * 4, 1 + rnd() * 2);
  }
  // marcas negras de roces
  for (let i = 0; i < 6; i++) {
    ctx.strokeStyle = `rgba(15,15,15,${0.2 + rnd() * 0.3})`;
    ctx.lineWidth = 1 + rnd() * 3;
    const y = H * (0.45 + rnd() * 0.4), x = rnd() * W;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 30 + rnd() * 80, y + (rnd() - 0.5) * 6); ctx.stroke();
  }
  // juntas entre bloques
  ctx.fillStyle = 'rgba(20,20,20,0.55)';
  ctx.fillRect(0, 0, 3, H); ctx.fillRect(W / 2 - 1, 0, 3, H); ctx.fillRect(W - 2, 0, 2, H);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(0, 0, W, 3);
  return toTexture(c, { aniso });
}

export function makeConcrete(aniso) {
  const W = 256, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const pn = makePeriodicNoise(31);
  const rnd = mulberry32(4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = periodicFbm(pn, x / W, y / H, 8, 4);
    const v = 150 + n * 30 + (rnd() - 0.5) * 22;
    const i = (y * W + x) * 4;
    img.data[i] = v; img.data[i + 1] = v * 0.99; img.data[i + 2] = v * 0.96; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { aniso });
}

// ---------------------------------------------------------------- Alambrado
export function makeFence() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(190,196,200,1)';
  ctx.lineWidth = 2.2;
  const step = S / 4;
  for (let i = -4; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step + S, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i * step + S, 0); ctx.lineTo(i * step, S); ctx.stroke();
  }
  const t = toTexture(c);
  return t;
}

// ---------------------------------------------------------------- Publicidad (marcas ficticias)
export const AD_COUNT = 8;
export function makeAds(aniso) {
  const W = 1024, H = 1024, rowH = H / AD_COUNT;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const ads = [
    { bg: '#0f1113', fg: '#f4f1ea', accent: '#e8322b', text: 'ASFALTO GT', sub: 'CIRCUITO DEL VALLE' },
    { bg: '#f2c200', fg: '#111', accent: '#111', text: 'VELOX', sub: 'LUBRICANTES' },
    { bg: '#123f8c', fg: '#fff', accent: '#ffd23f', text: 'NORTE OIL', sub: '' },
    { bg: '#ededed', fg: '#c41820', accent: '#111', text: 'KAPPA TYRES', sub: 'GRIP 1.1' },
    { bg: '#0b6e4f', fg: '#fff', accent: '#9be564', text: 'RÍO AZUL', sub: 'AGUA MINERAL' },
    { bg: '#1c1c22', fg: '#35d0c2', accent: '#35d0c2', text: 'TINTA', sub: 'FLUIDOS EN TIEMPO REAL' },
    { bg: '#c41820', fg: '#fff', accent: '#fff', text: 'MERIDIANO', sub: 'RELOJES' },
    { bg: '#f7f5ef', fg: '#1d1d1f', accent: '#ff6a00', text: 'ÓPTIMA', sub: 'TELECOM' },
  ];
  // El tablero mide 6 m x 1 m: la fila de 1024x128 px ya es casi cuadrada en el mundo.
  ads.forEach((a, k) => {
    const y = k * rowH;
    ctx.fillStyle = a.bg; ctx.fillRect(0, y, W, rowH);
    ctx.fillStyle = a.accent; ctx.fillRect(0, y + rowH - 10, W, 10);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, y, W, rowH); ctx.clip();
    ctx.fillStyle = a.accent;
    ctx.beginPath(); ctx.moveTo(40, y + rowH - 10); ctx.lineTo(90, y + 12); ctx.lineTo(120, y + 12); ctx.lineTo(70, y + rowH - 10); ctx.fill();
    ctx.fillStyle = a.fg;
    ctx.font = 'italic 900 86px "Avenir Next Condensed", "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(a.text, 150, y + rowH / 2 - 2);
    if (a.sub) {
      const tw = ctx.measureText(a.text).width;
      ctx.font = '600 26px "Avenir Next", "Helvetica Neue", Arial, sans-serif';
      ctx.globalAlpha = 0.8;
      ctx.fillText(a.sub, 170 + tw, y + rowH / 2 + 18);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  });
  return toTexture(c, { aniso, repeat: false });
}

// ---------------------------------------------------------------- Público en tribuna
export function makeCrowd(aniso) {
  const W = 512, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(21);
  const rows = 8, rh = H / rows;
  const shirts = ['#d62828', '#f77f00', '#fcbf49', '#eae2b7', '#1d3557', '#457b9d', '#2a9d8f', '#e9c46a', '#f4a261', '#264653', '#ffffff', '#111111', '#8338ec', '#ff006e'];
  const skins = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac'];
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh;
    ctx.fillStyle = '#2b3a55'; ctx.fillRect(0, y0, W, rh);
    ctx.fillStyle = '#1a2233'; ctx.fillRect(0, y0 + rh - 6, W, 6);
    for (let x = 4; x < W; x += 9 + rnd() * 5) {
      if (rnd() < 0.12) continue;
      const sw = 8 + rnd() * 3, sh = 12 + rnd() * 4;
      ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)];
      ctx.fillRect(x, y0 + rh - sh - 4, sw, sh);
      ctx.fillStyle = skins[Math.floor(rnd() * skins.length)];
      ctx.beginPath(); ctx.arc(x + sw / 2, y0 + rh - sh - 8, 4, 0, Math.PI * 2); ctx.fill();
      if (rnd() < 0.3) { ctx.fillStyle = shirts[Math.floor(rnd() * shirts.length)]; ctx.fillRect(x + 1, y0 + rh - sh - 12, sw - 2, 3); }
    }
  }
  return toTexture(c, { aniso });
}

// ---------------------------------------------------------------- Árboles (atlas: pino | frondoso)
export function makeTrees() {
  const W = 512, H = 512;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(77);

  // Pino
  ctx.fillStyle = '#4a3322';
  ctx.fillRect(122, 300, 12, 212);
  for (let n = 0; n < 5200; n++) {
    const t = rnd();                       // 0 arriba, 1 abajo
    const y = 18 + t * 440;
    const half = 8 + t * 104 * (0.85 + 0.15 * Math.sin(t * 40));
    const x = 128 + (rnd() * 2 - 1) * half * Math.sqrt(rnd());
    const side = (x - 128) / (half + 1);
    const light = 0.55 + 0.45 * (1 - t) * 0.4 - side * 0.18 + (rnd() - 0.5) * 0.35;
    const g = Math.max(0, Math.min(1, light));
    ctx.fillStyle = `rgb(${18 + g * 30},${40 + g * 58},${26 + g * 30})`;
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + rnd() * 5, 2 + rnd() * 3, (rnd() - 0.5) * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Árbol frondoso
  const ox = 256;
  ctx.strokeStyle = '#5a4331'; ctx.lineCap = 'round';
  ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(ox + 128, 512); ctx.lineTo(ox + 124, 300); ctx.stroke();
  ctx.lineWidth = 6;
  for (let k = 0; k < 6; k++) {
    ctx.beginPath(); ctx.moveTo(ox + 126, 380 - k * 22);
    ctx.lineTo(ox + 128 + (rnd() - 0.5) * 170, 250 - k * 25 - rnd() * 40); ctx.stroke();
  }
  const blobs = [];
  for (let k = 0; k < 26; k++) {
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd());
    blobs.push({ x: ox + 128 + Math.cos(a) * rr * 80, y: 200 + Math.sin(a) * rr * 120, r: 34 + rnd() * 28 });
  }
  for (let n = 0; n < 9000; n++) {
    const b = blobs[Math.floor(rnd() * blobs.length)];
    const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * b.r;
    const x = b.x + Math.cos(a) * rr, y = b.y + Math.sin(a) * rr;
    if (y > 440 || x < ox + 4 || x > ox + 252 || y < 6) continue;
    const lx = (x - (ox + 128)) / 128, ly = (y - 200) / 200;
    const light = 0.62 - lx * 0.22 - ly * 0.3 + (rnd() - 0.5) * 0.45;
    const g = Math.max(0, Math.min(1, light));
    ctx.fillStyle = `rgb(${28 + g * 50},${50 + g * 70},${22 + g * 26})`;
    ctx.beginPath(); ctx.arc(x, y, 2 + rnd() * 3.5, 0, Math.PI * 2); ctx.fill();
  }
  const t = toTexture(c, { repeat: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ---------------------------------------------------------------- Sprites varios
export function makeSmoke() {
  const S = 128;
  const c = canvas(S, S);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(8);
  for (let i = 0; i < 26; i++) {
    const x = S / 2 + (rnd() - 0.5) * S * 0.35, y = S / 2 + (rnd() - 0.5) * S * 0.35;
    const r = S * (0.18 + rnd() * 0.2);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  }
  const t = toTexture(c, { repeat: false });
  return t;
}

export function makeRadial(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 64) {
  const c = canvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  return toTexture(c, { repeat: false });
}

// Sombra de contacto bajo el auto (rectángulo redondeado difuso).
export function makeContactShadow() {
  const W = 128, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.filter = 'blur(14px)';
  ctx.fillStyle = 'rgba(0,0,0,0.9)';
  const r = 26;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(24, 22, W - 48, H - 44, r) : ctx.rect(24, 22, W - 48, H - 44);
  ctx.fill();
  ctx.filter = 'none';
  const t = toTexture(c, { repeat: false });
  return t;
}

export function makeChecker() {
  const W = 256, H = 32;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  const n = 16, sq = W / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) {
    ctx.fillStyle = (i + j) % 2 ? '#111' : '#f2f2f2';
    ctx.fillRect(i * sq, j * sq, sq, sq);
  }
  const t = toTexture(c, { repeat: false });
  t.magFilter = THREE.NearestFilter;
  return t;
}

// Carteles de distancia a la curva (300 / 200 / 100).
export function makeDistanceBoards() {
  const W = 384, H = 128;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ['300', '200', '100'].forEach((txt, i) => {
    const x = i * 128;
    ctx.fillStyle = '#f5f5f2'; ctx.fillRect(x, 0, 128, H);
    ctx.fillStyle = '#111'; ctx.fillRect(x, 0, 128, 10); ctx.fillRect(x, H - 10, 128, 10);
    ctx.font = '900 64px "Helvetica Neue", Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(txt, x + 64, H / 2 + 2);
  });
  return toTexture(c, { repeat: false });
}

export function makeFacade(aniso) {
  const W = 512, H = 256;
  const c = canvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d9dadc'; ctx.fillRect(0, 0, W, H);
  // ventanales de la planta alta
  const grad = ctx.createLinearGradient(0, 20, 0, 110);
  grad.addColorStop(0, '#6f8aa6'); grad.addColorStop(1, '#1d2a38');
  ctx.fillStyle = grad; ctx.fillRect(0, 22, W, 86);
  ctx.fillStyle = '#b9bcc0';
  for (let x = 0; x < W; x += 64) ctx.fillRect(x, 22, 4, 86);
  // boxes (garajes)
  for (let k = 0; k < 4; k++) {
    const x = k * 128 + 10;
    ctx.fillStyle = '#2a2d31'; ctx.fillRect(x, 136, 108, 120);
    ctx.fillStyle = '#3b4046';
    for (let y = 140; y < 256; y += 10) ctx.fillRect(x + 2, y, 104, 5);
    ctx.fillStyle = '#e8322b'; ctx.fillRect(x, 124, 108, 10);
  }
  return toTexture(c, { aniso });
}
