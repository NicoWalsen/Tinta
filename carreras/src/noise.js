// Ruido simplex 2D con semilla + fBm. Se usa para texturas y terreno.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];

export function makeNoise2D(seed = 1) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  return function noise(x, y) {
    const s = (x + y) * F2;
    const i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[perm[ii + perm[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[perm[ii + i1 + perm[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[perm[ii + 1 + perm[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n; // ~[-1, 1]
  };
}

export function fbm(noise, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

// Ruido periódico (para texturas que se repiten sin costuras):
// muestrea el ruido sobre un toroide aproximado mezclando 4 esquinas.
export function tileable(noise, x, y, w, h, scale) {
  const a = noise(x * scale, y * scale);
  const b = noise((x - w) * scale, y * scale);
  const c = noise(x * scale, (y - h) * scale);
  const d = noise((x - w) * scale, (y - h) * scale);
  const u = x / w, v = y / h;
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// Ruido de valor periódico: `period` celdas por repetición (sin costuras).
export function makePeriodicNoise(seed = 7) {
  const rnd = mulberry32(seed);
  const table = new Float32Array(4096);
  for (let i = 0; i < 4096; i++) table[i] = rnd() * 2 - 1;
  const hash = (i, j) => table[((i * 73856093) ^ (j * 19349663)) & 4095];
  const fade = t => t * t * (3 - 2 * t);
  return function (x, y, period) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = fade(x - xi), fy = fade(y - yi);
    const i0 = ((xi % period) + period) % period, j0 = ((yi % period) + period) % period;
    const i1 = (i0 + 1) % period, j1 = (j0 + 1) % period;
    const a = hash(i0, j0), b = hash(i1, j0), c = hash(i0, j1), d = hash(i1, j1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}

// fBm periódico sobre [0,1)² → valores ~[-1,1]
export function periodicFbm(pnoise, u, v, baseCells, octaves = 5, gain = 0.5) {
  let amp = 1, sum = 0, norm = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    sum += amp * pnoise(u * cells, v * cells, cells);
    norm += amp; amp *= gain; cells *= 2;
  }
  return sum / norm;
}
