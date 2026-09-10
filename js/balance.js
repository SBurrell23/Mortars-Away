// Every tunable number in the game lives here.
//
// The design pivot: shell weight is rolled for you, and it trades reach and
// punch for forgiveness. Light shells fly furthest and hit hardest at the dead
// centre of the blast, but their lethal radius is tiny and the wind throws them
// around, so they only pay off for a gunner who can actually place a round.
// Heavy shells barely cross a wide field and their core is softer, but the
// blast covers so much ground that close enough is good enough.
//
// Crucially maxDmg goes DOWN with mass while falloff goes UP. If both rose
// together the heavy rounds would simply be better and the whole tension would
// collapse -- which is exactly what the balance harness caught on the first pass.

// 130 rather than a round 100 so that a pair of direct hits is a commanding
// lead but not a win: three good rounds, or five workmanlike ones, take a gun.
export const HP_MAX = 130;
export const BASE_MUZZLE = 520;        // px/s at power 1.0 with a mass-1.0 shell
export const POWER_MIN = 0.35;         // floor of the player's power slider
export const POWER_MAX = 1.0;
export const ANGLE_MIN = 12;
export const ANGLE_MAX = 84;
export const MAX_WIND = 1.0;           // before the map's windBias multiplier
export const TURN_SECONDS = 45;

// Two gunners who cannot find each other must not be able to sit there all
// night. From this turn on, both positions start taking counter-battery fire,
// escalating until something gives.
export const ATTRITION_FROM_TURN = 24;
export const ATTRITION_BASE = 3;
export const ATTRITION_STEP_EVERY = 4;

export function attritionForTurn(turn) {
  if (turn < ATTRITION_FROM_TURN) return 0;
  const steps = Math.floor((turn - ATTRITION_FROM_TURN) / ATTRITION_STEP_EVERY);
  return ATTRITION_BASE + steps;
}
export const UNIT_HIT_RADIUS = 15;     // shell vs emplacement direct-hit circle

export const SHELLS = [
  {
    id: 'feather', name: 'Feather Charge', short: 'FEATHER',
    mass: 0.50, prob: 0.09, velMult: 1.26, windDrift: 2.20,
    crater: 26, maxDmg: 64, falloff: 48, sprite: 'shell_light',
    note: 'Reaches anywhere and hits like a hammer -- inside six feet.',
  },
  {
    id: 'light', name: 'Light Bomb', short: 'LIGHT',
    mass: 0.70, prob: 0.18, velMult: 1.14, windDrift: 1.65,
    crater: 32, maxDmg: 56, falloff: 66, sprite: 'shell_light',
    note: 'Long legs, savage core, no margin. The wind will move it.',
  },
  {
    id: 'standard', name: 'Standard HE', short: 'STANDARD',
    mass: 1.00, prob: 0.32, velMult: 1.00, windDrift: 1.15,
    crater: 42, maxDmg: 46, falloff: 92, sprite: 'shell_medium',
    note: 'The workhorse round. No excuses either way.',
  },
  {
    id: 'heavy', name: 'Heavy HE', short: 'HEAVY',
    mass: 1.45, prob: 0.22, velMult: 0.92, windDrift: 0.78,
    crater: 52, maxDmg: 40, falloff: 118, sprite: 'shell_medium',
    note: 'Shorter reach and a softer core, but it forgives a near miss.',
  },
  {
    id: 'siege', name: 'Siege Shell', short: 'SIEGE',
    mass: 2.10, prob: 0.14, velMult: 0.84, windDrift: 0.50,
    crater: 62, maxDmg: 36, falloff: 148, sprite: 'shell_heavy',
    note: 'Ignores the wind, buries a wide area, struggles to cross a field.',
  },
  {
    id: 'buster', name: 'Bunker Buster', short: 'BUSTER',
    mass: 2.80, prob: 0.05, velMult: 0.82, windDrift: 0.36,
    crater: 78, maxDmg: 32, falloff: 186, sprite: 'shell_heavy',
    note: 'Reshapes the hill. Soft core, but almost anywhere near is near enough.',
  },
];

