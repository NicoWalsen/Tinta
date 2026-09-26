// Interfaz en pantalla: posición, vuelta, torre de tiempos, cronómetro,
// velocímetro con luces de cambio y minimapa.
import { formatTime } from './race.js';

const $ = (id) => document.getElementById(id);
const hex = (c) => '#' + c.toString(16).padStart(6, '0');

export class HUD {
  constructor(track) {
    this.track = track;
    this.el = {
      root: $('hud'), pos: $('hPos'), cars: $('hCars'), lap: $('hLap'), laps: $('hLaps'),
      time: $('hTime'), best: $('hBest'), speed: $('hSpeed'), gear: $('hGear'), rpm: $('hRpm'),
      tower: $('tower'), msg: $('msg'), toast: $('toast'), last: $('hLast'),
    };
    this.leds = [];
    for (let i = 0; i < 15; i++) {
      const s = document.createElement('i');
      s.className = i < 5 ? 'g' : i < 10 ? 'a' : 'r';
      this.el.rpm.appendChild(s);
      this.leds.push(s);
    }
    this.cache = {};
    this.msgTimer = 0;
    this.toastTimer = 0;
    this.lastTimer = 0;
    this.towerTimer = 0;
    this._setupMinimap();
  }

  show(on) { this.el.root.hidden = !on; }

  _set(key, el, value) {
    if (this.cache[key] !== value) { this.cache[key] = value; el.textContent = value; }
  }

  message(text, cls = '', dur = 1.6) {
    const m = this.el.msg;
    m.textContent = text;
    m.className = 'msg show ' + cls;
    this.msgTimer = dur;
  }

  // Semáforo de largada: n luces rojas encendidas de 5.
  lights(n) {
    const m = this.el.msg;
    m.innerHTML = '<span class="lights">' + [0, 1, 2, 3, 4].map(i => `<i class="${i < n ? 'on' : ''}"></i>`).join('') + '</span>';
    m.className = 'msg show';
    this.msgTimer = 999;
  }

  toast(text, dur = 2.5) {
    const t = this.el.toast;
    t.textContent = text;
    t.classList.add('show');
    this.toastTimer = dur;
  }

  lapFlash(time, kind) {
    const l = this.el.last;
    l.textContent = formatTime(time);
    l.className = 'last show ' + kind;       // 'fl' violeta, 'pb' verde, '' amarillo
    this.lastTimer = 4;
  }

  update(dt, race, entry, car, names) {
    const e = this.el;
    this._set('pos', e.pos, String(entry.position));
    this._set('lap', e.lap, String(Math.min(race.laps, Math.max(1, entry.lap + 1))));
    this._set('laps', e.laps, String(race.laps));
    this._set('cars', e.cars, '/' + race.entries.length);
    this._set('time', e.time, formatTime(Math.max(0.0001, race.currentLapTime(entry))));
    this._set('best', e.best, formatTime(entry.best));
    const kmh = Math.round(car.speed * 3.6);
    this._set('speed', e.speed, String(kmh));
    const g = car.gear === -1 ? 'R' : (car.speed < 0.5 && car.input.throttle < 0.05 ? 'N' : String(car.gear));
    this._set('gear', e.gear, g);

    // Luces de RPM
    const S = car.spec;
    const lo = 3800, hi = S.upshift;
    const n = Math.max(0, Math.min(15, Math.floor((car.rpm - lo) / (hi - lo) * 15)));
    const flash = car.rpm > hi - 120 && (performance.now() % 160) < 80;
    const key = n + (flash ? 'f' : '');
    if (this.cache.leds !== key) {
      this.cache.leds = key;
      this.leds.forEach((l, i) => l.classList.toggle('on', flash || i < n));
      e.rpm.classList.toggle('flash', flash);
    }

    this.towerTimer -= dt;
    if (this.towerTimer <= 0) { this.towerTimer = 0.3; this._tower(race, entry, names); }

    if (this.msgTimer > 0) { this.msgTimer -= dt; if (this.msgTimer <= 0) e.msg.classList.remove('show'); }
    if (this.toastTimer > 0) { this.toastTimer -= dt; if (this.toastTimer <= 0) e.toast.classList.remove('show'); }
    if (this.lastTimer > 0) { this.lastTimer -= dt; if (this.lastTimer <= 0) e.last.classList.remove('show'); }
  }

  _tower(race, entry, names) {
    const rows = race.sorted;
    const leader = rows[0];
    let html = '';
    rows.forEach((r, i) => {
      const info = names.get(r.car);
      let gap;
      if (i === 0) gap = r.finished ? 'META' : 'LÍDER';
      else if (r.finished && leader.finished) gap = '+' + (r.finishTime - leader.finishTime).toFixed(1);
      else {
        const d = leader.total - r.total;
        const laps = Math.floor(d / race.track.length);
        gap = laps >= 1 ? `+${laps} V` : '+' + (d / Math.max(18, r.car.speed)).toFixed(1);
      }
      html += `<li class="${r === entry ? 'me' : ''}"><b>${r.position}</b><i style="background:${hex(info.color)}"></i><span>${info.short}</span><em>${gap}</em></li>`;
    });
    if (this.cache.tower !== html) { this.cache.tower = html; this.el.tower.innerHTML = html; }
  }

  _setupMinimap() {
    const c = $('minimap');
    this.mm = c;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = 112;
    c.width = size * dpr; c.height = size * dpr;
    this.mmCtx = c.getContext('2d');
    this.mmCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tr = this.track, b = tr.bounds;
    const pad = 8;
    const sc = Math.min((size - pad * 2) / (b.maxX - b.minX), (size - pad * 2) / (b.maxZ - b.minZ));
    const ox = pad + ((size - pad * 2) - (b.maxX - b.minX) * sc) / 2;
    const oz = pad + ((size - pad * 2) - (b.maxZ - b.minZ) * sc) / 2;
    this.mmMap = (x, z) => [ox + (x - b.minX) * sc, oz + (z - b.minZ) * sc];
    const path = new Path2D();
    for (let i = 0; i <= tr.N; i += 3) {
      const [x, y] = this.mmMap(tr.px[i % tr.N], tr.pz[i % tr.N]);
      if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
    }
    path.closePath();
    this.mmPath = path;
    this.mmSize = size;
    const [sx, sy] = this.mmMap(tr.px[0], tr.pz[0]);
    this.mmStart = [sx, sy];
  }

  drawMinimap(cars, player, colors) {
    const ctx = this.mmCtx, s = this.mmSize;
    ctx.clearRect(0, 0, s, s);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 6; ctx.stroke(this.mmPath);
    ctx.strokeStyle = 'rgba(241,239,232,0.9)'; ctx.lineWidth = 2.5; ctx.stroke(this.mmPath);
    ctx.fillStyle = '#e8322b';
    ctx.fillRect(this.mmStart[0] - 1.5, this.mmStart[1] - 4, 3, 8);
    for (const c of cars) {
      if (c === player) continue;
      const [x, y] = this.mmMap(c.x, c.z);
      ctx.fillStyle = hex(colors.get(c));
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
    }
    const [px, py] = this.mmMap(player.x, player.z);
    ctx.fillStyle = '#e8322b';
    ctx.beginPath(); ctx.arc(px, py, 4.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.stroke();
  }
}
