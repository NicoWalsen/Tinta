// Audio sintetizado con Web Audio: motor V8 (muestras generadas al vuelo),
// neumáticos, viento, pianos, golpes y pitidos de largada.

function makeNoiseBuffer(ctx, seconds = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// Genera un bucle de explosiones de un V8 a `rpm` fijas. Al reproducirlo
// más rápido/lento (playbackRate) se obtiene cualquier régimen.
function makeEngineBuffer(ctx, { rpm, res1, res2, bright }) {
  const sr = ctx.sampleRate;
  const cycle = 120 / rpm;               // un ciclo de 4 tiempos = 2 vueltas
  const cycles = 16;
  const len = Math.round(cycle * cycles * sr);
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  // V8 cruzado: 8 explosiones por ciclo con intervalos y fuerzas desparejas
  const pattern = [1.0, 0.78, 0.92, 0.7, 0.97, 0.82, 0.88, 0.74];
  const offsets = [0, 0.118, 0.25, 0.372, 0.5, 0.625, 0.742, 0.87];
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const tau1 = 0.010 * (1500 / rpm) ** 0.4, tau2 = 0.0035, tauN = 0.0018;
  for (let c = 0; c < cycles; c++) {
    for (let k = 0; k < 8; k++) {
      const t0 = (c + offsets[k] + (rnd() - 0.5) * 0.012) * cycle;
      const amp = pattern[k] * (0.85 + rnd() * 0.3);
      const start = Math.floor(t0 * sr);
      const dur = Math.floor(0.06 * sr);
      const ph = rnd() * 6.28;
      for (let i = 0; i < dur; i++) {
        const t = i / sr;
        const e1 = Math.exp(-t / tau1), e2 = Math.exp(-t / tau2), en = Math.exp(-t / tauN);
        const v = amp * (e1 * Math.sin(2 * Math.PI * res1 * t + ph) + 0.55 * e2 * Math.sin(2 * Math.PI * res2 * t) * bright + 0.5 * en * (rnd() * 2 - 1));
        const idx = (start + i) % len;
        d[idx] += v;
      }
    }
  }
  // normalizar y quitar continua
  let mean = 0; for (let i = 0; i < len; i++) mean += d[i]; mean /= len;
  let peak = 0; for (let i = 0; i < len; i++) { d[i] -= mean; peak = Math.max(peak, Math.abs(d[i])); }
  for (let i = 0; i < len; i++) d[i] /= peak;
  return b;
}

function softClip(ctx, amount = 2.2) {
  const ws = ctx.createWaveShaper();
  const n = 1024, curve = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; curve[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  ws.curve = curve;
  return ws;
}

class EngineVoice {
  constructor(ctx, buffers, dest, withPanner = false) {
    this.ctx = ctx;
    this.low = ctx.createBufferSource(); this.low.buffer = buffers.low; this.low.loop = true;
    this.high = ctx.createBufferSource(); this.high.buffer = buffers.high; this.high.loop = true;
    this.gLow = ctx.createGain(); this.gHigh = ctx.createGain();
    this.shaper = softClip(ctx, 1.8);
    this.filter = ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.Q.value = 0.9;
    this.body = ctx.createBiquadFilter(); this.body.type = 'peaking'; this.body.frequency.value = 160; this.body.gain.value = 5; this.body.Q.value = 1;
    this.out = ctx.createGain(); this.out.gain.value = 0;
    this.low.connect(this.gLow); this.high.connect(this.gHigh);
    this.gLow.connect(this.shaper); this.gHigh.connect(this.shaper);
    this.shaper.connect(this.body); this.body.connect(this.filter); this.filter.connect(this.out);
    if (withPanner && ctx.createStereoPanner) { this.pan = ctx.createStereoPanner(); this.out.connect(this.pan); this.pan.connect(dest); }
    else this.out.connect(dest);
    this.low.start(); this.high.start();
    this.baseLow = buffers.lowRpm; this.baseHigh = buffers.highRpm;
  }

  set(rpm, throttle, volume, rateMul = 1, pan = 0) {
    const now = this.ctx.currentTime, tc = 0.03;
    this.low.playbackRate.setTargetAtTime((rpm / this.baseLow) * rateMul, now, tc);
    this.high.playbackRate.setTargetAtTime((rpm / this.baseHigh) * rateMul, now, tc);
    const x = Math.max(0, Math.min(1, (rpm - 2600) / 2600));
    this.gLow.gain.setTargetAtTime(Math.cos(x * Math.PI / 2), now, tc);
    this.gHigh.gain.setTargetAtTime(Math.sin(x * Math.PI / 2), now, tc);
    this.filter.frequency.setTargetAtTime(700 + rpm * 0.45 + throttle * 3200, now, tc);
    this.out.gain.setTargetAtTime(volume * (0.4 + throttle * 0.6), now, tc);
    if (this.pan) this.pan.pan.setTargetAtTime(pan, now, 0.05);
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.ready = false;
  }

  // Debe llamarse desde un toque del usuario (requisito de iOS).
  init() {
    if (this.ctx) { this.resume(); return; }
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* opcional */ }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.85 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(ctx.destination);

    const buffers = {
      low: makeEngineBuffer(ctx, { rpm: 1500, res1: 95, res2: 310, bright: 0.7 }),
      high: makeEngineBuffer(ctx, { rpm: 5200, res1: 220, res2: 780, bright: 1.0 }),
      lowRpm: 1500, highRpm: 5200,
    };
    this.buffers = buffers;
    this.noise = makeNoiseBuffer(ctx, 2);
    this.player = new EngineVoice(ctx, buffers, this.master);
    this.rival = new EngineVoice(ctx, buffers, this.master, true);

    const loopNoise = () => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(0, Math.random() * 1.5); return s; };
    // Chirrido de neumáticos
    this.tireSrc = loopNoise();
    this.tireBP = ctx.createBiquadFilter(); this.tireBP.type = 'bandpass'; this.tireBP.frequency.value = 950; this.tireBP.Q.value = 7;
    this.tireOsc = ctx.createOscillator(); this.tireOsc.type = 'triangle'; this.tireOsc.frequency.value = 830;
    this.tireOscG = ctx.createGain(); this.tireOscG.gain.value = 0.18;
    this.tireGain = ctx.createGain(); this.tireGain.gain.value = 0;
    this.tireSrc.connect(this.tireBP); this.tireBP.connect(this.tireGain);
    this.tireOsc.connect(this.tireOscG); this.tireOscG.connect(this.tireGain);
    this.tireOsc.start();
    this.tireGain.connect(this.master);
    // Viento
    this.windSrc = loopNoise();
    this.windF = ctx.createBiquadFilter(); this.windF.type = 'bandpass'; this.windF.frequency.value = 600; this.windF.Q.value = 0.4;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(this.windF); this.windF.connect(this.windGain); this.windGain.connect(this.master);
    // Pasto / grava
    this.grassSrc = loopNoise();
    this.grassF = ctx.createBiquadFilter(); this.grassF.type = 'lowpass'; this.grassF.frequency.value = 260;
    this.grassGain = ctx.createGain(); this.grassGain.gain.value = 0;
    this.grassSrc.connect(this.grassF); this.grassF.connect(this.grassGain); this.grassGain.connect(this.master);
    // Pianos (vibración periódica)
    this.curbOsc = ctx.createOscillator(); this.curbOsc.type = 'square'; this.curbOsc.frequency.value = 30;
    this.curbF = ctx.createBiquadFilter(); this.curbF.type = 'lowpass'; this.curbF.frequency.value = 320;
    this.curbGain = ctx.createGain(); this.curbGain.gain.value = 0;
    this.curbOsc.connect(this.curbF); this.curbF.connect(this.curbGain); this.curbGain.connect(this.master);
    this.curbOsc.start();
    this.ready = true;
    this.popCooldown = 0;
    this.lastThrottle = 0;
    this.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.05);
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }

  silence() {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    for (const g of [this.player.out.gain, this.rival.out.gain, this.tireGain.gain, this.windGain.gain, this.grassGain.gain, this.curbGain.gain]) g.setTargetAtTime(0, now, 0.05);
  }

  update(dt, car, rival, listener) {
    if (!this.ready) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const thr = car.throttleVis;
    let rpm = car.rpm;
    // petardeos al soltar el acelerador a alto régimen
    this.popCooldown -= dt;
    if (this.lastThrottle > 0.6 && thr < 0.2 && rpm > 4800 && this.popCooldown <= 0) { this.pops(3 + Math.floor(Math.random() * 3)); this.popCooldown = 1.2; }
    this.lastThrottle = thr;
    this.player.set(rpm, thr, 0.55);

    // Neumáticos
    const onGrass = car.surf.filter(s => s === 2).length >= 2;
    const skid = onGrass ? 0 : Math.max(car.skidR, car.skidF * 0.9);
    const tireV = Math.min(1, skid) ** 1.4 * Math.min(1, car.speed / 8) * 0.55;
    this.tireGain.gain.setTargetAtTime(tireV, now, 0.04);
    this.tireBP.frequency.setTargetAtTime(850 + skid * 350 + Math.sin(now * 23) * 40, now, 0.05);
    this.tireOsc.frequency.setTargetAtTime(760 + skid * 220 + Math.sin(now * 17) * 25, now, 0.05);
    // Viento
    const sp = car.speed / 80;
    this.windGain.gain.setTargetAtTime(Math.min(0.5, sp * sp * 0.45), now, 0.1);
    this.windF.frequency.setTargetAtTime(400 + sp * 900, now, 0.1);
    // Pasto
    const grassK = car.surf.filter(s => s === 2).length / 4;
    this.grassGain.gain.setTargetAtTime(grassK * Math.min(1, car.speed / 20) * 0.9, now, 0.05);
    // Pianos
    const curbK = car.surf.filter(s => s === 1).length / 4;
    this.curbOsc.frequency.setTargetAtTime(Math.max(8, car.speed / 1.3), now, 0.03);
    this.curbGain.gain.setTargetAtTime(curbK * Math.min(1, car.speed / 12) * 0.35, now, 0.03);

    // Rival más cercano (volumen por distancia, paneo estéreo y efecto Doppler)
    if (rival && listener) {
      const dx = rival.x - listener.x, dz = rival.z - listener.z;
      const d = Math.hypot(dx, dz);
      const rightX = -Math.cos(listener.heading), rightZ = Math.sin(listener.heading);
      const pan = Math.max(-1, Math.min(1, (dx * rightX + dz * rightZ) / (d + 1)));
      const vrel = ((rival.vx - listener.vx) * dx + (rival.vz - listener.vz) * dz) / (d + 0.01);
      const doppler = Math.max(0.8, Math.min(1.25, 343 / (343 + vrel)));
      const vol = 0.42 / (1 + (d / 9) ** 1.6);
      this.rival.set(rival.rpm, rival.throttleVis, vol, doppler, pan);
    } else {
      this.rival.out.gain.setTargetAtTime(0, now, 0.1);
    }
  }

  shift() {
    if (!this.ready) return;
    this.pops(1, 0.4);
  }

  pops(n = 3, vol = 0.7) {
    if (!this.ready) return;
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.05 + Math.random() * 0.07);
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + Math.random() * 900;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * (0.5 + Math.random() * 0.5), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      s.connect(f); f.connect(g); g.connect(this.master);
      s.start(t, Math.random()); s.stop(t + 0.08);
    }
  }

  impact(strength) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = Math.min(1, strength / 14);
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 350 + k * 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * k + 0.1, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25 + k * 0.3);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + 0.6);
    // golpe metálico
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 140 + Math.random() * 80;
    const og = ctx.createGain(); og.gain.setValueAtTime(0.4 * k, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.2);
  }

  beep(freq = 660, dur = 0.16, vol = 0.35) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur - 0.03); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
}
