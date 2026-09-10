// A runtime build stamp for the gameplay-critical code.
//
// NOTE ON THE FILENAME: this module used to be called fingerprint.js, which
// ad blockers and privacy extensions block outright -- EasyPrivacy matches
// "fingerprint.js" because of browser-fingerprinting libraries. Because this is
// an ES module import, a blocked request takes down the entire module graph and
// the game never boots at all. Do not rename it back, and think twice before
// adding any file whose name reads like tracking.
//
// The game ships as plain ES modules with no build step, and GitHub Pages
// serves them with a short cache lifetime. That means a returning player can
// easily end up running a fresh index.html against a stale physics.js. For a
// lockstep peer-to-peer game that is quietly fatal: both sides believe they
// agree, the trajectories differ in the third decimal place, and the match
// dissolves into resync churn with no explanation.
//
// A hand-maintained version constant does not catch this, because the constant
// itself lives in a module that may be the stale one. So instead the stamp is
// hashed from the *actual loaded source* of the functions and tables that
// decide a shot. Any difference in the code doing the simulating changes the
// stamp, whichever module went stale.

import { PHYS, simulate, launchVector } from './physics.js';
import { SHELLS, resolveShot, blastDamage, HP_MAX, BASE_MUZZLE } from './balance.js';
import { MAPS } from './maps.js';

function fnv1a(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

let cached = null;

export function buildId() {
  if (cached) return cached;
  const parts = [
    // Source text of everything that turns inputs into an outcome.
    String(simulate),
    String(launchVector),
    String(resolveShot),
    String(blastDamage),
    // The tables those functions read.
    JSON.stringify(PHYS),
    JSON.stringify(SHELLS),
    String(HP_MAX),
    String(BASE_MUZZLE),
    // Map geometry, since both peers must generate identical terrain.
    JSON.stringify(MAPS.map((m) => [m.id, m.gen, m.gap, m.windBias, m.layers, m.water || 0])),
  ];
  cached = fnv1a(parts.join('|~|')).toString(36);
  return cached;
}
