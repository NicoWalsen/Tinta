// Asfalto GT — arranque, bucle principal y flujo de la carrera.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { RACE, DRIVERS, PLAYER_COLORS, DIFFICULTY } from './config.js';
import { Track } from './track.js';
import { Vehicle, collideCars } from './vehicle.js';
import { AIDriver } from './ai.js';
import { RaceState, formatTime } from './race.js';
import { World } from './world.js';
import { createCar } from './carModel.js';
import { Effects } from './effects.js';
import { CameraRig, CAMERA_MODES } from './camera.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { HUD } from './hud.js';
import { makeSmoke, makeRadial, makeContactShadow } from './textures.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------- ajustes guardados
const store = {
  get(k, d) { try { const v = localStorage.getItem('asfalto.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('asfalto.' + k, JSON.stringify(v)); } catch (e) { /* sin almacenamiento */ } },
};
const settings = {
  control: store.get('control', 'botones'),
  laps: store.get('laps', 3),
  difficulty: store.get('difficulty', 'normal'),
  color: store.get('color', 'rojo'),
  quality: store.get('quality', 'auto'),
  assists: store.get('assists', true),
  sound: store.get('sound', true),
  camera: store.get('camera', 0),
};
if (settings.control === 'inclinar') settings.control = 'botones'; // el permiso se pide de nuevo al elegirlo

const isTouch = matchMedia('(pointer: coarse)').matches;
// ?autopilot: el auto del jugador se maneja solo (demostración y pruebas)
const AUTOPILOT = new URLSearchParams(location.search).has('autopilot');
const QUALITY = {
  alta: { dpr: 2.0, shadow: 2048, bloom: true, msaa: 4 },
  media: { dpr: 1.5, shadow: 2048, bloom: true, msaa: 4 },
  baja: { dpr: 1.0, shadow: 1024, bloom: false, msaa: 0 },
};
function qualityProfile() {
  if (settings.quality === 'auto') return { ...QUALITY.alta, dpr: 1.75, auto: true };
  return { ...QUALITY[settings.quality] };
}

function fatal(msg) {
  $('loading').hidden = true;
  $('fatalText').textContent = msg;
  $('fatal').hidden = false;
}

// ---------------------------------------------------------------- renderizador
const canvas = $('gl');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  fatal('Este navegador no pudo iniciar los gráficos 3D (WebGL). Prueba con Safari actualizado.');
  throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.86;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 0.3, 9000);

let q = qualityProfile();
let dpr = Math.min(q.dpr, window.devicePixelRatio || 1);
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: q.msaa });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
// Umbral alto: el cielo junto al sol llega a ~10 (medido), así que solo
// superan el umbral el disco solar, las luces y las chispas.
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.4, 13);
bloom.enabled = q.bloom;
// Limita el brillo que entra al bloom: el disco solar vale miles de veces
// más que una luz y, sin este tope, su halo cubriría toda la pantalla.
bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace(
  'vec4 texel = texture2D( tDiffuse, vUv );',
  'vec4 texel = texture2D( tDiffuse, vUv ); texel.rgb = min( texel.rgb, vec3( 40.0 ) );')
  // canal más brillante en vez de luminancia: una luz roja brilla sin volverse blanca
  .replace('float v = luminance( texel.xyz );', 'float v = max( texel.r, max( texel.g, texel.b ) );');
bloom.materialHighPassFilter.needsUpdate = true;
bloom.highPassUniforms.smoothWidth.value = 5;
composer.addPass(bloom);
composer.addPass(new OutputPass());

let viewW = 1, viewH = 1;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  viewW = w; viewH = h;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  applyViewOffset();
  camera.updateProjectionMatrix();
}
function applyViewOffset() {
  if (state === 'menu' && viewW > 720) camera.setViewOffset(viewW, viewH, -viewW * 0.2, 0, viewW, viewH);
  else camera.clearViewOffset();
}

// ---------------------------------------------------------------- cielo, luz y entorno
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 31), THREE.MathUtils.degToRad(215));
const sky = new Sky();
sky.scale.setScalar(8000);
const skyU = sky.material.uniforms;
skyU.turbidity.value = 2.8;
skyU.rayleigh.value = 1.5;
skyU.mieCoefficient.value = 0.0028;
skyU.mieDirectionalG.value = 0.78;
skyU.sunPosition.value.copy(sunDir);
skyU.cloudCoverage.value = 0.36;
skyU.cloudDensity.value = 0.55;
skyU.cloudElevation.value = 0.55;
scene.add(sky);
scene.fog = new THREE.FogExp2(0xb3c2d2, 0.00029);

