// Coffee Craft Racing - game loop and glue.
import * as THREE from '../vendor/three.module.min.js';
import { DATA, loadData } from './data.js';
import { server, initServer, account, aiText, aiJson } from './api.js';
import { h, $, pick, clamp, money, fmtClock, saveCanvasPNG } from './util.js';
import { LOGO_SVG, foodSVG, svgURI, BAG_MOTIFS, kindFor } from './art.js';
import { initAudio, setMuted, isMuted, sfx, setTrance, setChannel } from './audio.js';
import * as eco from './economy.js';
import { buildWorld } from './world.js';
import { buildEnvironment } from './traffic.js';
import { createPhone } from './phone.js';
import { cbContext, nextCbMessage } from './cb.js';
import { buildTrack } from './track.js';
import { buildHighland } from './highland.js';
import { buildIslands } from './islands.js';
import { createRace, STRATA, strataOf } from './race.js';
import { CARS, carById } from './cars.js';

const SAVE_KEY = 'coffeecraftracing.save';
const GAME_NAME = 'Coffee Craft Racing';
const state = { minutes: 8 * 60, day: 1, weather: 'cloudy', diary: [], contacts: [], chats: {}, news: [], roastsUnlocked: ['light', 'medium', 'dark'], roastTries: 0, owns: {}, buzzed: null };
let world, scene, camera, renderer, env, phone, clock, LEVELS, track, race;
let paused = true, started = false, modalOpen = false, modalLock = false;
const keys = new Set();
const input = { gas: false, brake: false, padX: 0, edge: {} };

$('#intro-logo').innerHTML = LOGO_SVG;

const newRaceState = () => ({ points: 0, races: 0, wins: 0, best: {}, car: 'round', level: 'forest', difficulty: 'normal', boosts: 0, cash: 25, coffees: 0 });
const R = () => (state.race ||= newRaceState());
const unlockedCars = () => CARS.filter((c) => R().points >= c.unlock);

// ----------------------------------------------------------- notifications
function notify(text, opts = {}) {
  const el = h('div', { class: 'notif ' + (opts.kind || '') }, text);
  el.onclick = () => { el.remove(); opts.onclick?.(); };
  $('#notifs').append(el);
  while ($('#notifs').children.length > 4) $('#notifs').firstChild.remove();
  setTimeout(() => el.remove(), opts.ms || 7000);
  if (opts.sound !== false) sfx('chime');
}
const prompt_ = (t) => { const p = $('#prompt'); p.style.display = t ? 'block' : 'none'; if (t) p.textContent = t; };

// ----------------------------------------------------------- game context shared with the phone
async function chatReply(name, text) {
  const ai = await aiText(`You are ${name}, a friendly fellow driver and coffee fan texting the player of a casual racing game. Reply in one short sentence.`, [{ role: 'user', content: text }]);
  G.lastAi = !!ai;
  return ai ? ai.replace(/\s+/g, ' ').slice(0, 240) : pick(['Ha! See you at the next coffee stand.', 'Nice. Mind the curves out there.', 'Good luck on the road!']);
}
const G = {
  state, notify, setPaused: (p) => { paused = p || modalOpen; },
  price: (b, base) => base,
  menuFor: (b) => DATA.businesses.find((x) => x.id === b.id)?.menu || b.newMenu || [],
  snapshot: () => ({ state, player: { x: 0, z: 0 } }),
  restore: (sv) => { Object.assign(state, sv.state); ensureState(); notify('Game loaded.'); },
  autoPending: () => { for (const d of [...state.bank.decisions]) eco.applyDecision(state, d, eco.heuristic(state, d), 'player', true); },
  aiText, npcReply: chatReply, printSheet,
  mapInfo: () => ({ track, player: race.player(), ai: race.ai() }),
  mini: () => ({ state, notify, sfx, aiText, aiJson, BAG_MOTIFS, server, npcReply: chatReply, money, eco, DATA, closeModal, price: G.price, unlockRoast, h, foodSVG, svgURI, pickRoast: () => DATA.roastStyles.filter((r) => state.roastsUnlocked.includes(r.id)) }),
};
function unlockRoast() { const nxt = DATA.roastStyles.find((r) => !state.roastsUnlocked.includes(r.id) && state.roastTries >= r.need); if (nxt) { state.roastsUnlocked.push(nxt.id); notify(`New roast style unlocked: ${nxt.name}!`); return nxt; } return null; }
function ensureState() {
  const r = R(); for (const [k, v] of Object.entries(newRaceState())) if (r[k] === undefined) r[k] = v;
  if (r.points < carById(r.car).unlock) r.car = 'round';
}

