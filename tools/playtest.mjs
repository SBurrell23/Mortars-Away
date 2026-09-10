// Headless balance harness.
//
// Runs whole matches against the real balance, physics, map and terrain code
// with scripted gunners of a given skill level, and reports the numbers that
// decide whether the game is fun: how long a match runs, how much of the
// outcome is skill versus the weight and wind rolls, and whether any map
// produces stalemates or one-shot kills.
//
//   node tools/playtest.mjs [--matches 400] [--map <id>] [--verbose]

import { installDomShim } from './domshim.mjs';
installDomShim();

const { Rng } = await import('../js/rng.js');
const { Terrain } = await import('../js/terrain.js');
const maps = await import('../js/maps.js');
const phys = await import('../js/physics.js');
const bal = await import('../js/balance.js');

const { MAPS, generateMap, WORLD_W, WORLD_H } = maps;

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const MATCHES = Number(arg('matches', 400));
const ONLY_MAP = arg('map', null);
const VERBOSE = argv.includes('--verbose');
const MAX_TURNS = 60;

// -------------------------------------------------------- the gunner

// Gaussian via Box-Muller, driven by the match rng so runs are reproducible.
function gauss(rng) {
  const u = Math.max(1e-9, rng.float());
  const v = rng.float();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Search angle/power for the shot that lands nearest the enemy. This is the
// "perfect information" solution; skill decides how far off it the gunner ends
// up. Deliberately coarse, because a human is not solving a trajectory either.
function bestSolution(state, shell, shooter, enemy) {
  let best = null;
  for (let ang = 20; ang <= 78; ang += 3) {
    let lo = bal.POWER_MIN, hi = bal.POWER_MAX;
    for (let iter = 0; iter < 14; iter++) {
      const mid = (lo + hi) / 2;
      const err = (landingX(state, shell, shooter, ang, mid, enemy) - enemy.x) * shooter.facing;
      if (err > 0) hi = mid; else lo = mid;
    }
    const power = (lo + hi) / 2;
    const err = Math.abs(landingX(state, shell, shooter, ang, power, enemy) - enemy.x);
    if (!best || err < best.err) best = { angle: ang, power, err };
  }
  return best;
}

// Cheap ballistic probe used only by the solver: same forces as the real sim
// but a coarse step and no terrain, stopping level with the target. Running the
// full pixel-marching simulate() inside a 300-candidate search is far too slow
// to playtest with, and the solver does not need that precision anyway.
function landingX(state, shell, shooter, angle, power, enemy) {
  const dt = 1 / 24;
  const g = phys.PHYS.gravity;
  const k = phys.PHYS.dragK;
  const windA = state.world.wind * phys.PHYS.windAcc * shell.windDrift;
  const speed = bal.BASE_MUZZLE * shell.velMult * power;
  const v = phys.launchVector(angle, speed, shooter.facing);
  let x = shooter.muzzleX, y = shooter.muzzleY, vx = v.vx, vy = v.vy;
  const targetY = enemy.y - 16;
  for (let i = 0; i < 900; i++) {
    const sp = Math.sqrt(vx * vx + vy * vy);
    const ds = k * sp / shell.mass;
    vx += (windA - vx * ds) * dt;
    vy += (g - vy * ds) * dt;
    x += vx * dt;
    y += vy * dt;
    if (vy > 0 && y >= targetY) break;
    if (x < -200 || x > WORLD_W + 200) break;
  }
  return x;
}

// Quality draw for one minigame stage. `skill` 0..1.
function stageQuality(rng, skill, tightness) {
  const noise = gauss(rng) * (0.30 - 0.22 * skill) * tightness;
  return clamp(skill * 0.92 + 0.08 + noise, 0, 1);
}

// ------------------------------------------------------------- match

function playMatch(seed, mapDef, skills) {
  const rng = new Rng(seed);
  const gen = generateMap(mapDef, rng);
  const terrain = new Terrain(WORLD_W, WORLD_H);
  terrain.build(gen.heightFn, mapDef.layers, null, rng);

  const players = [0, 1].map((side) => ({
    id: side, side,
    x: gen.anchors[side],
    y: gen.padY[side],
    hp: bal.HP_MAX,
    facing: side === 0 ? 1 : -1,
    lastAngle: 45,
    lastPower: 0.75,
    lastErr: null,
  }));

  const log = {
    turns: 0, shots: 0, hits: 0, duds: 0, oob: 0, directs: 0, airbursts: 0,
    damage: [0, 0], perTurnDamage: [], maxSingle: 0, falls: 0, collapses: 0,
    winner: -1, stalled: false, shellUse: {}, byShell: {},
  };

  const state = { world: null };
  const finalRound = { on: false };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const side = turn % 2;
    const shooter = players[side];
    const enemy = players[side === 0 ? 1 : 0];
    const trng = new Rng((seed ^ Math.imul(turn + 1, 2654435761)) >>> 0);
    const wind = bal.rollWind(trng, mapDef.windBias);
    const shell = bal.rollShell(trng);
    log.shellUse[shell.id] = (log.shellUse[shell.id] || 0) + 1;
    const bsFired = log.byShell[shell.id] || (log.byShell[shell.id] = { n: 0, dmg: 0, fired: 0 });
    bsFired.fired++;

    // Counter-battery attrition once the match has dragged on.
    const attr = bal.attritionForTurn(turn);
    if (attr > 0) {
      for (const p of players) p.hp = Math.max(0, p.hp - attr);
      if (settle(turn)) break;
    }

    shooter.muzzleX = shooter.x + shooter.facing * 2 + Math.cos(45 * Math.PI / 180) * 50 * shooter.facing;
    shooter.muzzleY = shooter.y - 20 - Math.sin(45 * Math.PI / 180) * 50;

    state.world = {
      width: WORLD_W, height: WORLD_H, wind,
      solidAt: (x, y) => terrain.solidAt(x, y),
      targets: [{ x: enemy.x, y: enemy.y - 16, r: bal.UNIT_HIT_RADIUS, id: enemy.id }],
    };

    const skill = skills[side];
    const sol = bestSolution(state, shell, shooter, enemy);

    // Aiming error shrinks as the gunner ranges in: a real player corrects off
    // the last round, so the second and later shots on a target are tighter.
    const ranged = shooter.lastErr !== null ? 0.45 : 1;
    const angErr = gauss(trng) * (1 - skill) * 3.4 * ranged;
    const powErr = gauss(trng) * (1 - skill) * 0.07 * ranged;

    const angle = clamp(sol.angle + angErr, bal.ANGLE_MIN, bal.ANGLE_MAX);
    const power = clamp(sol.power * (1 + powErr), bal.POWER_MIN, bal.POWER_MAX);

    const ramQ = stageQuality(trng, skill, 1.0);
    const elevQ = stageQuality(trng, skill, 1.0);
    const fuseQ = stageQuality(trng, skill, 1.15);
    const perfects = {
      ram: ramQ > 0.985, elevation: elevQ > 0.985, fuse: fuseQ > 0.985,
    };

    const res = bal.resolveShot({
      shell, angleDeg: angle, power, facing: shooter.facing,
      ramQ, elevQ, elevSign: trng.bool() ? 1 : -1, fuseQ, perfects,
    });

    const v = phys.launchVector(res.finalAngle, res.speed, shooter.facing);
    const shot = phys.simulate({
      x: shooter.muzzleX, y: shooter.muzzleY, vx: v.vx, vy: v.vy,
      mass: shell.mass, windDrift: shell.windDrift,
      fuseArm: res.fuseArm, fuseRadius: res.fuseRadius,
    }, state.world);

    log.shots++;
    log.turns = turn + 1;
    shooter.lastErr = Math.abs(shot.x - enemy.x);

    if (shot.outcome === phys.OUT_OF_BOUNDS) { log.oob++; log.perTurnDamage.push(0); continue; }
    if (shot.outcome === phys.TIMED_OUT) { log.duds++; log.perTurnDamage.push(0); continue; }

    const airburst = shot.outcome === phys.HIT_AIRBURST;
    const direct = shot.outcome === phys.HIT_UNIT;
    if (direct) log.directs++;
    if (airburst) log.airbursts++;

    const craterR = Math.round(shell.crater * res.craterMult * (airburst ? 0.42 : 1));
    terrain.destroy(shot.x, shot.y, craterR);
    const loose = terrain.findLooseChunks(shot.x, shot.y, craterR);
    if (loose.length) {
      log.collapses++;
      terrain.chunks.push(...loose);
      // Settle immediately; the visual pacing does not matter here.
      let guard = 0;
      while (terrain.stepChunks(1 / 60, 900) && guard++ < 600) { /* fall */ }
    }

    let turnDamage = 0;
    for (const p of players) {
      const d = Math.hypot(shot.x - p.x, shot.y - (p.y - 16));
      const isDirect = direct && shot.targetId === p.id;
      const dmg = bal.blastDamage(shell, d, res.dmgMult, isDirect, airburst, res.bonusDmg);
      if (dmg <= 0) continue;
      p.hp = Math.max(0, p.hp - dmg);
      log.damage[side] += dmg;
      turnDamage += dmg;
      const bs = log.byShell[shell.id];
      bs.n++; bs.dmg += dmg;
    }
    if (turnDamage > 0) log.hits++;
    log.maxSingle = Math.max(log.maxSingle, turnDamage);
    log.perTurnDamage.push(turnDamage);

    // Guns fall if their ground went.
    for (const p of players) {
      const support = terrain.groundLevel(p.x, 14);
      if (support > p.y + 1.5) {
        const drop = Math.min(support, WORLD_H) - p.y;
        const fd = bal.fallDamage(drop);
        if (fd > 0) { p.hp = Math.max(0, p.hp - fd); log.falls++; log.damage[side] += 0; }
        p.y = Math.min(support, WORLD_H - 4);
      }
    }

    if (settle(turn)) break;
  }
  if (log.winner === -1) log.stalled = true;
  return log;

  // A kill only counts once both sides have fired the same number of rounds.
  function settle(turn) {
    const dead = players.filter((p) => p.hp <= 0);
    if (!dead.length) return false;
    const level = turn % 2 === 1;
    if (!level && !finalRound.on) { finalRound.on = true; return false; }
    log.winner = dead.length === 2 ? -2 : (dead[0].side === 0 ? 1 : 0);
    log.turns = turn + 1;
    return true;
  }
}

