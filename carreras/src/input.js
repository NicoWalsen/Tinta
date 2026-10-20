// Entrada: táctil multitoque (botones / deslizar / inclinar), teclado y mando.
// Produce un estado continuo { steer, throttle, brake, handbrake, boost }.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

// Curva del volante: suave cerca del centro y más directa hacia el tope, para
// que todo el recorrido sea útil (la goma da mucho agarre con poco ángulo).
export const STEER_EXPO = 0.3;
export const shapeSteer = (v) => v * (STEER_EXPO + (1 - STEER_EXPO) * Math.abs(v));

// Sensibilidad del volante (menú): grados de inclinación para girar a fondo,
// rapidez de las flechas y recorrido del dedo en modo deslizar.
export const STEER_SENS = {
  suave: { tilt: 34, rate: 0.8, slide: 1.3 },
  normal: { tilt: 27, rate: 1, slide: 1 },
  directo: { tilt: 21, rate: 1.25, slide: 0.8 },
};

export class Input {
  constructor(root, callbacks = {}) {
    this.root = root;
    this.cb = callbacks;
    this.mode = 'botones';          // 'botones' | 'deslizar' | 'inclinar'
    this.state = { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false };
    this.steerRaw = 0;              // volante antes de la curva (shapeSteer)
    this.sens = STEER_SENS.normal;
    this.touch = { left: false, right: false, gas: false, brake: false, hand: false, boost: false, slide: 0, sliding: false };
    this.keys = new Set();
    this.pointers = new Map();
    this.tilt = { available: false, active: false, angle: 0, zero: 0, raw: 0, has: false, fused: false };
    this.pad = { steer: 0, throttle: 0, brake: 0, hand: false, boost: false, active: false, prevButtons: [] };
    this.enabled = false;
    this._bind();
  }

  setSensitivity(name) { this.sens = STEER_SENS[name] || STEER_SENS.normal; }

  setMode(mode) {
    this.mode = mode;
    this.root.dataset.mode = mode;
    this.touch.slide = 0; this.touch.sliding = false;
  }