// ----------------------------------------------------------- modal helpers
function openModal(build, onClose, lock = false) {
  const card = $('#modal-card'); card.replaceChildren();
  build(card);
  $('#modal').classList.remove('hidden'); modalOpen = true; paused = true; modalLock = lock;
  $('#modal').onclose = onClose;
}
function closeModal() {
  $('#modal').classList.add('hidden'); modalOpen = false; modalLock = false; paused = phone.pausesWorld() || !started;
  const f = $('#modal').onclose; $('#modal').onclose = null; f?.();
}
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal' && !modalLock) closeModal(); });

// ----------------------------------------------------------- boot
async function boot() {
  $('#intro-status').textContent = 'Loading…';
  await loadData(); await initServer();
  LEVELS = await (await fetch('data/tracks.json')).json();
  renderer = new THREE.WebGLRenderer({ canvas: $('#game'), antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(52, 1, 0.5, 600);
  const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize); resize();
  world = buildWorld(scene, DATA.businesses);
  env = buildEnvironment(scene, renderer);
  eco.createEconomy(state); Object.assign(state, { day: 1 }); ensureState();
  wireEconomy();
  phone = createPhone(G);
  env.onWeather = (w) => { state.weather = w; if (w === 'rain') { setTrance(true, 120); notify('It starts to rain.', { sound: false }); } };
  loadLevel(R().level);
  clock = new THREE.Clock();
  wireInput(); wireUI();
  if (localStorage.getItem(SAVE_KEY)) $('#continue').classList.remove('hidden');
  $('#intro-status').textContent = server.available ? `Server: ${server.storage}${server.ai ? ' · AI: ' + server.aiProvider : ' · AI off'}` : 'Static mode (no PHP): saves stay in this browser.';
  renderer.setAnimationLoop(frame);
  window.__cc = { state, world, THREE, scene, camera, eco, G, renderer, frame, get race() { return race; }, get track() { return track; } };
}

function loadLevel(id) {
  const lvl = LEVELS.levels.find((l) => l.id === id && l.ready) || LEVELS.levels.find((l) => l.ready);
  if (track) { track.remove(); race?.dispose(); }
  track = lvl.theme === 'highland' ? buildHighland(scene, lvl) : lvl.theme === 'islands' ? buildIslands(scene, lvl) : buildTrack(scene, lvl); R().level = lvl.id;
  if (world.farWall) world.farWall.visible = lvl.theme !== 'highland'; // that cliff backdrop would stand across the highway approach
  // skyline towers that would stand on the island route's approach are hidden
  for (const b of world.skyline || []) b.mesh.visible = !(lvl.theme === 'islands' && track.P.some((p, i) => i % 3 === 0 && Math.hypot(p.x - b.x, p.z - b.z) < b.r + 30));
  const open = lvl.theme === 'highland' || lvl.theme === 'islands';
  if (scene.fog) { scene.fog.near = open ? 90 : 60; scene.fog.far = open ? 340 : 230; }
  race = createRace(scene, track, {
    count: (n) => { const c = $('#countdown'); c.textContent = n > 0 ? n : 'GO!'; sfx(n > 0 ? 'click' : 'bell'); if (!n) setTimeout(() => { c.textContent = ''; }, 800); },
    bump: () => sfx('hit'),
    crash: () => sfx('punch'),
    finish: onFinish,
  });
  race.camera = camera;
  setupGrid();
}
const setupGrid = () => race.setup({ carId: R().car, difficulty: R().difficulty, points: R().points, boosts: R().boosts });

function wireEconomy() {
  eco.onEvent((type, e) => {
    if (type === 'news') { state.news.push({ day: state.day, text: e.text }); if (state.news.length > 80) state.news.shift(); if (Math.random() < 0.3) notify('📰 ' + e.text, { kind: 'news', onclick: () => phone.open('news') }); }
    else if (type === 'notify') notify(e.text, { kind: e.kind, onclick: e.onclick });
    else if (type === 'decision') notify('🏦 A bank decision awaits: ' + e.text.slice(0, 70) + '…', { kind: 'decision', ms: 12000, onclick: () => phone.open('settings', { tab: 'Bank', bankTab: 'Decisions' }) });
    else if (type === 'day') { saveLocal(); aiNews(); }
  });
}
async function aiNews() {
  if (!server.ai) return;
  const recent = state.news.slice(-4).map((n) => n.text).join(' ');
  const t = await aiText('You write one-sentence, playful, local-news items for a small racing town by the sea. No real people.', [{ role: 'user', content: `Day ${state.day}, ${state.weather}. Recent: ${recent}. Write one new short story.` }]);
  if (t) { state.news.push({ day: state.day, text: t.slice(0, 240) }); notify('📰 ' + t.slice(0, 90), { kind: 'news', onclick: () => phone.open('news') }); }
}

let cbT = 20, cbBusy = false;
async function cbPost() {
  if (cbBusy) return;
  cbBusy = true;
  try {
    const log = (state.cb ||= []);
    const m = await nextCbMessage(cbContext(G, track, race), log.slice(-4));
    log.push({ handle: m.handle, text: m.text, ai: m.ai }); if (log.length > 60) log.shift();
    if (!state.cbQuiet) notify(`📻 ${m.handle}: ${m.text.slice(0, 80)}`, { sound: false, ms: 4500, onclick: () => phone.open('cb') });
    if (phone.isOpen()) phone.render();
  } finally { cbBusy = false; }
}

// ----------------------------------------------------------- save / load (browser storage; the PHP server is optional)
function saveLocal() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ state, player: { x: 0, z: 0 } })); } catch { /* quota */ }
  if (server.user) account.saveGame(G.snapshot()).catch(() => { /* offline: local save still exists */ });
}
function loadLocal() { try { const sv = JSON.parse(localStorage.getItem(SAVE_KEY)); if (sv) { Object.assign(state, sv.state); ensureState(); if (state.musicChannel) setChannel(state.musicChannel); return true; } } catch { /* ignore */ } return false; }

