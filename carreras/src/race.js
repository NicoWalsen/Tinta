// Reglas de carrera: parrilla, progreso, vueltas, posiciones y llegada.
import { RACE } from './config.js';

export class RaceState {
  constructor(track, cars, laps) {
    this.track = track;
    this.cars = cars;
    this.laps = laps;
    this.time = 0;
    this.finishOrder = [];
    this.entries = cars.map(car => ({
      car,
      total: 0,           // distancia recorrida desde la largada (m)
      lastS: 0,
      lap: 0,             // vueltas completas
      lapStart: 0,
      lapTimes: [],
      best: Infinity,
      finished: false,
      finishTime: 0,
      position: 0,
      wrongWay: 0,
    }));
  }

  // Ubica los autos en la parrilla (detrás de la línea de largada).
  grid() {
    const L = this.track.length;
    this.entries.forEach((e, k) => {
      const s = L - 10 - k * RACE.gridSpacing;
      const lat = (k % 2 === 0 ? 1 : -1) * RACE.gridLateral;
      e.car.place(this.track, s, lat);
      e.lastS = e.car.tp.s;
      e.total = e.car.tp.s - L;
      e.lap = 0; e.lapTimes = []; e.best = Infinity; e.finished = false; e.lapStart = 0;
    });
    this.time = 0;
    this.finishOrder = [];
    this.updatePositions();
  }

  // Avanza el reloj y el progreso de cada auto. Devuelve eventos.
  update(dt) {
    const L = this.track.length;
    const events = [];
    this.time += dt;
    for (const e of this.entries) {
      const s = e.car.tp.s;
      let d = s - e.lastS;
      if (d < -L / 2) d += L;
      if (d > L / 2) d -= L;
      e.lastS = s;
      if (e.finished) continue;
      e.total += d;
      const lapsDone = Math.floor(e.total / L);
      if (lapsDone > e.lap && e.total > 0) {
        const lt = this.time - e.lapStart;
        e.lap = lapsDone;
        if (lapsDone >= 1) {
          e.lapTimes.push(lt);
          const isBest = lt < e.best;
          if (isBest) e.best = lt;
          events.push({ type: 'lap', entry: e, time: lt, best: isBest });
        }
        e.lapStart = this.time;
        if (e.lap >= this.laps) {
          e.finished = true;
          e.finishTime = this.time;
          this.finishOrder.push(e);
          events.push({ type: 'finish', entry: e });
        }
      }
      // sentido contrario
      const tp = e.car.tp;
      const tfx = -tp.lz, tfz = tp.lx;
      const dot = Math.sin(e.car.heading) * tfx + Math.cos(e.car.heading) * tfz;
      if (dot < -0.3 && e.car.speed > 4) e.wrongWay += dt; else e.wrongWay = Math.max(0, e.wrongWay - dt * 2);
    }
    this.updatePositions();
    return events;
  }

  updatePositions() {
    const sorted = [...this.entries].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.total - a.total;
    });
    sorted.forEach((e, i) => { e.position = i + 1; });
    this.sorted = sorted;
  }

  currentLapTime(e) {
    return e.finished ? 0 : this.time - e.lapStart;
  }
}

export function formatTime(t) {
  if (!isFinite(t) || t <= 0) return '--:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(3)}`;
}