export function shellById(id) {
  return SHELLS.find((s) => s.id === id) || SHELLS[2];
}

export function rollShell(rng) {
  const r = rng.float();
  let acc = 0;
  for (const s of SHELLS) {
    acc += s.prob;
    if (r < acc) return s;
  }
  return SHELLS[SHELLS.length - 1];
}

// Triangular distribution: light airs are common, a gale is rare.
export function rollWind(rng, bias) {
  return rng.signedSoft() * MAX_WIND * (bias || 1);
}

// Flavour readout. The underlying value is -1..1 (times map bias).
export function windLabel(wind) {
  const mag = Math.abs(wind);
  const kph = Math.round(mag * 34);
  let word = 'CALM';
  if (mag > 0.08) word = 'LIGHT';
  if (mag > 0.28) word = 'FRESH';
  if (mag > 0.52) word = 'STRONG';
  if (mag > 0.78) word = 'GALE';
  const dir = mag < 0.03 ? '' : wind > 0 ? 'E' : 'W';
  return { word, kph, dir, mag };
}

// --------------------------------------------------------- minigames

export const MINIGAMES = {
  // Mash to seat the charge. More strokes, more propellant behind the shell.
  ram: {
    id: 'ram',
    title: 'RAM THE CHARGE',
    hint: 'Hammer SPACE or click',
    durationMs: 2600,
    targetPresses: 22,
    perfectPresses: 22,
    quality(presses) {
      return Math.max(0, Math.min(1, presses / this.targetPresses));
    },
    isPerfect(presses) { return presses >= this.perfectPresses; },
  },

  // Stop the traverse marker on the centre mark.
  elevation: {
    id: 'elevation',
    title: 'LAY THE TUBE',
    hint: 'SPACE or click to lock',
    barWidth: 460,
    speed: 540,          // px/s, bounces at the ends
    goodZone: 34,        // half-width of the green band, px
    perfectZone: 8,      // half-width of the perfect core, px
    falloff: 150,        // px of error at which quality reaches zero
    quality(errPx) {
      return Math.max(0, Math.min(1, 1 - errPx / this.falloff));
    },
    isPerfect(errPx) { return errPx <= this.perfectZone; },
  },

  // Match the pulsing ring to the fixed sight ring to set the fuse.
  fuse: {
    id: 'fuse',
    title: 'SET THE FUSE',
    hint: 'SPACE or click when the rings match',
    minR: 12,
    maxR: 96,
    targetR: 58,
    cycleMs: 1250,       // one full expand-and-contract
    goodZone: 12,
    perfectZone: 3,
    falloff: 34,
    quality(errPx) {
      return Math.max(0, Math.min(1, 1 - errPx / this.falloff));
    },
    isPerfect(errPx) { return errPx <= this.perfectZone; },
  },
};

// Ram quality -> multiplier on the chosen power. A fumbled load costs about a
// fifth of your range, which you can partly claw back by raising the tube.
export const RAM_POWER_MIN = 0.88;
export const RAM_POWER_MAX = 1.02;

// Elevation quality -> absolute angle error in degrees. Note this error is
// nearly harmless at 45 degrees (where range is stationary in angle) and bites
// hardest at flat or very steep angles. That is deliberate: 45 is the safe
// angle, and it is also the slowest, so it hands the most drift to the wind.
export const ELEV_MAX_ERROR_DEG = 8.0;

// Fuse quality -> proximity fuse radius in px, plus a small damage trim. The
// fuse fires at closest approach (see physics.js), so a tight fuse rescues a
// near miss without ever spoiling a round that was already on the money.
export const FUSE_MAX_RADIUS = 34;
export const FUSE_ARM_SECONDS = 0.6;
export const FUSE_DMG_MIN = 0.90;
export const FUSE_DMG_MAX = 1.04;
export const FUSE_PERFECT_DMG = 1.10;
export const AIRBURST_DMG_MULT = 1.15;