// ----------------------------------------------------------- input
function wireInput() {
  const act = { '.': 'gas', ',': 'brake', '/': 'horn', "'": 'coffee' };
  addEventListener('keydown', (e) => {
    if (e.target.matches?.('input,textarea,select')) return;
    const k = e.key;
    if (act[k]) { e.preventDefault(); if (k === '.') input.gas = true; else if (k === ',') input.brake = true; else if (!e.repeat) input.edge[act[k]] = true; return; }
    if (k === 'p' || k === 'P' || k === 'Escape') { if (modalOpen) { if (!modalLock) closeModal(); } else if (phone.isOpen()) phone.close(); else togglePause(); return; }
    if (k === 'Tab') { e.preventDefault(); phone.isOpen() ? phone.close() : phone.open(); return; }
    if (k === 'm' || k === 'M') { toggleMute(); return; }
    if (k.startsWith('Arrow')) e.preventDefault();
    keys.add(k.toLowerCase());
  });
  addEventListener('keyup', (e) => { keys.delete(e.key.toLowerCase()); if (e.key === '.') input.gas = false; if (e.key === ',') input.brake = false; });
  addEventListener('blur', () => { keys.clear(); input.gas = input.brake = false; });
  const pad = $('#pad'); const held = new Set();
  const upd = () => {
    let x = 0; for (const d of held) x += Number(d.split(',')[0]);
    input.padX = clamp(x, -1, 1);
    pad.querySelectorAll('.d[data-d]').forEach((b) => b.classList.toggle('on', held.has(b.dataset.d)));
  };
  const fromPoint = (e) => {
    const r = pad.getBoundingClientRect(); const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    held.clear(); if (Math.abs(dx) >= 0.22) held.add(`${Math.sign(dx)},0`); upd();
  };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); fromPoint(e); e.preventDefault(); });
  pad.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') fromPoint(e); });
  const end = () => { held.clear(); upd(); };
  pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end);
  document.querySelectorAll('.ab').forEach((b) => {
    const k = b.dataset.k, hold = k === 'gas' || k === 'brake';
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); if (hold) input[k] = true; else input.edge[k] = true; b.classList.add('on'); if (!hold) setTimeout(() => b.classList.remove('on'), 120); });
    if (hold) for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => { input[k] = false; b.classList.remove('on'); });
  });
}
function readDrive() {
  const left = keys.has('arrowleft') || keys.has('a'), right = keys.has('arrowright') || keys.has('d');
  const steer = clamp((left ? 1 : 0) - (right ? 1 : 0) - input.padX, -1, 1);
  const gas = input.gas || keys.has('arrowup') || keys.has('w'), brake = input.brake || keys.has('arrowdown') || keys.has('s');
  return { steer, thr: gas && !brake ? 1 : brake ? -1 : 0 };
}

