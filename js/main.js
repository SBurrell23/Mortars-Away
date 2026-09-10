// Boot, menus, lobby protocol and the frame loop.

import { UNIT_PALETTES, UNIT_SPRITES } from './art-units.js';
import { ENV_PALETTES, ENV_SPRITES } from './art-env.js';
import { buildSet, buildSprite } from './pixelart.js';
import { Renderer, upscale, TILE_SCALE, FIRE_BTN } from './render.js';
import { Effects } from './effects.js';
import { Game, ST } from './game.js';
import { Net, LocalNet, PROTOCOL_VERSION } from './net.js';
import { MAPS, mapById, WORLD_W, WORLD_H } from './maps.js';
import { buildId } from './buildid.js';
import { AI_LEVELS, aiLevelById } from './ai.js';
import { randomSeed } from './rng.js';
import * as sfx from './audio.js';

const $ = (id) => document.getElementById(id);

const app = {
  renderer: null,
  effects: null,
  sprites: {},
  tiles: {},
  boomFrames: [],
  game: null,
  net: null,
  screen: 'title',
  myName: 'GUNNER',
  peerName: '',
  selectedMap: MAPS[0].id,
  isHost: false,
  solo: false,
  aiLevel: 'gunner',
  inMatch: false,
  rematchMe: false,
  rematchThem: false,
  opts: { shake: true, scanlines: true, sfx: 0.85, music: 0.42 },
};

// ------------------------------------------------------------- assets

function buildAssets() {
  const unit = buildSet(UNIT_SPRITES, UNIT_PALETTES, 'u:');
  const env = buildSet(ENV_SPRITES, ENV_PALETTES, 'e:');
  app.sprites = Object.assign({}, env, unit);

  app.boomFrames = [];
  for (let i = 0; i < 6; i++) {
    const f = app.sprites['boom_' + i];
    if (f) app.boomFrames.push(f);
  }

  // Terrain tiles are used as repeat patterns, so they must be pre-scaled.
  const tileNames = ['grass', 'dirt', 'clay', 'rock', 'snow', 'sand', 'ash', 'mud'];
  app.tiles = {};
  for (const n of tileNames) {
    const def = ENV_SPRITES['tile_' + n];
    if (!def) continue;
    try {
      app.tiles[n] = upscale(buildSprite(def, ENV_PALETTES, null), TILE_SCALE);
    } catch (e) {
      console.warn('tile build failed', n, e.message);
    }
  }

  const missing = [];
  for (const k of ['mortarBase_allied', 'mortarBarrel_allied', 'shell_medium', 'boom_0']) {
    if (!app.sprites[k]) missing.push(k);
  }
  if (missing.length) console.warn('missing core sprites:', missing.join(', '));
}

// ------------------------------------------------------------ screens

const SCREENS = ['title', 'join', 'lobby', 'howto', 'options', 'results'];

function show(name) {
  app.screen = name;
  for (const s of SCREENS) {
    const el = $('screen-' + s);
    if (el) el.classList.toggle('hidden', s !== name);
  }
  $('hud-corner').classList.toggle('hidden', name !== null && name !== 'game');
  if (name === 'title' || name === 'join' || name === 'lobby'
      || name === 'howto' || name === 'options') {
    sfx.playMusic('menu');
  }
}

function showGame() {
  app.screen = 'game';
  for (const s of SCREENS) {
    const el = $('screen-' + s);
    if (el) el.classList.add('hidden');
  }
  $('hud-corner').classList.remove('hidden');
}

function overlay(text, btnLabel, onBtn) {
  const o = $('overlay');
  $('overlay-text').textContent = text;
  const b = $('overlay-btn');
  if (btnLabel) {
    b.textContent = btnLabel;
    b.classList.remove('hidden');
    b.onclick = onBtn;
  } else {
    b.classList.add('hidden');
  }
  o.classList.remove('hidden');
}

function hideOverlay() { $('overlay').classList.add('hidden'); }

// -------------------------------------------------------- map picker