const sun = new THREE.DirectionalLight(0xfff0dc, 2.75);
sun.castShadow = true;
sun.shadow.mapSize.set(q.shadow, q.shadow);
const SH = 55;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 520 });
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.045;
sun.shadow.radius = 2.2;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xd3e3ff, 0x55603f, 0.12));

function buildEnvironment() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const s2 = new Sky();
  s2.scale.setScalar(100);
  for (const k of Object.keys(skyU)) {
    const v = skyU[k].value;
    s2.material.uniforms[k].value = v && v.clone ? v.clone() : v;
  }
  s2.material.uniforms.showSunDisc.value = 0;
  envScene.add(s2);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 32), new THREE.MeshBasicMaterial({ color: 0x46533a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2;
  envScene.add(ground);
  const envRT = pmrem.fromScene(envScene, 0.015, 0.1, 200);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
}

// La sombra del sol cubre ~110 m alrededor del auto y se ajusta a la grilla
// de texels para que no "tiemble" al moverse.
const lightRight = new THREE.Vector3().crossVectors(sunDir, new THREE.Vector3(0, 1, 0)).normalize();
const lightUp = new THREE.Vector3().crossVectors(lightRight, sunDir).normalize();
const _t = new THREE.Vector3();
function updateSun(x, y, z) {
  const texel = (2 * SH) / sun.shadow.mapSize.x;
  _t.set(x, y, z);
  let a = _t.dot(lightRight), b = _t.dot(lightUp);
  const c = _t.dot(sunDir);
  a = Math.round(a / texel) * texel; b = Math.round(b / texel) * texel;
  _t.copy(lightRight).multiplyScalar(a).addScaledVector(lightUp, b).addScaledVector(sunDir, c);
  sun.target.position.copy(_t);
  sun.position.copy(_t).addScaledVector(sunDir, 260);
  sun.target.updateMatrixWorld();
}

// ---------------------------------------------------------------- estado del juego
let state = 'loading';
let paused = false;
let track, world, race, hud, effects, rig, input, audio;
const cars = [], models = [], ais = [];
const names = new Map(), carColors = new Map();
let player, playerModel, playerAI, playerEntry;
const playerAIInput = { throttle: 0, brake: 0, steer: 0, handbrake: false };
let countdownT = 0, lightsOn = 0, goAt = 0, grid = [];
let finishT = 0, resultsShown = false;
let respawnCooldown = 0, stuckT = 0, wrongWarn = 0;
let time = 0;

function playerColor() {
  return (PLAYER_COLORS.find(c => c.id === settings.color) || PLAYER_COLORS[0]).hex;
}

async function boot() {
  const bar = $('lBar'), txt = $('lText');
  const progress = (p, t) => { bar.style.width = Math.round(p * 100) + '%'; if (t) txt.textContent = t; };
  resize();
  progress(0.04, 'Trazando el circuito…');
  await nextFrame();
  track = new Track();
  const worldQ = settings.quality === 'auto' ? 'alta' : settings.quality;
  world = new World(scene, track, renderer, worldQ);
  const labels = ['Pintando el asfalto…', 'Colocando pianos y pasto…', 'Levantando muros…', 'Modelando colinas…', 'Esculpiendo montañas…', 'Plantando árboles…', 'Llenando las tribunas…'];
  let k = 0;
  const gen = world.build();
  progress(0.08, labels[0]);
  await nextFrame();
  while (!gen.next().done) {
    k++;
    progress(0.08 + 0.62 * k / labels.length, labels[Math.min(k, labels.length - 1)]);
    await nextFrame();
  }

  progress(0.74, 'Preparando los autos…');
  await nextFrame();
  const shadowTex = makeContactShadow();
  let aiIdx = 0;
  const calipers = [0xd01818, 0xf2c200, 0x1d4fb8, 0x222222, 0xd01818, 0xf07000];
  for (let slot = 0; slot < RACE.cars; slot++) {
    const v = new Vehicle();
    const isPlayer = slot === RACE.playerSlot;
    const d = isPlayer ? null : DRIVERS[aiIdx++];
    const color = isPlayer ? playerColor() : d.color;
    const model = createCar({ color, shadowTex, rim: slot % 2 ? 'dark' : 'silver', caliper: calipers[slot] });
    scene.add(model.root);
    cars.push(v); models.push(model);
    names.set(v, { short: isPlayer ? 'TÚ' : d.name.toUpperCase(), color });
    carColors.set(v, color);
    if (isPlayer) { player = v; playerModel = model; }
    else ais.push(new AIDriver(v, track, DIFFICULTY.normal.skill, slot + 1));
  }
  playerAI = new AIDriver(player, track, 0.86, 77);

  effects = new Effects(scene, { smoke: makeSmoke(), spark: makeRadial() });
  effects.light = 1.0;
  hud = new HUD(track);
  rig = new CameraRig(camera);
  rig.mode = clamp(settings.camera, 0, CAMERA_MODES.length - 1);
  audio = new AudioEngine();
  audio.enabled = settings.sound;
  input = new Input($('controls'), { camera: cycleCamera, reset: respawn, pause: togglePause });
  input.setMode(settings.control);

  race = new RaceState(track, cars, settings.laps);
  race.grid();
  for (let i = 0; i < cars.length; i++) models[i].update(cars[i]);

  progress(0.86, 'Iluminando el cielo…');
  await nextFrame();
  buildEnvironment();
  updateSun(player.x, player.y, player.z);

  progress(0.94, 'Compilando sombreadores…');
  await nextFrame();
  state = 'menu';
  resize();
  rig.orbit(0, player);
  try {
    if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
    else renderer.compile(scene, camera);
  } catch (e) { /* se compilará al dibujar */ }
  progress(1, 'Listo');

  setupMenu();
  $('loading').hidden = true;
  showMenu();
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- menú y pantallas
function setupMenu() {
  const sw = $('swatches');
  for (const c of PLAYER_COLORS) {
    const b = document.createElement('button');
    b.style.background = '#' + c.hex.toString(16).padStart(6, '0');
    b.dataset.v = c.id;
    b.setAttribute('aria-label', 'Color ' + c.label);
    b.addEventListener('click', () => {
      settings.color = c.id; store.set('color', c.id);
      playerModel.paint.color.setHex(c.hex);
      names.get(player).color = c.hex; carColors.set(player, c.hex);
      refreshMenu();
    });
    sw.appendChild(b);
  }
  for (const seg of document.querySelectorAll('.seg[data-opt]')) {
    const opt = seg.dataset.opt;
    for (const b of seg.querySelectorAll('button')) {
      b.addEventListener('click', () => selectOption(opt, b.dataset.v));
    }
  }
  $('bStart').addEventListener('click', () => startRace());
  $('bResume').addEventListener('click', () => togglePause());
  $('bRestart').addEventListener('click', () => { $('pause').hidden = true; paused = false; startRace(); });
  $('bQuit').addEventListener('click', () => toMenu());
  $('bAgain').addEventListener('click', () => startRace());
  $('bMenu').addEventListener('click', () => toMenu());
  $('bCam').addEventListener('click', cycleCamera);
  $('bReset').addEventListener('click', respawn);
  $('bPause').addEventListener('click', togglePause);
  refreshMenu();
}

async function selectOption(opt, raw) {
  let v = raw;
  if (opt === 'laps') v = parseInt(raw, 10);
  if (opt === 'assists' || opt === 'sound') v = raw === 'true';
  if (opt === 'control' && v === 'inclinar') {
    const ok = await input.enableTilt();
    if (!ok) {
      note('No se pudo activar el giroscopio en este navegador. Usa Botones o Deslizar.');
      return;
    }
    note('Sostén el iPhone como un volante. Se calibra al largar.');
  }
  settings[opt] = v;
  store.set(opt, v);
  if (opt === 'control') input.setMode(v);
  if (opt === 'quality') applyQuality();
  if (opt === 'sound') audio.setEnabled(v);
  if (opt === 'laps') race.laps = v;
  refreshMenu();
}

function note(text) {
  const t = $('mNote');
  if (!t) return;
  t.textContent = text;
  t.hidden = !text;
}

function refreshMenu() {
  for (const seg of document.querySelectorAll('.seg[data-opt]')) {
    const cur = String(settings[seg.dataset.opt]);
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('sel', b.dataset.v === cur);
  }
  for (const b of $('swatches').children) b.classList.toggle('sel', b.dataset.v === settings.color);
  $('mRecord').textContent = formatTime(store.get('bestLap', 0));
}

function applyQuality() {
  q = qualityProfile();
  dpr = Math.min(q.dpr, window.devicePixelRatio || 1);
  bloom.enabled = q.bloom;
  if (sun.shadow.mapSize.x !== q.shadow) {
    sun.shadow.mapSize.set(q.shadow, q.shadow);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  for (const t of [composer.renderTarget1, composer.renderTarget2]) {
    if (t.samples !== q.msaa) { t.samples = q.msaa; t.dispose(); }
  }
  resize();
}

function showMenu() {
  $('menu').hidden = false;
  hud.show(false);
  $('controls').hidden = true;
  applyViewOffset();
}

function toMenu() {
  state = 'menu';
  paused = false;
  $('pause').hidden = true;
  $('results').hidden = true;
  input.enabled = false;
  input.reset();
  audio.silence();
  effects.clear();
  race = new RaceState(track, cars, settings.laps);
  race.grid();
  world.setStartLights(0);
  refreshMenu();
  showMenu();
}

function startRace() {
  audio.enabled = settings.sound;
  audio.init();
  audio.setEnabled(settings.sound);
  if (settings.control === 'inclinar') input.enableTilt().then(ok => { if (!ok) { input.setMode('botones'); hud.toast('Giroscopio no disponible: usando botones'); } });
  requestWakeLock();
  $('menu').hidden = true;
  $('results').hidden = true;
  $('pause').hidden = true;
  paused = false;
  race = new RaceState(track, cars, settings.laps);
  race.grid();
  playerEntry = race.entries[RACE.playerSlot];
  const base = DIFFICULTY[settings.difficulty].skill;
  ais.forEach((ai, i) => { ai.baseSkill = ai.skill = base + (i - 2) * 0.007; ai.stuck = 0; ai.avoid = 0; });
  const a = settings.assists;
  player.assists = { abs: a, tcs: a, esc: a, steer: true };
  player.input = input.state;
  input.reset();
  input.enabled = true;
  effects.clear();
  hud.show(true);
  $('controls').hidden = false;
  state = 'countdown';
  applyViewOffset();
  camera.updateProjectionMatrix();
  rig.ready = false;
  countdownT = 0; lightsOn = 0; goAt = 5.4 + Math.random() * 0.9;
  grid = cars.map(c => ({ x: c.x, z: c.z, h: c.heading }));
  world.setStartLights(0);
  finishT = 0; resultsShown = false; respawnCooldown = 0; stuckT = 0;
  hud.lights(0);
}

function togglePause() {
  if (state !== 'race' && state !== 'countdown') return;
  paused = !paused;
  $('pause').hidden = !paused;
  input.enabled = !paused;
  input.reset();
  if (paused) audio.silence(); else audio.resume();
}

function cycleCamera() {
  if (state !== 'race' && state !== 'countdown' && state !== 'finished') return;
  const name = rig.next();
  settings.camera = rig.mode; store.set('camera', rig.mode);
  hud.toast('Cámara: ' + name, 1.2);
}

function respawn() {
  if (state !== 'race' || respawnCooldown > 0) return;
  const tp = player.tp;
  player.place(track, tp.s, clamp(tp.lat, -3, 3));
  respawnCooldown = 1.5;
  effects.skids.last.clear();
  hud.toast('De vuelta en la pista', 1.4);
}

let wakeLock = null;
async function requestWakeLock() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { wakeLock = null; }
}

function showResults() {
  resultsShown = true;
  const rows = race.sorted;
  const leader = rows[0];
  let fastest = Infinity;
  for (const e of race.entries) fastest = Math.min(fastest, e.best);
  const L = track.length;
  let html = '';
  for (const e of rows) {
    const info = names.get(e.car);
    let t;
    if (e === leader && e.finished) t = formatTime(e.finishTime);
    else if (e.finished) t = '+' + (e.finishTime - leader.finishTime).toFixed(3);
    else {
      const lapsDown = Math.floor((leader.total - e.total) / L);
      t = lapsDown >= 1 ? `+${lapsDown} vuelta${lapsDown > 1 ? 's' : ''}` : 'En pista';
    }
    const color = '#' + info.color.toString(16).padStart(6, '0');
    html += `<tr class="${e === playerEntry ? 'me' : ''}"><td>${e.position}</td><td><span class="chip" style="background:${color}"></span>${info.short}</td><td>${t}</td><td class="${e.best === fastest ? 'fl' : ''}">${formatTime(e.best)}</td></tr>`;
  }
  $('rBody').innerHTML = html;
  const p = playerEntry.position;
  $('rTitle').textContent = p === 1 ? '¡GANASTE!' : `TERMINASTE ${p}º`;
  $('results').hidden = false;
  $('controls').hidden = true;
  input.enabled = false;
}

// ---------------------------------------------------------------- simulación
const H = 1 / 240;
let acc = 0;
function simulate(dt) {
  acc += dt;
  let steps = 0;
  for (const c of cars) c.hit = null;
  while (acc >= H && steps < 12) {
    for (const c of cars) { c.step(H, track); c.collideWalls(track); }
    collideCars(cars);
    for (const c of cars) {
      if (c.impact > 0 && (!c.hit || c.impact > c.hit.v)) c.hit = { v: c.impact, x: c.impactX, z: c.impactZ };
      c.impact = 0;
    }
    acc -= H;
    steps++;
  }
  if (steps >= 12) acc = 0;
}

function handleRaceEvents(events) {
  for (const ev of events) {
    if (ev.entry !== playerEntry) continue;
    if (ev.type === 'lap') {
      let fastest = Infinity;
      for (const e of race.entries) if (e !== playerEntry) fastest = Math.min(fastest, e.best);
      const kind = ev.time <= fastest ? 'fl' : ev.best ? 'pb' : '';
      hud.lapFlash(ev.time, kind);
      const rec = store.get('bestLap', 0);
      if (!rec || ev.time < rec) store.set('bestLap', ev.time);
      if (playerEntry.lap === race.laps - 1) hud.message('ÚLTIMA VUELTA', 'info', 2.2);
    } else if (ev.type === 'finish') {
      state = 'finished';
      finishT = 0;
      const p = playerEntry.position;
      hud.message(p === 1 ? '¡VICTORIA!' : `META · ${p}º`, p === 1 ? 'go' : 'info', 3);
      player.input = playerAIInput;
    }
  }
}

function frameCars(dt) {
  // IA
  for (const ai of ais) {
    const e = race.entries[cars.indexOf(ai.car)];
    const gap = e.total - playerEntry.total;
    ai.skill = ai.baseSkill * (1 - clamp(gap / 3200, -0.035, 0.035));
    ai.update(dt, cars, state === 'race' || state === 'finished');
  }
  if (state === 'finished' || (AUTOPILOT && state === 'race')) {
    player.input = playerAIInput;
    playerAI.update(dt, cars, true);
  }
}

// ---------------------------------------------------------------- bucle principal
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsSlow = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt <= 0) return;
  time += dt;

  if (!paused) {
    if (state === 'menu') {
      rig.orbit(time, player);
    } else if (state === 'countdown') {
      input.update(dt);
      countdownT += dt;
      const n = Math.min(5, Math.floor(countdownT));
      if (n > lightsOn) { lightsOn = n; world.setStartLights(n); hud.lights(n); audio.beep(560, 0.14); }
      for (const ai of ais) ai.update(dt, cars, false);
      simulate(dt);
      // autos quietos en la grilla (el motor sí puede acelerar en vacío)
      cars.forEach((c, i) => { c.x = grid[i].x; c.z = grid[i].z; c.heading = grid[i].h; c.vx = c.vz = c.yawRate = 0; });
      if (countdownT >= goAt) {
        state = 'race';
        world.setStartLights(0);
        hud.message('¡YA!', 'go', 1.1);
        audio.beep(990, 0.45, 0.4);
        input.calibrate();
        race.time = 0;
        for (const e of race.entries) e.lapStart = 0;
      }
      rig.follow(dt, player);
    } else if (state === 'race' || state === 'finished') {
      input.update(dt);
      frameCars(dt);
      simulate(dt);
      handleRaceEvents(race.update(dt));
      respawnCooldown = Math.max(0, respawnCooldown - dt);
      // avisos: sentido contrario y atascado
      if (state === 'race') {
        if (playerEntry.wrongWay > 1.2) { wrongWarn -= dt; if (wrongWarn <= 0) { hud.message('SENTIDO CONTRARIO', 'warn', 0.9); wrongWarn = 1; } }
        if (player.speed < 1 && input.state.throttle > 0.5) stuckT += dt; else stuckT = 0;
        if (stuckT > 3) { hud.toast('¿Atascado? Toca ↺ para volver a la pista', 2.5); stuckT = -4; }
      }
      if (state === 'finished') {
        finishT += dt;
        if (finishT > 1.6) rig.orbit(time * 0.8, player, 10); else rig.follow(dt, player);
        if (finishT > 3.2 && !resultsShown) showResults();
      } else rig.follow(dt, player);
    }

    // efectos, modelos y audio
    if (state !== 'menu') {
      cars.forEach((c, i) => {
        if (c.hit) { c.impact = c.hit.v; c.impactX = c.hit.x; c.impactZ = c.hit.z; }
        effects.updateCar(c, i, dt, track);
        c.impact = 0;
      });
      if (player.hit && player.hit.v > 1.5) { audio.impact(player.hit.v); rig.kick(Math.min(1, player.hit.v / 12)); }
      if (player.shiftEvent > 0) audio.shift();
      let rival = null, rd = Infinity;
      for (const c of cars) if (c !== player) { const d = Math.hypot(c.x - player.x, c.z - player.z); if (d < rd) { rd = d; rival = c; } }
      audio.update(dt, player, rd < 80 ? rival : null, player);
      hud.update(dt, race, playerEntry, player, names);
      if ((Math.round(time * 60) & 1) === 0) hud.drawMinimap(cars, player, carColors);
    }
    effects.update(dt, camera, viewH * dpr);
    for (let i = 0; i < cars.length; i++) models[i].update(cars[i]);
  }

  // sol y cielo siguen a la cámara/auto
  const fx = Math.sin(player.heading), fz = Math.cos(player.heading);
  updateSun(player.x + fx * 22, player.y, player.z + fz * 22);
  sky.position.copy(camera.position);
  skyU.time.value += dt;
  composer.render(dt);

  // calidad adaptativa: baja la resolución si el iPhone no llega a ~55 FPS
  if (q.auto && state !== 'loading') {
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 2) {
      const avg = fpsAcc / fpsN;
      if (avg > 1 / 52 && dpr > 1.0) { fpsSlow++; if (fpsSlow >= 2) { dpr = Math.max(1.0, dpr - 0.2); resize(); fpsSlow = 0; } }
      else fpsSlow = 0;
      fpsAcc = 0; fpsN = 0;
    }
  }
}