function toggleMute() { setMuted(!isMuted()); $('#btn-mute').textContent = isMuted() ? '🔇' : '🔊'; }
function togglePause() {
  if (!started || modalLock) return;
  const p = $('#pause'); const show = p.classList.contains('hidden');
  p.classList.toggle('hidden', !show); paused = show || modalOpen || phone.pausesWorld();
}

function wireUI() {
  $('#play').onclick = () => start(false);
  $('#intro-terms').onclick = (e) => { e.preventDefault(); phone.open('settings', { tab: 'Terms' }); };
  $('#continue').onclick = () => start(true);
  $('#btn-pause').onclick = togglePause; $('#btn-mute').onclick = toggleMute;
  $('#btn-phone').onclick = () => (phone.isOpen() ? phone.close() : phone.open());
  $('#p-resume').onclick = togglePause;
  $('#p-settings').onclick = () => { togglePause(); phone.open('settings'); };
  $('#p-shot').onclick = takeShot;
  $('#p-exit').onclick = () => { $('#pause').classList.add('hidden'); $('#shot-box').classList.add('hidden'); toMenu(); };
}
function start(cont) {
  initAudio(); $('#intro').classList.add('hidden'); $('#hud').classList.remove('hidden');
  if (cont) { loadLocal(); if (R().level !== track.level.id) loadLevel(R().level); }
  started = true; setupGrid(); openSelect();
}
function toMenu() { $('#race-hud').classList.add('hidden'); $('#countdown').textContent = ''; setupGrid(); openSelect(); }