function buildMapGrid() {
  const grid = $('map-grid');
  grid.innerHTML = '';
  MAPS.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'map-card';
    b.dataset.map = m.id;
    const pips = Array.from({ length: 5 },
      (_, i) => '<i class="' + (i < m.difficulty ? 'on' : '') + '"></i>').join('');
    b.innerHTML = '<span class="mc-name">' + m.name.toUpperCase() + '</span>'
      + '<span class="mc-diff">' + pips + '</span>';
    b.addEventListener('click', () => {
      if (!app.isHost) return;
      selectMap(m.id, true);
      sfx.uiClick();
    });
    b.addEventListener('mouseenter', () => showMapDetail(m.id));
    grid.appendChild(b);
  });
}

function buildAiGrid() {
  const grid = $('ai-grid');
  grid.innerHTML = '';
  AI_LEVELS.forEach((l) => {
    const b = document.createElement('button');
    b.className = 'ai-card';
    b.dataset.ai = l.id;
    b.innerHTML = '<span class="ac-name">' + l.name + '</span>'
      + '<span class="ac-blurb">' + l.blurb + '</span>';
    b.addEventListener('click', () => { selectAi(l.id); sfx.uiClick(); });
    grid.appendChild(b);
  });
}

function selectAi(id) {
  app.aiLevel = id;
  document.querySelectorAll('.ai-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.ai === id);
  });
  $('slot-1').querySelector('.slot-name').textContent = aiLevelById(id).name;
  try { localStorage.setItem('mortars.ai', id); } catch (e) { /* private mode */ }
}

function showMapDetail(id) {
  const m = mapById(id);
  $('map-detail-name').textContent = m.name.toUpperCase();
  $('map-detail-desc').textContent = m.desc;
  $('map-detail-gimmick').textContent = m.gimmick;
  $('map-detail-stats').innerHTML =
    '<span>GAP <b>' + m.gap + '</b></span>'
    + '<span>WIND <b>' + Math.round(m.windBias * 100) + '%</b></span>'
    + '<span>GROUND <b>' + m.layers[0].toUpperCase() + '</b></span>'
    + '<span>DIFFICULTY <b>' + m.difficulty + '/5</b></span>';
}

function selectMap(id, broadcast) {
  app.selectedMap = id;
  document.querySelectorAll('.map-card').forEach((c) => {
    c.classList.toggle('selected', c.dataset.map === id);
  });
  showMapDetail(id);
  if (broadcast && app.net && !app.net.local) sendLobbyState();
}

function setMapPickerEnabled(on) {
  document.querySelectorAll('.map-card').forEach((c) => { c.disabled = !on; });
}

// ------------------------------------------------------------- lobby

function enterLobby(isHost, code) {
  app.isHost = isHost;
  app.rematchMe = false;
  app.rematchThem = false;
  $('ai-picker').classList.toggle('hidden', !app.solo);
  $('lobby-title').textContent = isHost ? 'STAGING AREA' : 'AWAITING ORDERS';
  $('roomcode').textContent = code || '-----';
  $('roomcode-wrap').classList.toggle('hidden', !code);
  setMapPickerEnabled(isHost);
  selectMap(app.selectedMap, false);
  updateRoster();
  $('btn-start').classList.toggle('hidden', !isHost);
  $('btn-start').disabled = true;
  $('lobby-status').textContent = isHost
    ? 'Waiting for an opponent to join.'
    : 'Connected. The host picks the ground.';
  show('lobby');
}

function updateRoster() {
  const s0 = $('slot-0'), s1 = $('slot-1');
  if (app.solo) {
    s0.querySelector('.slot-name').textContent = app.myName;
    s0.classList.add('filled');
    s1.querySelector('.slot-name').textContent = aiLevelById(app.aiLevel).name;
    s1.classList.add('filled');
    return;
  }
  const hostName = app.isHost ? app.myName : (app.peerName || 'HOST');
  const guestName = app.isHost ? (app.peerName || '') : app.myName;
  s0.querySelector('.slot-name').textContent = hostName;
  s0.classList.add('filled');
  s1.querySelector('.slot-name').textContent = guestName || 'waiting...';
  s1.classList.toggle('filled', !!guestName);
}

