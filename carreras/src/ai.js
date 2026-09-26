// Piloto automático para los rivales: sigue la línea de carrera con
// "pure pursuit", regula velocidad según el perfil de la pista,
// esquiva/adelanta y se recupera si queda atascado.

export class AIDriver {
  constructor(car, track, skill, seed = 1) {
    this.car = car;
    this.track = track;
    this.skill = skill;
    this.baseSkill = skill;
    let s = seed * 9301 + 49297;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    this.laneBias = (rnd() - 0.5) * 1.4;
    this.aggression = 0.85 + rnd() * 0.3;
    this.avoid = 0;
    this.stuck = 0;
    this.mistakeTimer = 4 + rnd() * 10;
    this.mistake = 0;
    this.rnd = rnd;
  }

  update(dt, cars, active) {
    const car = this.car, tr = this.track, tp = car.tp, inp = car.input;
    if (!active) { inp.throttle = 0; inp.brake = 1; inp.steer = 0; return; }
    const N = tr.N;
    const v = car.speed;
    const sinH = Math.sin(car.heading), cosH = Math.cos(car.heading);
    const fx = sinH, fz = cosH, lx = cosH, lz = -sinH;

    // --- Tráfico: detectar autos adelante en la misma trayectoria ---
    let desiredAvoid = 0, followBrake = 0;
    const maxOff = tr.def.roadHalf - 1.2;
    for (const o of cars) {
      if (o === car) continue;
      let ds = o.tp.s - tp.s;
      if (ds < -tr.length / 2) ds += tr.length;
      if (ds > tr.length / 2) ds -= tr.length;
      if (ds <= 0 || ds > 28) continue;
      const myLat = tr.lineOff[tp.idx] + this.avoid;
      const latDiff = o.tp.lat - myLat;
      if (Math.abs(latDiff) < 2.7) {
        const closing = v - o.speed;
        if (closing > -1) {
          // pasar por el lado con más espacio
          const passRight = o.tp.lat > 0 ? true : o.tp.lat < 0 ? false : this.laneBias < 0;
          const want = passRight ? o.tp.lat - 3.2 : o.tp.lat + 3.2;
          const clamped = Math.max(-maxOff, Math.min(maxOff, want));
          // si no hay espacio para pasar, se queda detrás (desiredAvoid = 0)
          if (Math.abs(clamped - o.tp.lat) > 2.4) desiredAvoid = clamped - tr.lineOff[tp.idx];
        }
        if (ds < 12 && closing > 1.5) followBrake = Math.min(1, (closing - 1.5) / 6 + (12 - ds) / 24);
      }
    }
    this.avoid += (desiredAvoid - this.avoid) * Math.min(1, dt * 1.6);

    // --- Dirección: pure pursuit sobre la línea de carrera ---
    const Ld = 6 + v * 0.40;
    const j = (tp.idx + Math.max(2, Math.round(Ld / tr.ds))) % N;
    let off = tr.lineOff[j] + this.laneBias * 0.5 + this.avoid + this.mistake;
    off = Math.max(-maxOff, Math.min(maxOff, off));
    const tx = tr.px[j] + tr.nx[j] * off, tz = tr.pz[j] + tr.nz[j] * off;
    const dx = tx - car.x, dz = tz - car.z;
    const fwdC = dx * fx + dz * fz, leftC = dx * lx + dz * lz;
    const alpha = Math.atan2(leftC, fwdC);
    const dist = Math.max(3, Math.hypot(dx, dz));
    const L = car.spec.cgToFront + car.spec.cgToRear;
    const delta = Math.atan(2 * L * Math.sin(alpha) / dist);
    const maxSteer = car.maxSteerAt(Math.abs(car.u));
    inp.steer = Math.max(-1, Math.min(1, -delta / maxSteer));

    // --- Velocidad objetivo ---
    let vt = Infinity;
    for (let k = 1; k <= 4; k++) vt = Math.min(vt, tr.speedProfile[(tp.idx + k * 2) % N]);
    vt *= this.skill;
    if (Math.abs(tp.lat) > tr.def.roadHalf) vt = Math.min(vt, 30);   // fuera de pista: cautela
    const err = vt - v;
    if (err > 0) {
      inp.throttle = Math.min(1, err / 2.5 + 0.35) * (Math.abs(car.slipR) > 0.12 ? 0.4 : 1);
      inp.brake = 0;
    } else {
      inp.throttle = err > -0.8 ? 0.25 : 0;
      inp.brake = Math.min(1, -err / 4.5);
    }
    if (followBrake > 0) { inp.brake = Math.max(inp.brake, followBrake * 0.7); inp.throttle *= 1 - followBrake; }
    inp.handbrake = false;

    // --- Pequeños errores humanos ocasionales ---
    this.mistakeTimer -= dt;
    if (this.mistakeTimer <= 0) {
      this.mistake = (this.rnd() - 0.5) * 2.2 * (1.05 - this.baseSkill) * 10;
      this.mistakeTimer = 6 + this.rnd() * 14;
    }
    this.mistake *= Math.exp(-dt * 0.6);

    // --- Atascado o dado vuelta: reaparecer en la pista ---
    const tfx = -tp.lz, tfz = tp.lx;
    const wrongWay = fx * tfx + fz * tfz < -0.2;
    if (v < 1.5 || wrongWay) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > 2.6) {
      this.stuck = 0;
      car.place(tr, tp.s + 4, tr.lineOff[tp.idx] * 0.5);
    }
  }
}
