// Texturas de los autos: decoración de competición (franjas, número,
// patrocinadores), relieve de paneles y rejillas, fibra de carbono,
// neumáticos slick y frontal/difusor.
//
// Coordenadas de la carrocería (las genera carModel.js):
//   u = t: 0 cola → 1 trompa.
//   v: 0 bajo el auto (lado P, x > 0) → 0,5 centro del techo → 1 bajo el auto (lado N).
//   Cada lado se divide en 6 bandas de la sección (A-B, B-C, C-D, D-E, E-F, F-G),
//   así que una posición de banda b ∈ [0, 6] equivale a v = b/12 (lado P) o 1 − b/12 (lado N).
//   Bandas útiles: C-D = costado bajo (puertas), D-E = hombro, E-F = ventanilla / tapa de
//   guardabarros, F-G = techo, capó y maletero (b = 6 es el eje central).
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

const LW = 1024, LH = 1024, BP = LH / 12;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
const X = (t) => t * LW;
const Y = (side, b) => (side > 0 ? LH - b * BP : b * BP);
const SIDES = [1, -1];

// Rectángulo en coordenadas de banda, en ambos lados.
function bandRect(ctx, t0, t1, b0, b1) {
  for (const s of SIDES) {
    const y0 = Y(s, b0), y1 = Y(s, b1);
    ctx.fillRect(X(t0), Math.min(y0, y1), X(t1) - X(t0), Math.abs(y1 - y0));
  }
}
// Polígono [(t, b)…] en ambos lados.
function bandPoly(ctx, pts, stroke = false) {
  for (const s of SIDES) {
    ctx.beginPath();
    pts.forEach(([t, b], i) => (i ? ctx.lineTo(X(t), Y(s, b)) : ctx.moveTo(X(t), Y(s, b))));
    if (stroke) ctx.stroke(); else { ctx.closePath(); ctx.fill(); }
  }
}
function bandCircle(ctx, t, b, r, stroke = false, sides = SIDES) {
  for (const s of sides) {
    ctx.beginPath();
    ctx.ellipse(X(t), Y(s, b), r, r * 0.9, 0, 0, Math.PI * 2);
    if (stroke) ctx.stroke(); else ctx.fill();
  }
}
// Texto legible desde afuera en cada costado. `k` corrige la proporción
// vertical de la banda (px por metro vertical / px por metro horizontal).
function sideText(ctx, text, t, b, size, { k = 1.1, font = '900', italic = true, color = '#111', align = 'center', sides = SIDES, family = '"Avenir Next Condensed", "Arial Narrow", Arial, sans-serif' } = {}) {
  for (const s of sides) {
    ctx.save();
    // lado P: espejado horizontal; lado N: invertido vertical (ver comentario superior)
    if (s > 0) ctx.setTransform(-1, 0, 0, k, X(t), Y(s, b));
    else ctx.setTransform(1, 0, 0, -k, X(t), Y(s, b));
    ctx.font = `${italic ? 'italic ' : ''}${font} ${size}px ${family}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

// ---------------------------------------------------------------- líneas de paneles y rejillas
// Se dibujan igual en la decoración (oscuras) y en el mapa de alturas (surcos).
function panelDetails(ctx, mode) {
  const line = (pts) => bandPoly(ctx, pts, true);
  const groove = mode === 'height' ? '#262626' : 'rgba(0,0,0,0.42)';
  const deep = mode === 'height' ? '#0a0a0a' : 'rgba(6,7,8,0.92)';
  const slat = mode === 'height' ? '#6a6a6a' : 'rgba(40,42,46,0.95)';
  ctx.lineCap = 'round';
  ctx.strokeStyle = groove;
  ctx.lineWidth = 2.2;
  // Puerta
  line([[0.648, 2.06], [0.648, 3.98]]);
  line([[0.406, 2.06], [0.394, 3.98]]);
  line([[0.406, 2.06], [0.648, 2.06]]);
  // Capó (línea del torpedo y bordes) y maletero
  line([[0.703, 4.62], [0.703, 6]]);
  line([[0.703, 4.92], [0.985, 4.92]]);
  line([[0.255, 4.62], [0.255, 6]]);
  line([[0.035, 4.92], [0.255, 4.92]]);
  // Escotilla del techo (exigida en GT3)
  line([[0.468, 5.55], [0.552, 5.55]]);
  line([[0.468, 5.55], [0.468, 6]]);
  line([[0.552, 5.55], [0.552, 6]]);
  // Manija de la puerta
  ctx.fillStyle = deep;
  for (const s of SIDES) { roundRect(ctx, X(0.425), Y(s, 3.72) - 5, X(0.05), 10, 5); ctx.fill(); }
  // Tapa de combustible rápida (solo lado N)
  ctx.lineWidth = 2;
  bandCircle(ctx, 0.325, 4.55, 13, true, [-1]);
  ctx.fillStyle = mode === 'height' ? '#3a3a3a' : 'rgba(25,25,25,0.8)';
  bandCircle(ctx, 0.325, 4.55, 6, false, [-1]);
  // Branquias detrás de la rueda delantera
  ctx.fillStyle = deep;
  for (let i = 0; i < 3; i++) {
    const t = 0.668 + i * 0.012;
    bandPoly(ctx, [[t, 2.55], [t + 0.006, 2.55], [t + 0.014, 3.55], [t + 0.008, 3.55]]);
  }
  // Toma de aire lateral (delante de la rueda trasera)
  bandPoly(ctx, [[0.30, 2.35], [0.375, 2.2], [0.385, 3.5], [0.315, 3.45]]);
  ctx.fillStyle = slat;
  for (let i = 1; i <= 3; i++) {
    const b = 2.35 + i * 0.3;
    bandPoly(ctx, [[0.302, b], [0.38, b - 0.05], [0.381, b + 0.05], [0.303, b + 0.08]]);
  }
  // Rejillas del capó (dos extractores) y de los guardabarros delanteros
  const vent = (t0, t1, b0, b1, n) => {
    ctx.fillStyle = deep;
    bandRect(ctx, t0, t1, b0, b1);
    ctx.fillStyle = slat;
    for (let i = 1; i < n; i++) { const t = t0 + (t1 - t0) * i / n; bandRect(ctx, t - 0.0015, t + 0.0015, b0 + 0.04, b1 - 0.04); }
  };
  vent(0.775, 0.86, 5.35, 5.72, 9);
  vent(0.735, 0.83, 4.24, 4.72, 8);
  // Pasadores del capó
  ctx.fillStyle = deep;
  bandCircle(ctx, 0.948, 5.32, 7);
}

// ---------------------------------------------------------------- decoración
// opts: { base, stripe, accent, number, numberColor, board }
export function makeLiveryCanvas(opts) {
  const c = canvas(LW, LH);
  const ctx = c.getContext('2d');
  const { base, stripe, accent = stripe, number = '7', board = '#f4f3ee', numberColor = '#111' } = opts;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, LW, LH);

  // Franjas Le Mans sobre capó, techo y maletero (con filete de acento)
  ctx.fillStyle = stripe;
  bandRect(ctx, 0, 1, 5.6, 5.86);
  ctx.fillStyle = accent;
  bandRect(ctx, 0, 1, 5.545, 5.575);
  bandRect(ctx, 0, 1, 5.885, 5.915);

  // Barrido lateral desde el guardabarros delantero hacia la puerta
  ctx.fillStyle = stripe;
  bandPoly(ctx, [[0.95, 3.55], [0.98, 3.25], [0.67, 2.2], [0.6, 2.2]]);
  ctx.fillStyle = accent;
  bandPoly(ctx, [[0.985, 3.15], [0.99, 3.0], [0.72, 2.1], [0.68, 2.1]]);
  // Faldón inferior de color de acento
  bandRect(ctx, 0.05, 0.95, 2.0, 2.12);

  // Placa de número en las puertas
  for (const s of SIDES) {
    const x0 = X(0.468), x1 = X(0.588);
    const y0 = Y(s, 2.2), y1 = Y(s, 3.12);
    ctx.fillStyle = board;
    roundRect(ctx, x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0), 10);
    ctx.fill();
  }
  sideText(ctx, number, 0.528, 2.66, 84, { color: numberColor, k: 0.86 });

  // Patrocinadores (marcas ficticias del circuito)
  const ink = opts.ink || '#ffffff';
  sideText(ctx, 'KAPPA TYRES', 0.79, 2.42, 22, { color: ink, k: 0.9, font: '800' });
  sideText(ctx, 'VELOX', 0.25, 3.05, 30, { color: ink, k: 0.95 });
  sideText(ctx, 'NORTE OIL', 0.528, 3.42, 17, { color: ink, k: 0.9, font: '800' });
  sideText(ctx, 'ASFALTO GT', 0.1, 2.5, 18, { color: ink, k: 0.9, font: '800' });

  // Franja del parabrisas con el nombre del campeonato
  ctx.fillStyle = '#0d0e10';
  const bx = X(0.576), bw = X(0.601) - bx;
  ctx.fillRect(bx, Y(-1, 4.95), bw, Y(1, 4.95) - Y(-1, 4.95));
  ctx.save();
  ctx.setTransform(0, 1, 1, 0, bx + bw * 0.52, LH / 2);
  ctx.font = 'italic 900 19px "Avenir Next Condensed", "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f4f3ee';
  ctx.fillText('ASFALTO GT · ' + number, 0, 0);
  ctx.restore();

  panelDetails(ctx, 'color');
  return c;
}

export function makeLiveryTexture(opts, aniso = 8) {
  const t = new THREE.CanvasTexture(makeLiveryCanvas(opts));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Normal map de paneles: surcos, rejillas y tomas hundidas.
let _panelNormal = null;
export function panelNormalMap(aniso = 8) {
  if (_panelNormal) return _panelNormal;
  const c = canvas(LW, LH);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#8a8a8a';
  ctx.fillRect(0, 0, LW, LH);
  panelDetails(ctx, 'height');
  const src = ctx.getImageData(0, 0, LW, LH).data;
  const h = new Float32Array(LW * LH);
  for (let i = 0; i < h.length; i++) h[i] = src[i * 4] / 255;
  const out = ctx.createImageData(LW, LH);
  const d = out.data, k = 3.2;
  for (let y = 0; y < LH; y++) {
    const ym = Math.max(0, y - 1) * LW, yp = Math.min(LH - 1, y + 1) * LW;
    for (let x = 0; x < LW; x++) {
      const xm = Math.max(0, x - 1), xp = Math.min(LW - 1, x + 1);
      const dx = (h[y * LW + xp] - h[y * LW + xm]) * k;
      const dy = (h[yp + x] - h[ym + x]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * LW + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = aniso;
  _panelNormal = t;
  return t;
}

// ---------------------------------------------------------------- fibra de carbono (sarga 2x2)
let _carbon = null;
export function carbonTexture(aniso = 8) {
  if (_carbon) return _carbon;
  const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
  const cell = S / 8;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const warp = ((x + y) >> 1) % 2 === 0;            // patrón de sarga en diagonal
    const g = ctx.createLinearGradient(x * cell, y * cell, warp ? (x + 1) * cell : x * cell, warp ? y * cell : (y + 1) * cell);
    g.addColorStop(0, warp ? '#1f2226' : '#16181b');
    g.addColorStop(0.5, warp ? '#2a2d32' : '#1c1f22');
    g.addColorStop(1, warp ? '#1b1d21' : '#141619');
    ctx.fillStyle = g;
    ctx.fillRect(x * cell, y * cell, cell, cell);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  _carbon = t;
  return t;
}

// ---------------------------------------------------------------- neumático slick con letras
let _tire = null;
export function tireTexture(aniso = 8) {
  if (_tire) return _tire;
  const W = 1024, H = 128, c = canvas(W, H), ctx = c.getContext('2d');
  const rnd = mulberry32(31);
  ctx.fillStyle = '#1c1c1d';
  ctx.fillRect(0, 0, W, H);
  // banda de rodadura algo más clara y "gastada" (v ≈ 0,35..0,65)
  ctx.fillStyle = '#242425';
  ctx.fillRect(0, H * 0.35, W, H * 0.3);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.06})`;
    ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 3, 1);
  }
  // letras en el flanco exterior (v ≈ 0,08..0,24 → y ≈ 97..118)
  const yText = H * (1 - 0.155);
  ctx.textBaseline = 'middle';
  for (let k = 0; k < 2; k++) {
    const x0 = k * W / 2;
    ctx.font = 'italic 900 19px "Avenir Next Condensed", "Arial Narrow", Arial, sans-serif';
    ctx.fillStyle = '#f2c200';
    ctx.fillText('KAPPA', x0 + 40, yText);
    ctx.font = '700 11px "Avenir Next", Arial, sans-serif';
    ctx.fillStyle = '#e9e9e4';
    ctx.fillText('RACING SLICK', x0 + 120, yText);
    ctx.fillText('305/30 R20', x0 + 290, yText);
    ctx.fillStyle = '#f2c200';
    ctx.fillRect(x0 + 230, yText - 1.5, 40, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  _tire = t;
  return t;
}

// ---------------------------------------------------------------- frontal (panal) y difusor
let _fascia = null;
export function fasciaTexture(aniso = 8) {
  if (_fascia) return _fascia;
  const W = 512, H = 256, c = canvas(W, H), ctx = c.getContext('2d');
  // Mitad izquierda: parrilla tipo panal
  ctx.fillStyle = '#060708';
  ctx.fillRect(0, 0, W / 2, H);
  const r = 7;
  ctx.strokeStyle = '#2c3036';
  ctx.lineWidth = 2;
  for (let row = 0; row < H / (r * 1.5) + 1; row++) {
    for (let col = 0; col < W / 2 / (r * 1.732) + 1; col++) {
      const cx = col * r * 1.732 + (row % 2) * r * 0.866, cy = row * r * 1.5;
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = Math.PI / 6 + k * Math.PI / 3;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        k ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.stroke();
    }
  }
  // marco brillante alrededor de la toma
  ctx.strokeStyle = '#3d4249'; ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, W / 2 - 6, H - 6);
  // Mitad derecha: difusor con aletas verticales
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#16181b'); g.addColorStop(1, '#050506');
  ctx.fillStyle = g;
  ctx.fillRect(W / 2, 0, W / 2, H);
  ctx.fillStyle = '#2a2d32';
  for (let i = 1; i < 8; i++) ctx.fillRect(W / 2 + i * (W / 2) / 8 - 2, H * 0.35, 4, H * 0.65);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  _fascia = t;
  return t;
}