function sendLobbyState() {
  if (!app.net || app.net.local || !app.isHost) return;
  app.net.send({
    t: 'lobby', mapId: app.selectedMap, hostName: app.myName,
    v: PROTOCOL_VERSION, fp: buildId(),
  });
}

function showVersionMismatch() {
  overlay(
    'You and your opponent are running different builds of the game. '
    + 'Both players should reload the page (Ctrl+Shift+R) and try again.',
    'LEAVE', leaveMatch);
}

// -------------------------------------------------------------- match

function startMatch(seed, mapId, mySide, localBoth) {
  const ai = app.solo ? aiLevelById(app.aiLevel) : null;
  const names = ai
    ? [app.myName, ai.name]
    : app.isHost || localBoth
      ? [localBoth ? 'ALLIED' : app.myName, localBoth ? 'AXIS' : (app.peerName || 'ENEMY')]
      : [app.peerName || 'HOST', app.myName];

  app.game = new Game({
    renderer: app.renderer,
    effects: app.effects,
    sprites: app.sprites,
    tiles: app.tiles,
    net: app.net,
    onEvent: onGameEvent,
  });
  app.game.boomFrames = app.boomFrames;
  app.game.startMatch({ seed, mapId, mySide, localBoth, names, aiLevel: ai });
  app.inMatch = true;
  app.rematchMe = false;
  app.rematchThem = false;
  hideOverlay();
  showGame();
}

function onGameEvent(kind, data) {
  if (kind === 'gameover') {
    setTimeout(() => showResults(data), 2200);
  } else if (kind === 'desync' && data.count > 2) {
    app.game.toast = { text: 'CONNECTION UNSTABLE', t: 2.5, color: '#c9502f' };
  }
}

function showResults(data) {
  const g = app.game;
  if (!g) return;
  const won = g.localBoth && !g.ai ? true : data.winner === g.mySide;
  const draw = data.winner === -2;
  $('result-title').textContent = draw ? 'MUTUAL DESTRUCTION'
    : g.localBoth && !g.ai ? g.players[data.winner].name.toUpperCase() + ' TAKES THE FIELD'
      : won ? 'VICTORY' : 'DEFEAT';
  $('result-sub').textContent = draw
    ? 'Both batteries went up together.'
    : g.map.name + ' -- ' + (g.turn + 1) + ' rounds fired.';

  const acc = data.stats.shotsFired ? Math.round((data.stats.hits / data.stats.shotsFired) * 100) : 0;
  $('result-stats').innerHTML = [
    ['ROUNDS FIRED', data.stats.shotsFired],
    ['ROUNDS ON TARGET', data.stats.hits],
    ['ACCURACY', acc + '%'],
    ['TEXTBOOK ROUNDS', data.stats.perfects],
  ].map(([k, v]) => '<div class="stat"><span>' + k + '</span><b>' + v + '</b></div>').join('');

  $('btn-rematch').disabled = false;
  $('btn-rematch').textContent = 'REMATCH';
  $('result-status').textContent = '';
  show('results');
}

function leaveMatch() {
  app.inMatch = false;
  app.solo = false;
  app.game = null;
  if (app.net) { app.net.close(); app.net = null; }
  sfx.stopWind();
  sfx.stopMusic();
  history.replaceState(null, '', location.pathname + location.search);
  show('title');
}

// ------------------------------------------------------------ network

