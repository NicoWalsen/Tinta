// Dinámica del vehículo: modelo de bicicleta con neumáticos Pacejka,
// transferencia de carga, círculo de fricción, tren motriz con caja
// automática y ayudas (ABS, control de tracción, control de estabilidad).
// Integración en coordenadas del mundo con paso fijo.
import { CAR } from './config.js';

const G = 9.81;
const TAU = Math.PI * 2;
const SURF_MU = [1.0, 0.93, 0.6];        // asfalto, piano, pasto
const SURF_ROLL = [0, 60, 1100];          // resistencia extra (N)

// "Fórmula mágica" de Pacejka normalizada: pico ≈ 1 cerca de 7°.
function pacejka(alpha) {
  const B = 14, C = 1.6, E = 0.4;
  const Ba = B * alpha;
  return Math.sin(C * Math.atan(Ba - E * (Ba - Math.atan(Ba))));
}

function interpTable(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    if (x <= table[i][0]) {
      const [x0, y0] = table[i - 1], [x1, y1] = table[i];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return table[table.length - 1][1];
}

export class Vehicle {
  constructor(spec = CAR) {
    this.spec = spec;
    this.x = 0; this.z = 0; this.y = 0;
    this.heading = 0;
    this.vx = 0; this.vz = 0;
    this.yawRate = 0;
    this.steerAngle = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.assists = { abs: true, tcs: true, esc: true, steer: true };
    this.gear = 1;
    this.rpm = spec.idle;
    this.shiftTimer = 0;
    this.reverseTimer = 0;
    this.shiftEvent = 0;
    this.axF = 0; this.ayF = 0;
    this.u = 0; this.w = 0; this.speed = 0;
    this.pitch = 0; this.pitchV = 0; this.roll = 0; this.rollV = 0;
    this.bump = 0; this.bumpV = 0;
    this.wheelRotF = 0; this.wheelRotR = 0;
    this.slipF = 0; this.slipR = 0;
    this.skidF = 0; this.skidR = 0;
    this.wheelspin = 0;
    this.surf = [0, 0, 0, 0];     // FL, FR, RL, RR
    this.load = 0;                // uso de adherencia (0..1) para sonido
    this.latUseR = 0;             // fracción de adherencia trasera usada en lateral
    this.throttleVis = 0;
    this.tp = { idx: 0, t: 0, s: 0, lat: 0, y: 0, lx: 1, lz: 0, curb: false, slope: 0 };
    this.impact = 0;              // intensidad del último choque (para efectos)
    this.impactX = 0; this.impactZ = 0;
  }

  place(track, s, lat) {
    const p = track.pointAt(s, lat);
    this.x = p.x; this.z = p.z; this.heading = p.heading;
    this.vx = 0; this.vz = 0; this.yawRate = 0; this.steerAngle = 0;
    this.gear = 1; this.rpm = this.spec.idle; this.shiftTimer = 0;
    this.axF = 0; this.ayF = 0; this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0;
    track.project(this.x, this.z, -1, this.tp);
    this.y = this.tp.y;
  }

  // Ángulo máximo de dirección según la velocidad: evita que las
  // ruedas delanteras pasen su ángulo de deriva óptimo (ayuda de dirección).
  maxSteerAt(u) {
    const S = this.spec, L = S.cgToFront + S.cgToRear;
    if (!this.assists.steer) return Math.min(S.maxSteer, Math.atan(L * 22 / Math.max(u * u, 1)) + 0.12);
    return Math.min(S.maxSteer, Math.atan(L * 13 / Math.max(u * u, 1)) + 0.06);
  }

  step(dt, track) {
    const S = this.spec, inp = this.input, tp = this.tp;
    const m = S.mass, a = S.cgToFront, b = S.cgToRear, L = a + b;

    track.project(this.x, this.z, tp.idx, tp);

    const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    const fx = sinH, fz = cosH;          // adelante
    const lx = cosH, lz = -sinH;         // izquierda
    const u = this.vx * fx + this.vz * fz;
    const w = this.vx * lx + this.vz * lz;
    const r = this.yawRate;
    const vAbs = Math.abs(u);
    const speed = Math.hypot(this.vx, this.vz);
    const beta = speed > 3 ? Math.atan2(w, Math.max(vAbs, 1)) : 0;

    // --- Superficie bajo cada rueda ---
    const sinRel = fx * tp.lx + fz * tp.lz;     // adelante · izquierda_pista
    const cosRel = fx * (-tp.lz) + fz * tp.lx;  // adelante · adelante_pista
    const ht = S.halfTrack;
    let muFw = 0, muRw = 0, extraRoll = 0, rough = 0;
    for (let k = 0; k < 4; k++) {
      const dl = k < 2 ? a : -b;
      const dw = (k % 2 === 0) ? ht : -ht;
      const latW = tp.lat + dl * sinRel + dw * cosRel;
      const sf = track.surfaceAt(latW, tp.curb);
      this.surf[k] = sf;
      if (k < 2) muFw += SURF_MU[sf] * 0.5; else muRw += SURF_MU[sf] * 0.5;
      extraRoll += SURF_ROLL[sf] * 0.25;
      rough += (sf === 1 ? 0.6 : sf === 2 ? 1 : 0) * 0.25;
    }
    const muF = S.mu * S.gripFront * muFw, muR = S.mu * S.gripRear * muRw;

    // --- Cargas verticales con transferencia longitudinal y carga aerodinámica ---
    const down = S.downforce * u * u;
    const transfer = m * this.axF * S.cgHeight / L;
    const FzF = Math.max(0.15 * m * G, m * G * b / L + down * 0.45 - transfer);
    const FzR = Math.max(0.15 * m * G, m * G * a / L + down * 0.55 + transfer);
    const capF = muF * FzF, capR = muR * FzR;

    // --- Dirección ---
    const maxSteer = this.maxSteerAt(vAbs);
    let target = -inp.steer * maxSteer;
    // Contravolanteo: si el jugador gira hacia el lado del derrape se le
    // permite alinear las ruedas con la dirección real de marcha.
    if (vAbs > 4 && Math.abs(beta) > 0.04 && Math.sign(-inp.steer) === Math.sign(beta)) {
      target = -inp.steer * Math.min(S.maxSteer, Math.max(maxSteer, Math.abs(beta) + 0.06));
    }
    if (this.assists.esc && vAbs > 6 && Math.abs(beta) > 0.05) target += beta * 0.35; // contravolanteo asistido
    const dMax = S.steerSpeed * dt;
    this.steerAngle += Math.max(-dMax, Math.min(dMax, target - this.steerAngle));
    const delta = this.steerAngle;

    // --- Caja de cambios ---
    if (this.gear > 0 && inp.brake > 0.1 && inp.throttle < 0.1 && u < 0.6) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.35) { this.gear = -1; this.reverseTimer = 0; }
    } else if (this.gear > 0) this.reverseTimer = 0;
    if (this.gear === -1 && inp.throttle > 0.1 && u > -0.6) this.gear = 1;
    const reverse = this.gear === -1;
    const drive = reverse ? inp.brake : inp.throttle;
    const brakeIn = reverse ? inp.throttle : inp.brake;

    const gearRatio = (g) => (g === -1 ? S.reverse : S.gears[g - 1]) * S.final;
    const wheelOmega = vAbs / S.wheelRadius;
    const toRpm = 60 / TAU;
    let engRpm = wheelOmega * gearRatio(this.gear) * toRpm;
    const launch = S.idle + drive * 3600;
    if ((this.gear === 1 || reverse) && engRpm < launch) engRpm = launch;
    engRpm = Math.max(S.idle, Math.min(S.limiter + 150, engRpm));
    this.rpm += (engRpm - this.rpm) * Math.min(1, dt * 18);

    this.shiftTimer -= dt;
    if (!reverse && this.shiftTimer <= 0) {
      if (this.gear < S.gears.length && this.rpm > S.upshift && drive > 0.1) {
        this.gear++; this.shiftTimer = 0.17; this.shiftEvent = 1;
      } else if (this.gear > 1) {
        const lower = wheelOmega * gearRatio(this.gear - 1) * toRpm;
        const wantDown = this.rpm < S.downshift || (brakeIn > 0.2 && lower < 6300);
        if (wantDown && lower < S.upshift - 600) {
          this.gear--; this.shiftTimer = 0.1; this.shiftEvent = -1;
        }
      }
    }

    // --- Par motor y fuerza de tracción (tracción trasera) ---
    let Te = interpTable(S.torque, this.rpm) * drive;
    if (this.rpm >= S.limiter) Te = 0;
    if (this.shiftTimer > 0 && this.shiftEvent > 0) Te = 0;
    Te -= (1 - drive) * 60 * (this.rpm / S.redline) * Math.min(1, vAbs / 3); // freno motor
    let Fdrive = Te * gearRatio(this.gear) * S.efficiency / S.wheelRadius;
    if (reverse) { Fdrive = -Fdrive; if (u < -9) Fdrive = 0; }
    this.throttleVis = drive;

    // --- Frenos (con ABS) ---
    let FbF = brakeIn * S.brakeForce * m * G * S.brakeBias;
    let FbR = brakeIn * S.brakeForce * m * G * (1 - S.brakeBias);
    let lockR = false;
    if (inp.handbrake) { FbR = Math.max(FbR, 1.05 * capR); lockR = true; Fdrive *= 0.2; }
    if (this.assists.abs) {
      FbF = Math.min(FbF, 0.96 * capF);
      if (!lockR) FbR = Math.min(FbR, 0.96 * capR);
    }
    const lockF = FbF > capF;
    if (FbR > capR) lockR = true;
    const dirU = u >= 0 ? 1 : -1;
    let FxF = -dirU * Math.min(FbF, capF);
    let FxR = Fdrive - dirU * Math.min(FbR, capR);

    // Control de tracción / patinamiento de ruedas traseras
    this.wheelspin = 0;
    if (Math.abs(FxR) > capR) {
      if (this.assists.tcs && !lockR) FxR = Math.sign(FxR) * capR * 0.93;
      else {
        this.wheelspin = Math.min(1, (Math.abs(Fdrive) - capR) / capR + 0.3);
        FxR = Math.sign(FxR) * capR * 0.82;
      }
    } else if (this.assists.tcs && drive > 0 && !reverse) {
      // reserva adherencia lateral al acelerar en curva
      const latUse = Math.min(0.97, this.latUseR);
      const limit = capR * Math.sqrt(1 - latUse * latUse);
      if (FxR > limit) FxR = Math.max(limit, Math.min(FxR, capR * 0.12));
    }

    // --- Fuerzas laterales (Pacejka + círculo de fricción) ---
    const uS = Math.max(vAbs, 2.5);
    const alphaF = Math.atan2(w + a * r, uS) - delta * dirU;
    const alphaR = Math.atan2(w - b * r, uS);
    const kF = Math.sqrt(Math.max(0.04, 1 - (FxF / capF) ** 2));
    let kR = Math.sqrt(Math.max(0.04, 1 - (FxR / capR) ** 2));
    if (lockR) kR = Math.min(kR, 0.32);
    if (this.wheelspin > 0) kR = Math.min(kR, 0.45);
    const FyF = -capF * kF * (lockF ? 0.35 * Math.sign(alphaF) : pacejka(alphaF));
    const pR = pacejka(alphaR);
    const FyR = -capR * kR * pR;
    this.latUseR = Math.abs(pR) * (Math.abs(alphaR) > 0.02 ? 1 : 0);
    this.slipF = alphaF; this.slipR = alphaR;

    // --- Suma de fuerzas y momento ---
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const Fdrag = S.drag * u * Math.abs(u);
    const Froll = (S.rolling + extraRoll * Math.min(1, vAbs / 8)) * Math.sign(u) * Math.min(1, vAbs / 0.6);
    const slopeSin = tp.slope * cosRel;
    let Flong = FxR + FxF * cd - FyF * sd - Fdrag - Froll - m * G * slopeSin;
    const Flat = FyR + FyF * cd + FxF * sd;
    const Mz = a * (FyF * cd + FxF * sd) - b * FyR;

    // Detenido con freno o sin acelerar: evita que el auto "se arrastre".
    if (vAbs < 0.25 && drive < 0.05 && Math.abs(w) < 0.5) {
      this.vx *= 0.8; this.vz *= 0.8; this.yawRate *= 0.8;
      Flong = 0;
    }

    const axl = Flong / m, ayl = Flat / m;
    this.vx += (axl * fx + ayl * lx) * dt;
    this.vz += (axl * fz + ayl * lz) * dt;
    this.yawRate += (Mz / S.inertia) * dt;

    // Control de estabilidad: limita la guiñada a lo que permite la
    // adherencia y corrige el sobreviraje (como un ESC real, simplificado).
    if (this.assists.esc && vAbs > 5) {
      const muAvg = (muF + muR) * 0.5 * (1 + down / (m * G));
      const rMax = muAvg * G / vAbs;
      let rRef = u * Math.tan(delta) / L;
      rRef = Math.max(-rMax, Math.min(rMax, rRef));
      const err = this.yawRate - rRef;
      const over = Math.sign(err) === Math.sign(this.yawRate) && Math.abs(this.yawRate) > Math.abs(rRef);
      if (over && (Math.abs(beta) > 0.035 || Math.abs(err) > 0.12)) {
        this.yawRate -= err * Math.min(1, dt * 5);
      }
    }

    // A muy baja velocidad pasa a un modelo cinemático (estable).
    if (vAbs < 2.2) {
      const k = (1 - vAbs / 2.2) * Math.min(1, dt * 18);
      this.yawRate += (u * Math.tan(delta) / L - this.yawRate) * k;
      const w2 = this.vx * lx + this.vz * lz;
      this.vx -= lx * w2 * k; this.vz -= lz * w2 * k;
    }

    this.heading += this.yawRate * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    this.u = u; this.w = w; this.speed = speed;
    this.axF += (axl - this.axF) * Math.min(1, dt * 7);
    this.ayF += (ayl - this.ayF) * Math.min(1, dt * 7);
    this.load = Math.min(1, Math.hypot(FyR / (capR + 1), FxR / (capR + 1)));

    // --- Intensidad de derrape (marcas y chirrido) ---
    const slideR = Math.max(0, (Math.abs(alphaR) - 0.09) / 0.14);
    const slideF = Math.max(0, (Math.abs(alphaF) - 0.10) / 0.16);
    const brakeSkid = brakeIn > 0.5 && vAbs > 8 ? (FbF / (capF + 1) - 0.8) * 3 : 0;
    this.skidR = Math.min(1, Math.max(slideR, lockR && vAbs > 2 ? 1 : 0, this.wheelspin, brakeSkid * 0.6)) * Math.min(1, vAbs / 4 + this.wheelspin);
    this.skidF = Math.min(1, Math.max(slideF, lockF ? 1 : 0, brakeSkid)) * Math.min(1, vAbs / 4);

    // --- Rotación visual de las ruedas ---
    this.wheelRotF += (u / S.wheelRadius) * dt;
    if (!lockR) this.wheelRotR += (u / S.wheelRadius + this.wheelspin * 40 * Math.sign(Fdrive || 1)) * dt;

    // --- Suspensión visual: cabeceo y balanceo (resorte-amortiguador) ---
    const wn = 11, zeta = 0.42;
    const pitchT = -this.axF * 0.0040 - Math.atan(tp.slope * cosRel);
    const rollT = this.ayF * 0.0042;
    this.pitchV += ((pitchT - this.pitch) * wn * wn - 2 * zeta * wn * this.pitchV) * dt;
    this.rollV += ((rollT - this.roll) * wn * wn - 2 * zeta * wn * this.rollV) * dt;
    this.pitch += this.pitchV * dt;
    this.roll += this.rollV * dt;

    // Vibración de pianos y pasto
    const bumpT = rough > 0 ? (Math.random() - 0.5) * 0.03 * rough * Math.min(1, speed / 15) : 0;
    this.bumpV += ((bumpT - this.bump) * 900 - 30 * this.bumpV) * dt;
    this.bump += this.bumpV * dt;
    this.rough = rough;

    // Altura sobre el suelo
    const gy = tp.y + track.crossHeight(tp.lat, tp.curb);
    this.y += (gy - this.y) * Math.min(1, dt * 20);
  }

  // Aplica un impulso en un punto de contacto (rcx, rcz relativo al CG).
  // Devuelve la velocidad normal de impacto.
  applyContact(rcx, rcz, nx, nz, e, mu) {
    const S = this.spec;
    const invM = 1 / S.mass, invI = 1 / S.inertia;
    const vcx = this.vx + this.yawRate * rcz, vcz = this.vz - this.yawRate * rcx;
    const vn = vcx * nx + vcz * nz;
    if (vn >= 0) return 0;
    const rn = rcz * nx - rcx * nz;
    const jn = -(1 + e) * vn / (invM + rn * rn * invI);
    this.vx += jn * nx * invM; this.vz += jn * nz * invM; this.yawRate += rn * jn * invI;
    // fricción tangencial
    const tx = -nz, tz = nx;
    const vcx2 = this.vx + this.yawRate * rcz, vcz2 = this.vz - this.yawRate * rcx;
    const vt = vcx2 * tx + vcz2 * tz;
    const rt = rcz * tx - rcx * tz;
    let jt = -vt / (invM + rt * rt * invI);
    const maxJt = mu * jn;
    jt = Math.max(-maxJt, Math.min(maxJt, jt));
    this.vx += jt * tx * invM; this.vz += jt * tz * invM; this.yawRate += rt * jt * invI;
    return -vn;
  }

  // Choque contra los muros laterales (esquinas del auto vs. muro).
  collideWalls(track) {
    const S = this.spec, tp = this.tp;
    const W = track.def.wallOffset - 0.05;
    const sinH = Math.sin(this.heading), cosH = Math.cos(this.heading);
    const fx = sinH, fz = cosH, lx = cosH, lz = -sinH;
    const sinRel = fx * tp.lx + fz * tp.lz;
    const cosRel = fx * (-tp.lz) + fz * tp.lx;
    // la proyección puede estar desactualizada tras el paso: recalcular lateral
    const hl = S.length / 2 - 0.08, hw = S.width / 2;
    let worst = 0, side = 0, rcx = 0, rcz = 0;
    for (let k = 0; k < 4; k++) {
      const dl = k < 2 ? hl : -hl;
      const dw = (k % 2 === 0) ? hw : -hw;
      const latC = tp.lat + dl * sinRel + dw * cosRel;
      let pen = 0, sd = 0;
      if (latC > W) { pen = latC - W; sd = 1; } else if (latC < -W) { pen = -W - latC; sd = -1; }
      if (pen > worst) { worst = pen; side = sd; rcx = dl * fx + dw * lx; rcz = dl * fz + dw * lz; }
    }
    this.impact = 0;
    if (worst <= 0) return 0;
    const nx = -side * tp.lx, nz = -side * tp.lz;   // apunta hacia la pista
    this.x += nx * worst; this.z += nz * worst;
    tp.lat -= side * worst;
    const v = this.applyContact(rcx, rcz, nx, nz, 0.22, 0.32);
    this.impact = v;
    this.impactX = this.x + rcx; this.impactZ = this.z + rcz;
    return v;
  }
}