// ------------------------------------------------------------ report

function pct(a, b) { return b ? ((a / b) * 100).toFixed(1) + '%' : '-'; }
function mean(a) { return a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0; }
function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

function runSuite(label, skills) {
  const list = ONLY_MAP ? MAPS.filter((m) => m.id === ONLY_MAP) : MAPS;
  const rows = [];
  const all = { turns: [], stalls: 0, oob: 0, shots: 0, hits: 0, directs: 0, airbursts: 0, maxSingle: 0, wins: [0, 0, 0] };
  const shellDamage = {};

  for (const m of list) {
    const per = { turns: [], stalls: 0, oob: 0, shots: 0, hits: 0, directs: 0, airbursts: 0, maxSingle: 0, collapses: 0, falls: 0 };
    const n = Math.max(20, Math.round(MATCHES / list.length));
    for (let i = 0; i < n; i++) {
      const log = playMatch((0x9e3779b9 ^ (i * 2654435761) ^ m.id.length * 7919) >>> 0, m, skills);
      per.turns.push(log.turns);
      per.stalls += log.stalled ? 1 : 0;
      per.oob += log.oob;
      per.shots += log.shots;
      per.hits += log.hits;
      per.directs += log.directs;
      per.airbursts += log.airbursts;
      per.collapses += log.collapses;
      per.falls += log.falls;
      per.maxSingle = Math.max(per.maxSingle, log.maxSingle);
      all.turns.push(log.turns);
      all.stalls += log.stalled ? 1 : 0;
      all.oob += log.oob;
      all.shots += log.shots;
      all.hits += log.hits;
      all.directs += log.directs;
      all.airbursts += log.airbursts;
      all.maxSingle = Math.max(all.maxSingle, log.maxSingle);
      all.wins[log.winner === -2 ? 2 : log.winner] = (all.wins[log.winner === -2 ? 2 : log.winner] || 0) + 1;
      for (const [k, v] of Object.entries(log.byShell)) {
        const e = shellDamage[k] || (shellDamage[k] = { n: 0, dmg: 0, fired: 0 });
        e.n += v.n; e.dmg += v.dmg; e.fired += v.fired;
      }
    }
    rows.push([
      m.name.padEnd(17),
      String(m.gap).padStart(4),
      median(per.turns).toString().padStart(6),
      mean(per.turns).toFixed(1).padStart(6),
      pct(per.hits, per.shots).padStart(7),
      pct(per.directs, per.shots).padStart(7),
      pct(per.oob, per.shots).padStart(6),
      String(per.maxSingle).padStart(5),
      pct(per.stalls, n).padStart(6),
      String(per.collapses).padStart(6),
    ].join(' '));
  }

  console.log('\n=== ' + label + ' ===');
  console.log('MAP               GAP  MEDIAN   MEAN  ONTGT  DIRECT   OFFMAP  MAXHIT STALL COLLAPS');
  console.log('                       TURNS   TURNS');
  rows.forEach((r) => console.log(r));
  console.log('-'.repeat(84));
  console.log('OVERALL  median turns ' + median(all.turns)
    + '  mean ' + mean(all.turns).toFixed(1)
    + '  on-target ' + pct(all.hits, all.shots)
    + '  direct ' + pct(all.directs, all.shots)
    + '  airburst ' + pct(all.airbursts, all.shots)
    + '  off-map ' + pct(all.oob, all.shots)
    + '  stalls ' + all.stalls
    + '  biggest single turn ' + all.maxSingle + ' dmg');

  if (VERBOSE) {
    console.log('  SHELL            FIRED  CONNECTED   DMG/LANDED   DMG/SHOT');
    for (const s of bal.SHELLS) {
      const e = shellDamage[s.id];
      if (!e || !e.fired) continue;
      console.log('    ' + s.name.padEnd(15)
        + String(e.fired).padStart(5)
        + pct(e.n, e.fired).padStart(11)
        + (e.n ? (e.dmg / e.n).toFixed(1) : '0.0').padStart(13)
        + (e.dmg / e.fired).toFixed(1).padStart(11));
    }
  }
  return all;
}