// All three stages perfect.
export const TEXTBOOK_CRATER_MULT = 1.12;
export const TEXTBOOK_BONUS_DMG = 10;

/**
 * Fold the aim and the three minigame results into the concrete shot.
 * Runs only on the shooting peer; the resulting numbers are what go on the wire.
 */
export function resolveShot(opts) {
  const { shell, angleDeg, power, facing, ramQ, elevQ, elevSign, fuseQ, perfects } = opts;

  const powerMult = RAM_POWER_MIN + (RAM_POWER_MAX - RAM_POWER_MIN) * ramQ;
  const speed = BASE_MUZZLE * shell.velMult * power * powerMult;

  const angleErr = (1 - elevQ) * ELEV_MAX_ERROR_DEG * elevSign;
  const finalAngle = Math.max(2, Math.min(88, angleDeg + angleErr));

  const fuseRadius = FUSE_MAX_RADIUS * fuseQ;
  let dmgMult = FUSE_DMG_MIN + (FUSE_DMG_MAX - FUSE_DMG_MIN) * fuseQ;
  if (perfects.fuse) dmgMult = FUSE_PERFECT_DMG;

  const allPerfect = perfects.ram && perfects.elevation && perfects.fuse;
  const craterMult = allPerfect ? TEXTBOOK_CRATER_MULT : 1;
  const bonusDmg = allPerfect ? TEXTBOOK_BONUS_DMG : 0;

  return {
    speed,
    finalAngle,
    angleErr,
    fuseRadius,
    fuseArm: FUSE_ARM_SECONDS,
    dmgMult,
    craterMult,
    bonusDmg,
    allPerfect,
  };
}

// --------------------------------------------------------- damage

export const DIRECT_HIT_BONUS = 14;
export const DAMAGE_CURVE = 1.15;

// Hard ceiling on what one shell can take off one gun. 2 x 64 = 128 < 130 HP,
// so a full-health gun can never be finished by two rounds however lucky the
// weight roll was. Three landed rounds is the mathematical minimum kill.
export const DAMAGE_CAP_PER_SHELL = 64;

export function blastDamage(shell, distance, dmgMult, direct, airburst, bonusDmg) {
  const f = Math.max(0, 1 - distance / shell.falloff);
  if (f <= 0 && !direct) return 0;
  let d = shell.maxDmg * Math.pow(f, DAMAGE_CURVE);
  if (direct) d += DIRECT_HIT_BONUS;
  d *= dmgMult || 1;
  if (airburst) d *= AIRBURST_DMG_MULT;
  d += bonusDmg || 0;
  return Math.max(0, Math.min(DAMAGE_CAP_PER_SHELL, Math.round(d)));
}

// A gun knocked off its pad by collapsing ground.
export const FALL_SAFE_PX = 26;
export const FALL_DMG_PER_PX = 0.30;
export const FALL_DMG_MAX = 52;

export function fallDamage(px) {
  if (px <= FALL_SAFE_PX) return 0;
  return Math.min(FALL_DMG_MAX, Math.round((px - FALL_SAFE_PX) * FALL_DMG_PER_PX));
}

// Blast shove. Emplacements are dug in, so this is cosmetic-scale only; it
// exists so a near miss visibly rocks the gun without turning into pinball.
export const SHOVE_MAX_PX = 10;

export function blastShove(shell, dx, distance) {
  if (distance >= shell.falloff) return 0;
  const f = 1 - distance / shell.falloff;
  const dir = dx >= 0 ? 1 : -1;
  return dir * SHOVE_MAX_PX * f * f;
}

// --------------------------------------------------- scoring feedback

export function gradeQuality(q, perfect) {
  if (perfect) return { label: 'PERFECT', tone: 'perfect' };
  if (q >= 0.85) return { label: 'GOOD', tone: 'good' };
  if (q >= 0.55) return { label: 'FAIR', tone: 'fair' };
  if (q >= 0.25) return { label: 'POOR', tone: 'poor' };
  return { label: 'FUMBLED', tone: 'bad' };
}