  _bind() {
    const r = this.root;
    const down = (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const ctl = this._ctlAt(e.clientX, e.clientY);
      this.pointers.set(e.pointerId, { ctl, x0: e.clientX, y0: e.clientY });
      this._refresh();
      if (ctl === 'steer') this.touch.sliding = true;
    };
    const move = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      e.preventDefault();
      if (p.ctl === 'steer') {
        const w = Math.min(window.innerWidth * 0.16, 110) * this.sens.slide;
        this.touch.slide = clamp((e.clientX - p.x0) / w, -1, 1);
      } else {
        // permite deslizar el dedo entre acelerador y freno
        const ctl = this._ctlAt(e.clientX, e.clientY);
        if (ctl && ctl !== 'steer' && ctl !== p.ctl) { p.ctl = ctl; this._refresh(); }
      }
    };
    const up = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (p.ctl === 'steer') { this.touch.slide = 0; this.touch.sliding = false; }
      this.pointers.delete(e.pointerId);
      this._refresh();
    };
    r.addEventListener('pointerdown', down, { passive: false });
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    r.addEventListener('touchstart', (e) => { if (this.enabled) e.preventDefault(); }, { passive: false });
    r.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('gesturestart', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      if (!e.repeat) {
        if (k === 'c') this.cb.camera?.();
        if (k === 'r') this.cb.reset?.();
        if (k === 'escape' || k === 'p') this.cb.pause?.();
      }
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.pointers.clear(); this._refresh(); });
  }

  _ctlAt(x, y) {
    const el = document.elementFromPoint(x, y);
    const c = el && el.closest('[data-ctl]');
    if (c) return c.dataset.ctl;
    // en modo deslizar, toda la mitad izquierda es volante
    if (this.mode === 'deslizar' && x < window.innerWidth * 0.5) return 'steer';
    return null;
  }

  _refresh() {
    const t = this.touch;
    t.left = t.right = t.gas = t.brake = t.hand = t.boost = false;
    for (const p of this.pointers.values()) {
      if (p.ctl === 'left') t.left = true;
      else if (p.ctl === 'right') t.right = true;
      else if (p.ctl === 'gas') t.gas = true;
      else if (p.ctl === 'brake') t.brake = true;
      else if (p.ctl === 'hand') t.hand = true;
      else if (p.ctl === 'boost') t.boost = true;
    }
    for (const el of this.root.querySelectorAll('[data-ctl]')) {
      el.classList.toggle('on', !!t[el.dataset.ctl]);
    }
  }

  // --- Giroscopio (iOS pide permiso desde un toque del usuario) ---
  async enableTilt() {
    try {
      const DM = window.DeviceMotionEvent;
      if (!DM) return false;
      if (typeof DM.requestPermission === 'function') {
        const res = await DM.requestPermission();
        if (res !== 'granted') return false;
      }
      if (!this._motionBound) {
        window.addEventListener('devicemotion', (e) => this._onMotion(e));
        this._motionBound = true;
      }
      this.tilt.available = true;
      return true;
    } catch (err) {
      return false;
    }
  }

  _onMotion(e) {
    const gi = e.accelerationIncludingGravity;
    if (!gi || gi.x === null) return;
    // Gravedad "pura": el iPhone separa (con el giroscopio) la aceleración de
    // las manos en e.acceleration. Restándola, mover el teléfono sin girarlo
    // ya no se confunde con girar el volante (1 m/s² eran ~6° falsos).
    const la = e.acceleration;
    const fused = !!la && typeof la.x === 'number' && typeof la.y === 'number';
    const g = { x: gi.x - (fused ? la.x : 0), y: gi.y - (fused ? la.y : 0) };
    const ang = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (window.orientation || 0);
    const a = ((ang % 360) + 360) % 360;
    let gr, gu;
    if (a === 90) { gr = -g.y; gu = g.x; }
    else if (a === 270) { gr = g.y; gu = -g.x; }
    else if (a === 180) { gr = -g.x; gu = -g.y; }
    else { gr = g.x; gu = g.y; }
    if (Math.hypot(gr, gu) < 2) return;         // teléfono casi horizontal: sin dato fiable
    const raw = Math.atan2(gr, gu);
    if (!this.tilt.has) { this.tilt.zero = raw; this.tilt.has = true; }
    this.tilt.raw = raw;
    this.tilt.fused = fused;
    this.tilt.angle = -wrap(raw - this.tilt.zero);
  }

  calibrate() { if (this.tilt.has) { this.tilt.zero = this.tilt.raw; this.tilt.angle = 0; } }

  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p && p.connected);
    if (!gp) { this.pad.active = false; return; }
    const ax = gp.axes[0] || 0;
    const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    this.pad.steer = Math.abs(ax) > 0.1 ? Math.sign(ax) * (Math.abs(ax) - 0.1) / 0.9 : 0;   // la curva va en shapeSteer
    this.pad.throttle = Math.max(b(7), b(0));
    this.pad.brake = Math.max(b(6), b(2));
    this.pad.hand = pressed(1) || pressed(5);
    this.pad.boost = pressed(4) || pressed(10);
    const prev = this.pad.prevButtons;
    if (pressed(3) && !prev[3]) this.cb.camera?.();
    if (pressed(9) && !prev[9]) this.cb.pause?.();
    this.pad.prevButtons = gp.buttons.map(x => x.pressed);
    this.pad.active = this.pad.active || Math.abs(ax) > 0.2 || this.pad.throttle > 0.1 || this.pad.brake > 0.1;
  }

  update(dt) {
    const s = this.state, t = this.touch, k = this.keys;
    this._pollPad();
    const kbLeft = k.has('arrowleft') || k.has('a');
    const kbRight = k.has('arrowright') || k.has('d');
    const kbGas = k.has('arrowup') || k.has('w');
    const kbBrake = k.has('arrowdown') || k.has('s');

    // Dirección
    let steerTarget = 0, analog = false;
    if (this.pad.active && Math.abs(this.pad.steer) > 0.02) { steerTarget = this.pad.steer; analog = true; }
    else if (this.mode === 'inclinar' && this.tilt.available && this.tilt.has) {
      // zona muerta suave de 1° (sin salto al salir de ella) y tope según la sensibilidad
      const deg = this.tilt.angle * 57.3;
      const dz = 1, full = this.sens.tilt;
      steerTarget = Math.sign(deg) * clamp((Math.abs(deg) - dz) / (full - dz), 0, 1);
      analog = true;
    } else if (this.mode === 'deslizar' && t.sliding) { steerTarget = t.slide; analog = true; }
    const digital = (t.right || kbRight ? 1 : 0) - (t.left || kbLeft ? 1 : 0);
    if (digital !== 0) { steerTarget = digital; analog = false; }

    let r = this.steerRaw;
    if (analog) {
      r += (steerTarget - r) * Math.min(1, dt * 14);
    } else {
      const k = this.sens.rate;
      const rate = steerTarget === 0 ? 5.5 : (Math.sign(steerTarget) !== Math.sign(r) && r !== 0 ? 7 * k : 3.6 * k);
      r += clamp(steerTarget - r, -rate * dt, rate * dt);
    }
    this.steerRaw = r;
    s.steer = shapeSteer(r);

    // Pedales (rampa suave para no patinar al tocar la pantalla).
    // El turbo también acelera: se puede deslizar el dedo del acelerador al turbo.
    const boostOn = t.boost || k.has('shift') || k.has('n') || this.pad.boost;
    const gasOn = t.gas || kbGas || boostOn;
    const brakeOn = t.brake || kbBrake;
    let thrT = gasOn ? 1 : 0, brkT = brakeOn ? 1 : 0;
    if (this.pad.active) { thrT = Math.max(thrT, this.pad.throttle); brkT = Math.max(brkT, this.pad.brake); }
    s.throttle += clamp(thrT - s.throttle, -dt * 9, dt * 5);
    s.brake += clamp(brkT - s.brake, -dt * 10, dt * 7);
    s.handbrake = t.hand || k.has(' ') || this.pad.hand;
    s.boost = boostOn;
  }

  reset() {
    this.pointers.clear();
    this._refresh();
    this.steerRaw = 0;
    Object.assign(this.state, { steer: 0, throttle: 0, brake: 0, handbrake: false, boost: false });
  }
}