// Choques entre autos: cada auto se aproxima con dos círculos.
export function collideCars(cars) {
  const R = 1.0, OFF = 1.2;
  let maxImpact = 0;
  for (let i = 0; i < cars.length; i++) {
    const A = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const B = cars[j];
      const dxc = B.x - A.x, dzc = B.z - A.z;
      if (dxc * dxc + dzc * dzc > 36) continue;
      const afx = Math.sin(A.heading), afz = Math.cos(A.heading);
      const bfx = Math.sin(B.heading), bfz = Math.cos(B.heading);
      for (let ka = -1; ka <= 1; ka += 2) {
        for (let kb = -1; kb <= 1; kb += 2) {
          const ax = A.x + afx * OFF * ka, az = A.z + afz * OFF * ka;
          const bx = B.x + bfx * OFF * kb, bz = B.z + bfz * OFF * kb;
          let nx = ax - bx, nz = az - bz;
          const d = Math.hypot(nx, nz);
          if (d >= 2 * R || d < 1e-4) continue;
          nx /= d; nz /= d;
          const pen = 2 * R - d;
          A.x += nx * pen * 0.5; A.z += nz * pen * 0.5;
          B.x -= nx * pen * 0.5; B.z -= nz * pen * 0.5;
          const cx = (ax + bx) * 0.5, cz = (az + bz) * 0.5;
          const rax = cx - A.x, raz = cz - A.z, rbx = cx - B.x, rbz = cz - B.z;
          const vax = A.vx + A.yawRate * raz, vaz = A.vz - A.yawRate * rax;
          const vbx = B.vx + B.yawRate * rbz, vbz = B.vz - B.yawRate * rbx;
          const vn = (vax - vbx) * nx + (vaz - vbz) * nz;
          if (vn >= 0) continue;
          const ra = raz * nx - rax * nz, rb = rbz * nx - rbx * nz;
          const k = 1 / A.spec.mass + 1 / B.spec.mass + ra * ra / A.spec.inertia + rb * rb / B.spec.inertia;
          const jn = -(1 + 0.25) * vn / k;
          A.vx += jn * nx / A.spec.mass; A.vz += jn * nz / A.spec.mass; A.yawRate += ra * jn / A.spec.inertia;
          B.vx -= jn * nx / B.spec.mass; B.vz -= jn * nz / B.spec.mass; B.yawRate -= rb * jn / B.spec.inertia;
          const imp = -vn;
          if (imp > maxImpact) maxImpact = imp;
          if (imp > A.impact) { A.impact = imp; A.impactX = cx; A.impactZ = cz; }
          if (imp > B.impact) { B.impact = imp; B.impactX = cx; B.impactZ = cz; }
        }
      }
    }
  }
  return maxImpact;
}