function wireNet(net) {
  app.net = net;

  net.addEventListener('peerjoined', () => {
    if (app.isHost) {
      $('lobby-status').textContent = 'Opponent connected. Pick the ground and open fire.';
      $('btn-start').disabled = false;
      sendLobbyState();
    }
    sfx.uiClick(0.8);
  });

  net.addEventListener('latency', (e) => {
    $('hud-ping').textContent = e.detail.ms + 'ms';
  });

  net.addEventListener('peerleft', () => {
    if (app.inMatch) {
      overlay('Your opponent has left the field.', 'LEAVE', leaveMatch);
    } else if (app.screen === 'lobby') {
      app.peerName = '';
      updateRoster();
      $('btn-start').disabled = true;
      $('lobby-status').textContent = 'Opponent disconnected. Waiting for another.';
    }
  });

  net.addEventListener('neterror', (e) => {
    if (app.inMatch) overlay(e.detail.message, 'LEAVE', leaveMatch);
    else $('lobby-status').textContent = e.detail.message;
  });

  net.addEventListener('message', (e) => onNetMessage(e.detail));
}

function onNetMessage(msg) {
  switch (msg.t) {
    case 'hello':
      if (msg.v !== PROTOCOL_VERSION || (msg.fp && msg.fp !== buildId())) {
        // One side is running stale cached modules. Refuse rather than start a
        // match that would drift apart shot by shot.
        app.net.send({ t: 'versionmismatch' });
        showVersionMismatch();
        return;
      }
      app.peerName = (msg.name || 'ENEMY').toUpperCase();
      updateRoster();
      if (app.isHost) {
        $('lobby-status').textContent = app.peerName + ' has joined. Pick the ground.';
        $('btn-start').disabled = false;
        sendLobbyState();
      }
      break;

    case 'lobby':
      if (msg.v !== undefined && (msg.v !== PROTOCOL_VERSION
          || (msg.fp && msg.fp !== buildId()))) {
        showVersionMismatch();
        return;
      }
      app.peerName = (msg.hostName || app.peerName || 'HOST').toUpperCase();
      updateRoster();
      selectMap(msg.mapId, false);
      break;

    case 'versionmismatch':
      showVersionMismatch();
      break;

    case 'start':
      startMatch(msg.seed, msg.mapId, app.isHost ? 0 : 1, false);
      break;

    case 'rematch':
      app.rematchThem = true;
      if (app.screen === 'results') {
        $('result-status').textContent = (app.peerName || 'Opponent') + ' wants another round.';
      }
      tryRematch();
      break;

    case 'bye':
      overlay('Your opponent has left the field.', 'LEAVE', leaveMatch);
      break;

    default:
      if (app.game) app.game.onMessage(msg);
      break;
  }
}

function tryRematch() {
  if (!app.rematchMe || !app.rematchThem) return;
  if (!app.isHost) return; // the host decides the new seed
  const seed = randomSeed();
  app.net.send({ t: 'start', seed, mapId: app.selectedMap });
  startMatch(seed, app.selectedMap, 0, false);
}

// -------------------------------------------------------------- input

const AIM_KEYS = {
  w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down',
  a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right',
};

function onKeyDown(e) {
  if (app.screen !== 'game' || !app.game) {
    if (e.key === 'Enter' && app.screen === 'join') $('btn-connect').click();
    return;
  }
  const g = app.game;
  const k = e.key.toLowerCase();

  if (k === ' ' || k === 'spacebar' || e.code === 'Space' || e.keyCode === 32) {
    e.preventDefault();
    if (e.repeat && g.state !== ST.LOADING) return;
    if (g.state === ST.AIM) g.beginLoading();
    else if (g.state === ST.LOADING) g.minigamePress();
    return;
  }
  if (k === 'escape') { e.preventDefault(); confirmQuit(); return; }

  const dir = AIM_KEYS[k];
  if (dir) {
    e.preventDefault();
    if (g.keyRepeat[dir] === 0) {
      g.keyRepeat[dir] = 0.0001;
      // A tap has to do something on its own: keyup can land before the next
      // frame runs, in which case the hold-repeat never gets a tick.
      if (dir === 'up') g.adjustAngle(0.5);
      else if (dir === 'down') g.adjustAngle(-0.5);
      else if (dir === 'right') g.adjustPower(0.005);
      else g.adjustPower(-0.005);
    }
  }
}