// ----------------------------------------------------------- car / level select
function openSelect() {
  const r = R();
  openModal((card) => {
    const draw = () => {
      card.replaceChildren();
      const strat = strataOf(r.points);
      const levelBtns = LEVELS.levels.filter((l) => l.ready).map((l) => h('button', { class: 'opt' + (l.id === r.level ? ' sel' : ''), onclick: () => { if (l.id !== r.level) loadLevel(l.id); draw(); } }, h('b', {}, (l.ready ? '' : '🚧 ') + l.name), h('small', {}, l.ready ? l.blurb : 'Coming soon')));
      const carBtns = CARS.map((c) => { const lock = r.points < c.unlock; return h('button', { class: 'opt' + (c.id === r.car ? ' sel' : '') + (lock ? ' locked' : ''), onclick: () => { if (lock) return notify(`Unlocks at ${c.unlock} points (you have ${r.points}).`, { sound: false }); r.car = c.id; setupGrid(); draw(); } }, h('b', {}, (lock ? '🔒 ' : '') + c.name), h('small', {}, lock ? `Needs ${c.unlock} points` : c.blurb), h('small', {}, `Top ${Math.round(c.top * 3.6)} km/h · Grip ${c.grip < 4 ? 'loose' : c.grip < 6 ? 'medium' : 'firm'}`)); });
      const sel = h('select', { onchange: (e) => { r.difficulty = e.target.value; setupGrid(); } }, h('option', { value: 'normal' }, 'Normal — relaxed robo-taxi'), h('option', { value: 'challenging' }, 'Challenging — all-out driver, 1.5× points'));
      sel.value = r.difficulty;
      card.append(h('h2', {}, '🏁 Choose your road and ride'),
        h('div', { class: 'small' }, `Points ${r.points} · Wins ${r.wins}/${r.races} · Robo-taxi skill tier ${strat + 1} of ${STRATA.length}`),
        h('h4', {}, 'Road'), h('div', { class: 'select-grid' }, ...levelBtns),
        h('h4', {}, 'Car'), h('div', { class: 'select-grid' }, ...carBtns),
        h('h4', {}, 'Difficulty'), sel,
        h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn big', onclick: startRace }, '🏁 Start race'), h('button', { class: 'btn alt', onclick: () => { phone.open(); } }, '📱 Phone')));
    };
    draw();
  }, null, true);
}
function startRace() {
  closeModal(); setupGrid(); $('#race-hud').classList.remove('hidden'); race.start(); paused = false;
  notify('Hold ⏩ for gas, steer with the pad or arrow keys. ☕ pulls into a coffee stand when you slow down nearby.', { sound: false, ms: 8000 });
}

// ----------------------------------------------------------- finish / rewards
function onFinish(res) {
  const r = R(), mult = r.difficulty === 'challenging' ? 1.5 : 1;
  const pts = Math.round((res.pos === 1 ? 80 : 30) * mult), cash = Math.round((res.pos === 1 ? 150 : 40) * mult);
  const before = new Set(unlockedCars().map((c) => c.id));
  r.points += pts; r.races++; if (res.pos === 1) r.wins++;
  const prevBest = r.best[track.level.id]; const record = !prevBest || res.time < prevBest; if (record) r.best[track.level.id] = res.time;
  r.cash += cash; sfx(res.pos === 1 ? 'bell' : 'chime');
  const fresh = unlockedCars().filter((c) => !before.has(c.id));
  saveLocal();
  setTimeout(() => {
    $('#race-hud').classList.add('hidden');
    openModal((card) => {
      card.append(h('h2', {}, res.pos === 1 ? '🏆 You won!' : '🥈 Second place'),
        h('div', { class: 'kv' }, h('span', {}, 'Time'), h('span', {}, fmtTime(res.time) + (record ? ' ⭐ new best' : ''))),
        h('div', { class: 'kv' }, h('span', {}, 'Points'), h('span', {}, `+${pts}${mult > 1 ? ' (Challenging bonus)' : ''} → ${r.points}`)),
        h('div', { class: 'kv' }, h('span', {}, 'Prize money'), h('span', {}, money(cash))),
        ...fresh.map((c) => h('p', {}, `🔓 Unlocked: ${c.name}!`)),
        h('div', { class: 'row' }, h('button', { class: 'btn big', onclick: () => { closeModal(); startRace(); } }, '🏁 Race again'), h('button', { class: 'btn alt', onclick: () => { closeModal(); toMenu(); } }, 'Menu')));
    }, null, true);
  }, 1800);
}
const fmtTime = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

// ----------------------------------------------------------- coffee stands
const BARISTA_LINES = ['Welcome in! Fresh pot, hot off the trailer.', 'You look like you are in a hurry. Coffee helps with that.', 'Robo-taxi went by earlier. It did not even wave.', 'The road is the best part of the day, honestly.', 'Take it easy on the curves ahead!', 'On the house: a smile. The coffee is extra.'];
const itemSrc = (name, kind) => svgURI(foodSVG(kindFor(name, kind) || 'platter'));
function openStand(stand) {
  const log = []; const r = R(); const b = stand.barista;
  openModal((card) => {
    const chat = h('div', { class: 'chat' }); const inp = h('input', { placeholder: `Say something to ${b.name}…`, style: 'width:100%' });
    const say = (who, text, isAi = false) => { log.push({ who, text }); chat.append(h('div', { class: 'say' + (who === 'You' ? ' me' : '') }, h('b', {}, who + ': '), text, isAi ? h('span', { class: 'small', title: 'Written by the AI', style: 'margin-left:6px;opacity:.7' }, '✨AI') : '')); chat.scrollTop = chat.scrollHeight; };
    const reply = async (text) => {
      const ai = await aiText(`You are ${b.name}, ${b.bio}, working at ${stand.name}, a roadside coffee stand in a casual racing game. Be warm and funny. Reply in 1-2 short sentences, no stage directions.`, log.map((l) => ({ role: l.who === 'You' ? 'user' : 'assistant', content: l.text })).slice(-8));
      say(b.name, ai ? ai.replace(/\s+/g, ' ').slice(0, 280) : pick(BARISTA_LINES), !!ai);
    };
    const send = (t) => { if (!t) return; inp.value = ''; say('You', t); reply(t); };
    const wallet = h('div', { class: 'small' }, '');
    const refresh = () => { wallet.textContent = `Cash ${money(r.cash)} · Carrying ${r.boosts}/3`; };
    const buy = (item) => {
      if (r.boosts >= 3) return notify('You can carry at most 3 coffees.', { sound: false });
      if (r.cash < item[1]) return notify('Not enough funds.');
            r.cash -= item[1]; r.boosts++; r.coffees++; race.boosts = r.boosts; sfx('coin');
      if (!state.diary.some((d) => d.name === item[0])) state.diary.push({ name: item[0], kind: kindFor(item[0], item[2]) || item[2], where: stand.name, day: state.day });
      notify(`☕ ${item[0]} packed for the road (${r.boosts}/3). Press ☕ while driving to boost.`, { sound: false });
      say(b.name, pick(['Excellent choice!', 'Enjoy it — go fast, drink responsibly.', 'That one is my favorite too.'])); refresh();
    };
    refresh();
    const menu = h('div', {}, h('h3', {}, `☕ ${stand.name}`), wallet,
      ...LEVELS.menu.map((it) => h('div', { class: 'bizcard', style: 'display:flex;gap:8px;align-items:center' }, h('img', { src: itemSrc(it[0], it[2]), style: 'width:48px;height:48px;background:#fff;border-radius:8px' }),
        h('div', { style: 'flex:1' }, h('b', {}, it[0]), h('div', { class: 'small' }, it[3])), h('button', { class: 'btn', onclick: () => buy(it) }, money(it[1])))));
    const talk = h('div', {}, h('h3', {}, `💬 ${b.name}`), h('div', { class: 'small' }, 'Barista'), chat, inp,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => send(inp.value) }, 'Say'), h('button', { class: 'btn alt', onclick: () => send('How is the road ahead?') }, 'Road tips'), h('button', { class: 'btn alt', onclick: () => send('What is good here?') }, 'Recommend')));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(inp.value); e.stopPropagation(); });
    card.style.maxWidth = '900px';
    card.append(h('div', { class: 'split' }, menu, talk), h('div', { class: 'row' }, h('button', { class: 'btn warn', onclick: closeModal }, '🚗 Back on the road')));
    say(b.name, pick(BARISTA_LINES));
  }, () => { $('#modal-card').style.maxWidth = ''; });
}