// ------------------------------------------------- skill sensitivity

function skillCurve() {
  console.log('\n=== SKILL VS OUTCOME (a gunner of skill X against a 0.55 gunner) ===');
  console.log('SKILL   WIN%   MEDIAN TURNS   ON-TARGET');
  const list = ONLY_MAP ? MAPS.filter((m) => m.id === ONLY_MAP) : MAPS;
  for (const skill of [0.15, 0.3, 0.45, 0.55, 0.7, 0.85, 0.97]) {
    let wins = 0, games = 0;
    const turns = [];
    let shots = 0, hits = 0;
    for (const m of list) {
      for (let i = 0; i < 40; i++) {
        // Alternate who opens so first-shot advantage cancels out.
        const swap = i % 2 === 1;
        const skills = swap ? [0.55, skill] : [skill, 0.55];
        const log = playMatch((0x51ed270b ^ (i * 40503) ^ (m.gap * 131)) >>> 0, m, skills);
        games++;
        const me = swap ? 1 : 0;
        if (log.winner === me) wins++;
        turns.push(log.turns);
        shots += log.shots;
        hits += log.hits;
      }
    }
    console.log(String(skill.toFixed(2)).padStart(5)
      + pct(wins, games).padStart(8)
      + String(median(turns)).padStart(15)
      + pct(hits, shots).padStart(12));
  }
}