function onKeyUp(e) {
  if (!app.game) return;
  const dir = AIM_KEYS[e.key.toLowerCase()];
  if (dir) app.game.keyRepeat[dir] = 0;
}

let dragging = false;

function onPointerDown(e) {
  if (app.screen !== 'game' || !app.game) return;
  sfx.resume();
  const g = app.game;
  const p = app.renderer.toWorld(e.clientX, e.clientY);

  if (g.state === ST.LOADING) { g.minigamePress(); return; }
  if (g.state !== ST.AIM || !g.isMyTurn()) return;

  // On-canvas fire control, so the game is playable without a keyboard.
  if (p.x >= FIRE_BTN.x && p.x <= FIRE_BTN.x + FIRE_BTN.w
      && p.y >= FIRE_BTN.y && p.y <= FIRE_BTN.y + FIRE_BTN.h) {
    g.beginLoading();
    return;
  }
  // Charge slider.
  if (p.y >= WORLD_H - 34 && p.y <= WORLD_H - 8 && p.x >= 30 && p.x <= 330) {
    g.aimPower = Math.max(0.35, Math.min(1, 0.35 + ((p.x - 30) / 300) * 0.65));
    return;
  }
  dragging = true;
  g.aimAt(p.x, p.y);
}

function onPointerMove(e) {
  if (!dragging || !app.game) return;
  const p = app.renderer.toWorld(e.clientX, e.clientY);
  app.game.aimAt(p.x, p.y);
}

function onPointerUp() { dragging = false; }

function confirmQuit() {
  if (!app.inMatch) return;
  overlay('Leave the battle?', 'CONFIRM LEAVE', () => {
    if (app.net && !app.net.local) app.net.send({ t: 'bye' });
    leaveMatch();
  });
  const b = $('overlay-btn');
  // Second click anywhere else on the overlay dismisses it.
  const o = $('overlay');
  const cancel = (ev) => {
    if (ev.target === b) return;
    hideOverlay();
    o.removeEventListener('click', cancel);
  };
  o.addEventListener('click', cancel);
}

// -------------------------------------------------------------- loop

let lastTime = 0;
let lastStep = 0;

// Browsers freeze requestAnimationFrame outright in a hidden tab. For a
// turn-based network game that is not acceptable: a player who alts away in
// the middle of the opponent's shot would stop processing the match entirely
// and come back out of step. A low-rate interval watchdog runs the same step
// function whenever rAF has gone quiet, so the state machine always advances.
const MAX_DT = 0.05;