// ----------------------------------------------------------- screenshots
function takeShot() {
  const box = $('#shot-box'); box.classList.remove('hidden'); box.replaceChildren();
  const r = renderer.domElement; renderer.render(scene, camera);
  const c = document.createElement('canvas'); const bar = 34; c.width = r.width; c.height = r.height + bar;
  const g = c.getContext('2d'); g.drawImage(r, 0, 0);
  g.fillStyle = '#23291f'; g.fillRect(0, r.height, c.width, bar);
  g.fillStyle = '#efe6cc'; g.font = `${Math.max(12, Math.round(c.width / 62))}px Georgia, serif`; g.textBaseline = 'middle';
  g.fillText(`${GAME_NAME} by Daniel McKeown https://altaredwood.work — ${new Date().toLocaleString()}`, 10, r.height + bar / 2);
  box.replaceChildren(c, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => saveCanvasPNG(c, `Coffee_Craft_Racing_${new Date().toISOString().replace(/[:.]/g, '-')}.png`).catch(() => notify('Could not save the screenshot.', { sound: false })) }, '💾 Save')));
}
function printSheet(kind, intro, nodes) {
  const sheet = $('#print-sheet'); const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  renderer.render(scene, camera);
  sheet.replaceChildren(h('div', { style: 'text-align:center' }, h('div', { html: LOGO_SVG, style: 'width:90px;margin:auto' }), h('h1', {}, GAME_NAME)),
    h('p', {}, `${intro} — ${new Date().toLocaleString()} — Day ${state.day}, ${fmtClock(state.minutes)}, ${state.weather}.`),
    h('img', { src: renderer.domElement.toDataURL('image/jpeg', 0.7), style: 'width:100%;max-height:260px;object-fit:cover' }),
    ...nodes, h('p', { style: 'margin-top:30px;font-size:12px' }, `${GAME_NAME} by Daniel McKeown — https://altaredwood.work`));
  const t = document.title; document.title = `Coffee_Craft_Racing__${kind}_${stamp}`;
  setTimeout(() => { window.print(); document.title = t; }, 100);
}

