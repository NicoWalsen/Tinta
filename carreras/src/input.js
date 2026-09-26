// Entrada: táctil multitoque (botones / deslizar / inclinar), teclado y mando.
// Produce un estado continuo { steer, throttle, brake, handbrake }.

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

export class Input {
  constructor(root, callbacks = {}) {
    this.root = root;
    this.cb = callbacks;
    this.mode = 'botones';          // 'botones' | 'deslizar' | 'inclinar'
    this.state = { steer: 0, throttle: 0, brake: 0, handbrake: false };
    this.touch = { left: false, right: false, gas: false, brake: false, hand: false, slide: 0, sliding: false };
    this.keys = new Set();
    this.pointers = new Map();
    this.tilt = { available: false, active: false, angle: 0, zero: 0, raw: 0, has: false };
    this.pad = { steer: 0, throttle: 0, brake: 0, hand: false, active: false, prevButtons: [] };
    this.enabled = false;
    this._bind();
  }

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
        const w = Math.min(window.innerWidth * 0.16, 110);
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
    t.left = t.right = t.gas = t.brake = t.hand = false;
    for (const p of this.pointers.values()) {
      if (p.ctl === 'left') t.left = true;
      else if (p.ctl === 'right') t.right = true;
      else if (p.ctl === 'gas') t.gas = true;
      else if (p.ctl === 'brake') t.brake = true;
      else if (p.ctl === 'hand') t.hand = true;
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
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null) return;
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
    this.tilt.angle = -wrap(raw - this.tilt.zero);
  }

  calibrate() { if (this.tilt.has) this.tilt.zero = this.tilt.raw; }

  _pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && [...pads].find(p => p && p.connected);
    if (!gp) { this.pad.active = false; return; }
    const ax = gp.axes[0] || 0;
    const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const pressed = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    this.pad.steer = Math.abs(ax) > 0.1 ? Math.sign(ax) * ((Math.abs(ax) - 0.1) / 0.9) ** 1.4 : 0;
    this.pad.throttle = Math.max(b(7), b(0));
    this.pad.brake = Math.max(b(6), b(2));
    this.pad.hand = pressed(1) || pressed(5);
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
      const deg = this.tilt.angle * 57.3;
      const dz = 1.5, full = 24;
      steerTarget = Math.abs(deg) < dz ? 0 : clamp((deg - Math.sign(deg) * dz) / (full - dz), -1, 1);
      analog = true;
    } else if (this.mode === 'deslizar' && t.sliding) { steerTarget = t.slide; analog = true; }
    const digital = (t.right || kbRight ? 1 : 0) - (t.left || kbLeft ? 1 : 0);
    if (digital !== 0) { steerTarget = digital; analog = false; }

    if (analog) {
      s.steer += (steerTarget - s.steer) * Math.min(1, dt * 14);
    } else {
      const rate = steerTarget === 0 ? 5.5 : (Math.sign(steerTarget) !== Math.sign(s.steer) && s.steer !== 0 ? 7 : 3.4);
      const d = steerTarget - s.steer;
      s.steer += clamp(d, -rate * dt, rate * dt);
    }

    // Pedales (rampa suave para no patinar al tocar la pantalla)
    const gasOn = t.gas || kbGas;
    const brakeOn = t.brake || kbBrake;
    let thrT = gasOn ? 1 : 0, brkT = brakeOn ? 1 : 0;
    if (this.pad.active) { thrT = Math.max(thrT, this.pad.throttle); brkT = Math.max(brkT, this.pad.brake); }
    s.throttle += clamp(thrT - s.throttle, -dt * 9, dt * 5);
    s.brake += clamp(brkT - s.brake, -dt * 10, dt * 7);
    s.handbrake = t.hand || k.has(' ') || this.pad.hand;
  }

  reset() {
    this.pointers.clear();
    this._refresh();
    Object.assign(this.state, { steer: 0, throttle: 0, brake: 0, handbrake: false });
  }
}