function step(dt, drawFrame) {
  if (app.game) {
    app.game.update(dt);
    if (drawFrame) app.game.draw(dt);
  } else if (drawFrame) {
    idleBackdrop(dt);
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(MAX_DT, (now - lastTime) / 1000 || 0);
  lastTime = now;
  lastStep = now;
  app.renderer.resize();
  step(dt, true);
}

function watchdog() {
  const now = performance.now();
  if (now - lastStep < 220) return;
  const elapsed = (now - lastStep) / 1000;
  lastStep = now;
  lastTime = now;
  // A hidden tab has its timers clamped to roughly one call per second, so a
  // single clamped step would run the match at a twentieth of real speed.
  // Catch up in fixed sub-steps instead, and only paint once at the end.
  // The cap stops a tab that was asleep for ten minutes from locking the
  // thread trying to replay all of it.
  const sub = Math.min(60, Math.max(1, Math.ceil(elapsed / MAX_DT)));
  for (let i = 0; i < sub; i++) step(MAX_DT, false);
  app.renderer.resize();
  step(0, true);
}

// Slow drifting menu backdrop so the title screen is not a dead rectangle.
let idleT = 0;
function idleBackdrop(dt) {
  idleT += dt;
  const r = app.renderer;
  const ctx = r.ctx;
  r.begin(null);
  const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  g.addColorStop(0, '#2a2b30');
  g.addColorStop(0.5, '#3d3a33');
  g.addColorStop(1, '#1a1712');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  const sp = app.sprites;
  if (sp.cloud_c) {
    for (let i = 0; i < 5; i++) {
      const x = ((idleT * (5 + i * 3) + i * 300) % (WORLD_W + 300)) - 150;
      ctx.globalAlpha = 0.16;
      ctx.drawImage(sp.cloud_c, x, 60 + i * 44, sp.cloud_c.width * 2.6, sp.cloud_c.height * 2.6);
      ctx.globalAlpha = 1;
    }
  }
  // A ruined skyline along the bottom.
  ctx.fillStyle = '#100e0b';
  ctx.beginPath();
  ctx.moveTo(0, WORLD_H);
  for (let x = 0; x <= WORLD_W; x += 16) {
    const h = 120 + Math.sin(x * 0.011) * 34 + Math.sin(x * 0.041 + 2) * 16;
    ctx.lineTo(x, WORLD_H - h);
  }
  ctx.lineTo(WORLD_W, WORLD_H);
  ctx.closePath();
  ctx.fill();

  const props = ['tree_dead_a', 'telegraph', 'wreck_tank', 'ruin_wall', 'tree_dead_b', 'bunker'];
  for (let i = 0; i < props.length; i++) {
    const img = sp[props[i]];
    if (!img) continue;
    const x = 90 + i * 210;
    const h = 120 + Math.sin(x * 0.011) * 34 + Math.sin(x * 0.041 + 2) * 16;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(img, x, WORLD_H - h - img.height * 2, img.width * 2, img.height * 2);
    ctx.globalAlpha = 1;
  }
  r.drawVignette();
  if (app.opts.scanlines) r.drawScanlines();
  r.end();
}

// ------------------------------------------------------------ options

function loadOpts() {
  try {
    const raw = localStorage.getItem('mortars.opts');
    if (raw) Object.assign(app.opts, JSON.parse(raw));
    const n = localStorage.getItem('mortars.name');
    if (n) app.myName = n;
    const a = localStorage.getItem('mortars.ai');
    if (a) app.aiLevel = a;
  } catch (e) { /* private mode, defaults are fine */ }
}

function saveOpts() {
  try {
    localStorage.setItem('mortars.opts', JSON.stringify(app.opts));
    localStorage.setItem('mortars.name', app.myName);
  } catch (e) { /* private mode, nothing to do */ }
}

function applyOpts() {
  sfx.setSfxVolume(app.opts.sfx);
  sfx.setMusicVolume(app.opts.music);
  $('vol-sfx').value = Math.round(app.opts.sfx * 100);
  $('vol-music').value = Math.round(app.opts.music * 100);
  $('lbl-sfx').textContent = Math.round(app.opts.sfx * 100);
  $('lbl-music').textContent = Math.round(app.opts.music * 100);
  $('opt-shake').checked = app.opts.shake;
  $('opt-scanlines').checked = app.opts.scanlines;
  if (app.effects) app.effects.shakeEnabled = app.opts.shake;
  if (app.renderer) app.renderer.scanlines = app.opts.scanlines;
}

// --------------------------------------------------------------- wire

function wireUi() {
  $('name-input').value = app.myName;
  $('name-input').addEventListener('input', (e) => {
    app.myName = (e.target.value || 'GUNNER').toUpperCase().slice(0, 14);
    saveOpts();
  });

  $('btn-host').addEventListener('click', async () => {
    sfx.resume(); sfx.uiClick();
    app.myName = ($('name-input').value || 'GUNNER').toUpperCase();
    saveOpts();
    app.solo = false;
    enterLobby(true, '.....');
    $('lobby-status').textContent = 'Opening a room...';
    const net = new Net();
    wireNet(net);
    try {
      const code = await net.host();
      $('roomcode').textContent = code;
      $('lobby-status').textContent = 'Room open. Send the code to your opponent.';
      history.replaceState(null, '', '#' + code);
    } catch (err) {
      $('lobby-status').textContent = err.message;
      $('roomcode').textContent = '-----';
    }
  });

  $('btn-join').addEventListener('click', () => {
    sfx.resume(); sfx.uiClick();
    $('join-error').textContent = '';
    show('join');
    setTimeout(() => $('code-input').focus(), 30);
  });

  $('btn-connect').addEventListener('click', async () => {
    sfx.uiClick();
    app.myName = ($('name-input').value || 'GUNNER').toUpperCase();
    saveOpts();
    const code = $('code-input').value.trim().toUpperCase();
    $('join-error').textContent = '';
    const btn = $('btn-connect');
    btn.disabled = true;
    btn.textContent = 'CONNECTING...';
    const net = new Net();
    wireNet(net);
    try {
      await net.join(code);
      app.isHost = false;
      app.solo = false;
      net.send({ t: 'hello', name: app.myName, v: PROTOCOL_VERSION, fp: buildId() });
      enterLobby(false, code);
    } catch (err) {
      $('join-error').textContent = err.message;
      app.net = null;
      try { net.close(); } catch (e) { /* nothing open */ }
    } finally {
      btn.disabled = false;
      btn.textContent = 'CONNECT';
    }
  });

  $('btn-join-back').addEventListener('click', () => { sfx.uiBack(); show('title'); });

  $('btn-practice').addEventListener('click', () => {
    sfx.resume(); sfx.uiClick();
    app.myName = ($('name-input').value || 'GUNNER').toUpperCase();
    saveOpts();
    app.solo = true;
    app.isHost = true;
    app.net = new LocalNet();
    enterLobby(true, null);
    $('lobby-title').textContent = 'PRACTICE';
    $('lobby-status').textContent = 'You take the left gun. Pick an opponent and some ground.';
    $('btn-start').disabled = false;
    setMapPickerEnabled(true);
    selectAi(app.aiLevel);
  });

  $('btn-local').addEventListener('click', () => {
    sfx.resume(); sfx.uiClick();
    app.solo = false;
    app.isHost = true;
    app.net = new LocalNet();
    enterLobby(true, null);
    $('lobby-title').textContent = 'LOCAL DUEL';
    $('lobby-status').textContent = 'Both guns on this machine. Pass the keyboard over.';
    $('btn-start').disabled = false;
    setMapPickerEnabled(true);
  });

  $('btn-start').addEventListener('click', () => {
    sfx.uiClick(1.2);
    const seed = randomSeed();
    if (app.net && app.net.local) {
      // Solo play drives only the near gun; a hot-seat duel drives both.
      startMatch(seed, app.selectedMap, 0, !app.solo);
    } else {
      app.net.send({ t: 'start', seed, mapId: app.selectedMap });
      startMatch(seed, app.selectedMap, 0, false);
    }
  });

  $('btn-lobby-leave').addEventListener('click', () => { sfx.uiBack(); leaveMatch(); });

  $('btn-copy').addEventListener('click', async () => {
    const code = $('roomcode').textContent.trim();
    const url = location.origin + location.pathname + '#' + code;
    try {
      await navigator.clipboard.writeText(url);
      $('btn-copy').textContent = 'COPIED';
      setTimeout(() => { $('btn-copy').textContent = 'COPY LINK'; }, 1400);
    } catch (e) {
      $('lobby-status').textContent = 'Share this link: ' + url;
    }
  });

  $('btn-howto').addEventListener('click', () => { sfx.uiClick(); show('howto'); });
  $('btn-howto-back').addEventListener('click', () => { sfx.uiBack(); show('title'); });
  $('btn-options').addEventListener('click', () => { sfx.uiClick(); show('options'); });
  $('btn-options-back').addEventListener('click', () => { sfx.uiBack(); saveOpts(); show('title'); });

  $('vol-sfx').addEventListener('input', (e) => {
    app.opts.sfx = e.target.value / 100;
    $('lbl-sfx').textContent = e.target.value;
    sfx.setSfxVolume(app.opts.sfx);
  });
  $('vol-music').addEventListener('input', (e) => {
    app.opts.music = e.target.value / 100;
    $('lbl-music').textContent = e.target.value;
    sfx.setMusicVolume(app.opts.music);
  });
  $('opt-shake').addEventListener('change', (e) => {
    app.opts.shake = e.target.checked;
    app.effects.shakeEnabled = e.target.checked;
    saveOpts();
  });
  $('opt-scanlines').addEventListener('change', (e) => {
    app.opts.scanlines = e.target.checked;
    app.renderer.scanlines = e.target.checked;
    saveOpts();
  });

  $('btn-rematch').addEventListener('click', () => {
    sfx.uiClick();
    if (app.net && app.net.local) {
      startMatch(randomSeed(), app.selectedMap, 0, !app.solo);
      return;
    }
    app.rematchMe = true;
    $('btn-rematch').disabled = true;
    $('btn-rematch').textContent = 'WAITING...';
    $('result-status').textContent = 'Waiting for your opponent.';
    app.net.send({ t: 'rematch' });
    tryRematch();
  });

  $('btn-leave').addEventListener('click', () => {
    sfx.uiBack();
    if (app.net && !app.net.local) app.net.send({ t: 'bye' });
    leaveMatch();
  });

  $('btn-quit').addEventListener('click', () => { sfx.uiClick(); confirmQuit(); });

  $('code-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  });

  document.querySelectorAll('.btn').forEach((b) => {
    b.addEventListener('mouseenter', () => sfx.uiHover());
  });

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  const stage = $('stage');
  stage.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('blur', () => {
    if (app.game) app.game.keyRepeat = { up: 0, down: 0, left: 0, right: 0 };
  });
  window.addEventListener('beforeunload', () => {
    if (app.net && !app.net.local && app.net.connected) app.net.send({ t: 'bye' });
  });

  // First gesture anywhere unlocks the audio context.
  const unlock = () => { sfx.init(); sfx.resume(); sfx.playMusic('menu'); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

// --------------------------------------------------------------- boot

function boot() {
  loadOpts();
  app.renderer = new Renderer($('stage'));
  app.renderer.scanlines = app.opts.scanlines;
  app.renderer.resize();
  app.effects = new Effects(WORLD_W, WORLD_H);
  app.effects.shakeEnabled = app.opts.shake;

  buildAssets();
  buildMapGrid();
  buildAiGrid();
  selectAi(app.aiLevel);
  selectMap(MAPS[0].id, false);
  wireUi();
  applyOpts();

  window.addEventListener('resize', () => app.renderer.resize());

  $('boot').classList.add('hidden');
  show('title');
  lastStep = performance.now();
  requestAnimationFrame(frame);
  setInterval(watchdog, 100);

  // A shared link drops you straight into the join box with the code filled.
  const hash = location.hash.replace('#', '').toUpperCase();
  if (/^[A-Z0-9]{5}$/.test(hash)) {
    $('code-input').value = hash;
    show('join');
    $('join-error').textContent = 'Room code loaded from the link. Press CONNECT.';
  }

  // Expose a handle for the automated playtest harness.
  window.__mortars = app;
  app.startLocal = (mapId, seed, aiId) => {
    app.isHost = true;
    app.solo = !!aiId;
    if (aiId) app.aiLevel = aiId;
    app.net = new LocalNet();
    app.selectedMap = mapId || app.selectedMap;
    startMatch(seed || randomSeed(), app.selectedMap, 0, !app.solo);
  };

  // ?local=<mapId>[&seed=N] drops straight into a hot-seat match. Used by the
  // playtest harness and handy for checking a single map in isolation.
  const q = new URLSearchParams(location.search);
  if (q.has('local')) {
    const id = q.get('local') || MAPS[0].id;
    const seed = q.has('seed') ? (Number(q.get('seed')) >>> 0) : randomSeed();
    sfx.init();
    app.startLocal(mapById(id).id, seed, q.get('ai'));
    return;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