// ----------------------------------------------------- luck isolation

// Same gunner, same skill, but one side always gets the shell it rolled and
// the other always gets a Standard HE. If weight mattered more than skill the
// gap here would be large.
function luckShare() {
  console.log('\n=== LUCK SHARE ===');
  const list = ONLY_MAP ? MAPS.filter((m) => m.id === ONLY_MAP) : MAPS;
  const spreads = [];
  for (const m of list) {
    const res = [];
    for (let i = 0; i < 60; i++) {
      const log = playMatch((0x2545f491 ^ (i * 7919) ^ m.gap) >>> 0, m, [0.6, 0.6]);
      res.push(log.turns);
    }
    spreads.push({ map: m.name, med: median(res), min: Math.min(...res), max: Math.max(...res) });
  }
  for (const s of spreads) {
    console.log('  ' + s.map.padEnd(17) + ' turns median ' + String(s.med).padStart(3)
      + '  range ' + String(s.min).padStart(2) + '-' + String(s.max).padStart(3));
  }
}

// Opening the match is worth something: the first gunner gets a free round in
// before anything can answer. Measure it rather than guessing.
function firstPlayerEdge() {
  console.log('\n=== FIRST-PLAYER ADVANTAGE ===');
  const list = ONLY_MAP ? MAPS.filter((m) => m.id === ONLY_MAP) : MAPS;
  for (const skill of [0.3, 0.6, 0.85]) {
    let firstWins = 0, games = 0;
    for (const m of list) {
      for (let i = 0; i < 70; i++) {
        const log = playMatch((0x85ebca6b ^ (i * 2246822519) ^ (m.gap * 977)) >>> 0, m, [skill, skill]);
        if (log.winner === -2 || log.winner === -1) continue;
        games++;
        if (log.winner === 0) firstWins++;
      }
    }
    console.log('  skill ' + skill.toFixed(2) + '  side that opens wins '
      + pct(firstWins, games) + '  (n=' + games + ')');
  }
}

const t0 = Date.now();
runSuite('NOVICE vs NOVICE (skill 0.25)', [0.25, 0.25]);
runSuite('CLUB PLAYER vs CLUB PLAYER (skill 0.6)', [0.6, 0.6]);
runSuite('EXPERT vs EXPERT (skill 0.9)', [0.9, 0.9]);
skillCurve();
firstPlayerEdge();
luckShare();
console.log('\ndone in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