// ----------------------------------------------------------- frame
let t = 0, saveT = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05); t += dt;
  if (!started) { camera.position.set(Math.sin(t * 0.1) * 40, 25, 40); camera.lookAt(0, 3, 0); env.update(dt, state.minutes, camera.position, world.lamps, world.nightGlow); renderer.render(scene, camera); return; }
  if (!paused) tick(dt); else { input.edge = {}; race.poseCamera(camera, 0); }
  renderer.render(scene, camera);
}

function tick(dt) {
  state.day = Math.floor(state.minutes / 1440) + 1; eco.advance(state, dt * 0.5);
  state.weather = env.weather;
  env.update(dt, state.minutes, camera.position, world.lamps, world.nightGlow); world.water?.tick(dt); world.pier?.tick(dt); world.crane?.tick(dt, t);
  track.update(dt);
  if (world.homeGlow) { const k = 0.8 + Math.sin(t * 1.7) * 0.2; world.homeGlow.light.intensity = 14 * k; world.homeGlow.halo.material.opacity = 0.18 + 0.12 * k; }
  if (world.flame) world.flame.scale.y = 0.8 + Math.sin(t * 11) * 0.2;
  const drive = readDrive(); const c = race.player();
  if (input.edge.horn) sfx('horn');
  const near = race.phase === 'go' ? race.nearStand() : null;
  if (input.edge.coffee) {
    if (near && c.speed < 12) openStand(near);
    else if (race.boost()) { R().boosts = race.boosts; notify('☕ Coffee boost!', { sound: false, ms: 1500 }); sfx('sip'); }
    else if (near) notify('Slow down to pull into the stand.', { sound: false, ms: 1500 });
    else if (race.boosts <= 0 && race.phase === 'go') notify('No coffee on board. Pull into a roadside stand!', { sound: false, ms: 2000 });
  }
  input.edge = {};
  if (!modalOpen) { race.update(dt, drive); race.poseCamera(camera, dt); }
  prompt_(near ? (c.speed < 12 ? `☕ Pull into ${near.name}` : `☕ ${near.name} — slow down to stop`) : '');
  updateHud();
  cbT -= dt; if (cbT <= 0 && race.phase === 'go') { cbT = 45 + Math.random() * 60; cbPost(); }
  saveT += dt; if (saveT > 45) { saveT = 0; saveLocal(); }
}

function updateHud() {
  const c = race.player(), pr = race.progress(); const ord = race.position() === 1 ? '1st' : '2nd';
  $('#rh-pos').textContent = ord; $('#rh-time').textContent = fmtTime(race.phase === 'count' ? 0 : race.t);
  $('#rh-speed').textContent = `${Math.round(c.speed * 3.6)} km/h`;
  $('#rh-boost').textContent = (c.boost > 0 ? '🔥 ' : '') + '☕×' + race.boosts;
  $('#rh-me').style.left = pr.p * 100 + '%'; $('#rh-ai').style.left = pr.a * 100 + '%';
}

boot().catch((e) => { console.error(e); $('#intro-status').textContent = 'Could not start: ' + e.message; });