// ---------------------------------------------------------------- eventos del sistema
window.addEventListener('resize', resize);
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if ((state === 'race' || state === 'countdown') && !paused) togglePause();
    audio && audio.suspend();
  } else if (audio) {
    audio.resume();
    if (state === 'race' || state === 'countdown') requestWakeLock();
  }
});
matchMedia('(orientation: portrait)').addEventListener('change', (e) => {
  if (e.matches && isTouch && (state === 'race' || state === 'countdown') && !paused) togglePause();
  setTimeout(resize, 250);
});
document.addEventListener('touchend', () => { if (audio && audio.ctx && audio.ctx.state !== 'running' && !paused && state !== 'menu') audio.resume(); }, { passive: true });
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  fatal('El iPhone liberó la memoria gráfica. Toca para recargar el juego.');
  $('fatal').addEventListener('click', () => location.reload(), { once: true });
});

// Acceso para depurar desde la consola
window.__asfalto = {
  get state() { return state; }, get player() { return player; }, get race() { return race; }, get dpr() { return dpr; }, settings,
  skipCountdown(t) { countdownT = t === undefined ? goAt : t; },
  get debug() { return { bloom, sky, scene, effects, sun, renderer, composer }; },
  camera(m) { rig.mode = m; rig.ready = false; },
  // Adelanta la carrera `sec` segundos sin dibujar (solo para pruebas)
  warp(sec) {
    for (let t = 0; t < sec; t += 1 / 60) {
      input.update(1 / 60); frameCars(1 / 60); simulate(1 / 60); handleRaceEvents(race.update(1 / 60));
      cars.forEach((c, i) => effects.updateCar(c, i, 1 / 60, track));
      effects.update(1 / 60, camera, viewH * dpr);
    }
    return { s: player.tp.s, kmh: player.speed * 3.6, lap: playerEntry.lap, pos: playerEntry.position };
  },
};

boot().catch((e) => {
  console.error(e);
  fatal('No se pudo iniciar el juego: ' + (e && e.message ? e.message : e));
});
