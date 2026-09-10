// Pre-deploy checks. Runs in CI before the site is published.
//
//   node tools/verify.mjs
//
// Fails the build on: a syntax error in any shipped module, a malformed sprite,
// a map that cannot seat both guns on solid ground, or balance drifting far
// enough that matches stall or end in one round.

import { installDomShim } from './domshim.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

installDomShim();

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const jsDir = join(root, 'js');

let failures = 0;
let checks = 0;

function check(name, fn) {
  checks++;
  try {
    const detail = fn();
    console.log('  ok    ' + name + (detail ? '  (' + detail + ')' : ''));
  } catch (e) {
    failures++;
    console.log('  FAIL  ' + name + '\n        ' + (e && e.message ? e.message : e));
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\nMortars Away - pre-deploy verification\n');

// ------------------------------------------------------ 1. syntax

console.log('modules parse');
const files = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
assert(files.length > 0, 'no modules found');
for (const f of files) {
  check(f, () => {
    execFileSync(process.execPath, ['--check', join(jsDir, f)], { stdio: 'pipe' });
    return Math.round(readFileSync(join(jsDir, f)).length / 1024) + ' KB';
  });
}

// index.html must reference every module it needs and carry no stray markup.
check('index.html', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert(html.includes('js/main.js'), 'main.js not referenced');
  assert(html.includes('peerjs'), 'PeerJS not loaded');
  assert(html.includes('css/style.css'), 'stylesheet not referenced');
  assert(!/<script[^>]*src="[^"]*"[^>]*>[^<]/.test(html), 'script tag has both src and body');
  return Math.round(html.length / 1024) + ' KB';
});

// ------------------------------------------------------- 2. sprites

const { UNIT_PALETTES, UNIT_SPRITES } = await import('../js/art-units.js');
const { ENV_PALETTES, ENV_SPRITES } = await import('../js/art-env.js');

const SPRITES = { ...ENV_SPRITES, ...UNIT_SPRITES };
const PALETTES = { ...ENV_PALETTES, ...UNIT_PALETTES };

// Everything render.js and balance.js actually ask for by name.
const REQUIRED = [
  'mortarBase_allied', 'mortarBase_axis', 'mortarBarrel_allied', 'mortarBarrel_axis',
  'crew_allied_idle', 'crew_axis_idle', 'crew_allied_hit', 'crew_axis_hit',
  'shell_light', 'shell_medium', 'shell_heavy',
  'boom_0', 'boom_1', 'boom_2', 'boom_3', 'boom_4', 'boom_5',
  'cloud_a', 'cloud_b', 'cloud_c', 'bird_a', 'hill_far_a', 'hill_far_b', 'smoke_column',
  'tile_grass', 'tile_dirt', 'tile_clay', 'tile_rock',
  'tile_snow', 'tile_sand', 'tile_ash', 'tile_mud',
];

console.log('\nsprite data');
check('all referenced sprites exist', () => {
  const missing = REQUIRED.filter((n) => !SPRITES[n]);
  assert(missing.length === 0, 'missing: ' + missing.join(', '));
  return REQUIRED.length + ' required, ' + Object.keys(SPRITES).length + ' total';
});

check('sprite grids are well formed', () => {
  for (const [name, s] of Object.entries(SPRITES)) {
    assert(Array.isArray(s.pixels), name + ': pixels is not an array');
    assert(s.pixels.length === s.h, name + ': ' + s.pixels.length + ' rows, h=' + s.h);
    const pal = PALETTES[s.palette];
    assert(pal, name + ': unknown palette ' + s.palette);
    for (let y = 0; y < s.h; y++) {
      const row = s.pixels[y];
      assert(row.length === s.w, name + ' row ' + y + ': width ' + row.length + ', w=' + s.w);
      for (const c of row) {
        assert(c === '.' || c in pal, name + ' row ' + y + ': char ' + JSON.stringify(c) + ' not in palette');
      }
    }
  }
  return Object.keys(SPRITES).length + ' sprites';
});

check('palette colours are valid hex', () => {
  for (const [pn, pal] of Object.entries(PALETTES)) {
    for (const [k, v] of Object.entries(pal)) {
      assert(k !== '.', pn + ': "." must not be a palette key');
      assert(/^#[0-9a-f]{6}$/i.test(v), pn + '.' + k + ' = ' + v);
    }
  }
  return Object.keys(PALETTES).length + ' palettes';
});

check('terrain tiles are fully opaque', () => {
  const names = ['grass', 'dirt', 'clay', 'rock', 'snow', 'sand', 'ash', 'mud'];
  for (const n of names) {
    const s = SPRITES['tile_' + n];
    const holes = s.pixels.join('').split('.').length - 1;
    assert(holes === 0, 'tile_' + n + ' has ' + holes + ' transparent pixels');
  }
  return names.length + ' tiles';
});

// -------------------------------------------------------- 3. balance

const { Rng } = await import('../js/rng.js');
const { Terrain } = await import('../js/terrain.js');
const { MAPS, generateMap, WORLD_W, WORLD_H } = await import('../js/maps.js');
const bal = await import('../js/balance.js');
const phys = await import('../js/physics.js');

console.log('\nbalance invariants');

check('shell probabilities sum to 1', () => {
  const total = bal.SHELLS.reduce((s, x) => s + x.prob, 0);
  assert(Math.abs(total - 1) < 1e-9, 'sum = ' + total);
  return bal.SHELLS.length + ' classes';
});

check('lighter shells punch harder, heavier shells forgive more', () => {
  for (let i = 1; i < bal.SHELLS.length; i++) {
    const a = bal.SHELLS[i - 1], b = bal.SHELLS[i];
    assert(b.mass > a.mass, b.id + ' is not heavier than ' + a.id);
    assert(b.maxDmg < a.maxDmg, b.id + ' peak damage should be below ' + a.id);
    assert(b.falloff > a.falloff, b.id + ' lethal radius should exceed ' + a.id);
    assert(b.velMult < a.velMult, b.id + ' should be slower than ' + a.id);
    assert(b.windDrift < a.windDrift, b.id + ' should drift less than ' + a.id);
  }
  return 'monotonic across ' + bal.SHELLS.length + ' classes';
});

check('two landed rounds cannot kill a full-health gun', () => {
  const worst = Math.max(...bal.SHELLS.map((s) =>
    bal.blastDamage(s, 0, bal.FUSE_PERFECT_DMG, true, true, bal.TEXTBOOK_BONUS_DMG)));
  assert(worst * 2 < bal.HP_MAX,
    'worst single round ' + worst + ' x2 >= ' + bal.HP_MAX + ' HP');
  return 'worst round ' + worst + ' vs ' + bal.HP_MAX + ' HP';
});

check('attrition guarantees the match ends', () => {
  let hp = bal.HP_MAX, turn = 0;
  while (hp > 0 && turn < 500) { hp -= bal.attritionForTurn(turn); turn++; }
  assert(turn < 200, 'attrition alone needs ' + turn + ' turns');
  return 'hard stop by turn ' + turn;
});

// ----------------------------------------------------------- 4. maps

console.log('\nmaps');
check('there are exactly ten', () => {
  assert(MAPS.length === 10, MAPS.length + ' maps');
  const ids = new Set(MAPS.map((m) => m.id));
  assert(ids.size === 10, 'duplicate map ids');
  return MAPS.map((m) => m.id).join(', ');
});

for (const m of MAPS) {
  check(m.id, () => {
    assert(m.layers.length === 4, 'expected 4 material layers');
    for (const l of m.layers) {
      assert(SPRITES['tile_' + l], 'no tile art for material ' + l);
    }
    assert(m.sky.length === 3, 'sky needs 3 stops');
    assert(m.difficulty >= 1 && m.difficulty <= 5, 'difficulty out of range');

    // Both guns must end up on solid, level ground for several seeds.
    for (const seed of [1, 12345, 0xbeef, 987654321]) {
      const rng = new Rng(seed);
      const gen = generateMap(m, rng);
      const terrain = new Terrain(WORLD_W, WORLD_H);
      terrain.build(gen.heightFn, m.layers, null, rng);
      for (let side = 0; side < 2; side++) {
        const ax = gen.anchors[side];
        assert(ax > 10 && ax < WORLD_W - 10, 'anchor ' + ax + ' off the field (seed ' + seed + ')');
        const top = terrain.columnTop(ax);
        assert(top < WORLD_H - 2,
          'gun ' + side + ' has no ground under it (seed ' + seed + ')');
        assert(Math.abs(top - gen.padY[side]) <= 2,
          'gun ' + side + ' pad is not level (seed ' + seed + ')');
      }
      // Mirrored generation means the two halves must match.
      assert(Math.abs(gen.padY[0] - gen.padY[1]) <= 1,
        'the two firing pads are at different heights (seed ' + seed + ')');
    }
    return 'gap ' + m.gap + ', wind x' + m.windBias;
  });
}

// ------------------------------------------------------- 5. physics

console.log('\nphysics');
check('simulation is deterministic', () => {
  const world = {
    width: WORLD_W, height: WORLD_H, wind: 0.63,
    solidAt: (x, y) => y >= 600,
    targets: [{ x: 900, y: 580, r: 15, id: 1 }],
  };
  const shot = {
    x: 200, y: 560, vx: 372.19387, vy: -401.7734,
    mass: 1, windDrift: 1.15, fuseArm: 0.6, fuseRadius: 30,
  };
  const a = phys.simulate({ ...shot }, world);
  const b = phys.simulate({ ...shot }, world);
  assert(a.x === b.x && a.y === b.y && a.steps === b.steps && a.outcome === b.outcome,
    'two identical runs diverged');
  return a.outcome + ' at ' + a.x.toFixed(6) + ' after ' + a.steps + ' steps';
});

check('a standard round crosses a typical field', () => {
  const world = { width: WORLD_W, height: WORLD_H, wind: 0, solidAt: (x, y) => y >= 600, targets: [] };
  const std = bal.shellById('standard');
  const v = phys.launchVector(45, bal.BASE_MUZZLE * std.velMult, 1);
  const r = phys.simulate({
    x: 140, y: 580, vx: v.vx, vy: v.vy,
    mass: std.mass, windDrift: std.windDrift, fuseArm: 0, fuseRadius: 0,
  }, world);
  const range = r.x - 140;
  assert(range > 850, 'full-power range only ' + range.toFixed(0) + 'px');
  const widest = Math.max(...MAPS.map((m) => m.gap));
  assert(range > widest * 0.9,
    'range ' + range.toFixed(0) + 'px cannot cover the widest gap ' + widest + 'px');
  return range.toFixed(0) + 'px in ' + r.flightTime.toFixed(2) + 's, widest gap ' + widest + 'px';
});

check('the proximity fuse never makes an accurate round worse', () => {
  // A round aimed to land right on the gun must not be pulled off by its fuse.
  const world = {
    width: WORLD_W, height: WORLD_H, wind: 0,
    solidAt: (x, y) => y >= 590,
    targets: [{ x: 900, y: 574, r: 15, id: 1 }],
  };
  const std = bal.shellById('standard');
  let worse = 0, n = 0;
  for (let ang = 30; ang <= 70; ang += 2) {
    for (let p = 0.5; p <= 1.0; p += 0.05) {
      const v = phys.launchVector(ang, bal.BASE_MUZZLE * std.velMult * p, 1);
      const base = { x: 140, y: 570, vx: v.vx, vy: v.vy, mass: std.mass, windDrift: std.windDrift };
      const noFuse = phys.simulate({ ...base, fuseArm: 0, fuseRadius: 0 }, world);
      const fused = phys.simulate({ ...base, fuseArm: bal.FUSE_ARM_SECONDS, fuseRadius: bal.FUSE_MAX_RADIUS }, world);
      const dNo = Math.hypot(noFuse.x - 900, noFuse.y - 574);
      const dYes = Math.hypot(fused.x - 900, fused.y - 574);
      n++;
      if (dYes > dNo + 0.5) worse++;
    }
  }
  assert(worse === 0, worse + ' of ' + n + ' fused rounds burst further out than they would have landed');
  return n + ' trajectories, none degraded';
});

// ---------------------------------------------------------- summary

console.log('\n' + (failures ? 'FAILED' : 'PASSED') + ': '
  + (checks - failures) + '/' + checks + ' checks\n');
process.exit(failures ? 1 : 0);
