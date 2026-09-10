// The practice opponent.
//
// The AI does not cheat and it does not have a private line to the physics that
// the player lacks: it solves the same trajectory problem, then throws the same
// three loading stages, and its skill decides how badly it fumbles both. That
// matters for a practice mode - beating it should mean you actually out-shot
// it, and losing to it should point at something you did wrong.
//
// It also ranges in the way a person does. The first round at a fresh target is
// a guess with real error on it; once it has seen where that one fell, it
// corrects, and the correction gets better the higher its skill.

import * as phys from './physics.js';
import { BASE_MUZZLE, POWER_MIN, POWER_MAX, ANGLE_MIN, ANGLE_MAX } from './balance.js';

export const AI_LEVELS = [
  {
    id: 'recruit', name: 'RECRUIT', skill: 0.30,
    blurb: 'Barely trained. Puts rounds in the same county, eventually.',
  },
  {
    id: 'gunner', name: 'GUNNER', skill: 0.55,
    blurb: 'Competent. Reads the wind, fumbles the ram about as often as you do.',
  },
  {
    id: 'veteran', name: 'VETERAN', skill: 0.76,
    blurb: 'Ranges in fast and rarely wastes a heavy round. Expect to work.',
  },
  {
    id: 'ace', name: 'ACE', skill: 0.92,
    blurb: 'Will bracket you in two rounds and hit with the third. Good luck.',
  },
];

export function aiLevelById(id) {
  return AI_LEVELS.find((l) => l.id === id) || AI_LEVELS[1];
}

// Box-Muller, plain Math.random: the AI's own noise never has to be
// reproducible on another machine because it only ever runs in solo play.
function gauss() {
  const u = Math.max(1e-9, Math.random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const PHASE = { WAIT: 'wait', THINK: 'think', LAY: 'lay', LOAD: 'load', FIRED: 'fired' };

export class AiGunner {
  constructor(level) {
    this.level = level;
    this.skill = level.skill;
    this.phase = PHASE.WAIT;
    this.t = 0;
    this.turnSeen = -1;
    this.target = null;
    this.lastError = null;    // signed, along the firing line
    this.lastSolution = null;
    this.windGuess = 0;       // what it thinks the wind is doing this turn
  }

  reset() {
    this.phase = PHASE.WAIT;
    this.turnSeen = -1;
    this.lastError = null;
    this.lastSolution = null;
    this.windGuess = 0;
  }

  // Cheap ballistic probe. Same forces as the real integrator, coarser step,
  // no terrain: good enough to aim with, and fast enough to search with.
  probe(game, shell, unit, angle, power, targetY) {
    const dt = 1 / 24;
    const g = phys.PHYS.gravity;
    const k = phys.PHYS.dragK;
    // Solves against the wind it BELIEVES is blowing, not the real one. Reading
    // the wind is the central skill of this game, so it is the right place to
    // put the difficulty: a recruit misjudges the gale and lands two hundred
    // pixels downwind, which looks like a bad gunner rather than like noise.
    const windA = this.windGuess * phys.PHYS.windAcc * shell.windDrift;
    const speed = BASE_MUZZLE * shell.velMult * power;
    const v = phys.launchVector(angle, speed, unit.facing);
    let x = unit.muzzle.x, y = unit.muzzle.y, vx = v.vx, vy = v.vy;
    for (let i = 0; i < 700; i++) {
      const sp = Math.sqrt(vx * vx + vy * vy);
      const ds = k * sp / shell.mass;
      vx += (windA - vx * ds) * dt;
      vy += (g - vy * ds) * dt;
      x += vx * dt;
      y += vy * dt;
      if (vy > 0 && y >= targetY) break;
      if (x < -300 || x > game.worldW + 300) break;
    }
    return x;
  }

  // Sweep angles, binary-searching the charge that lands on the target for each.
  solve(game) {
    const unit = game.players[game.turnSide];
    const foe = game.players[game.turnSide === 0 ? 1 : 0];
    const shell = game.currentShell;
    const targetY = foe.y - 16;

    // A better gunner considers a wider spread of solutions and picks a smarter
    // one; a recruit grabs the first thing that roughly works.
    const step = this.skill > 0.7 ? 2 : this.skill > 0.45 ? 4 : 6;
    let best = null;
    for (let ang = 28; ang <= 72; ang += step) {
      let lo = POWER_MIN, hi = POWER_MAX;
      for (let i = 0; i < 16; i++) {
        const mid = (lo + hi) / 2;
        const landed = this.probe(game, shell, unit, ang, mid, targetY);
        if ((landed - foe.x) * unit.facing > 0) hi = mid; else lo = mid;
      }
      const power = (lo + hi) / 2;
      const landed = this.probe(game, shell, unit, ang, power, targetY);
      const err = Math.abs(landed - foe.x);
      // Prefer a solution that is not pinned against the charge limits, and
      // above about 0.7 skill prefer the flatter shot, which the wind has less
      // time to work on.
      let score = err;
      if (power > 0.985 || power < POWER_MIN + 0.015) score += 260;
      if (this.skill > 0.7) score += ang * 0.6;
      if (!best || score < best.score) best = { angle: ang, power, err, score };
    }
    return best || { angle: 45, power: 0.7, err: 9999 };
  }

  // Called once per AI turn.
  planTurn(game) {
    // Misread the wind first: everything downstream is solved against it.
    const slop = 1 - this.skill;
    this.windGuess = game.wind * (1 + gauss() * slop * 0.55)
      + gauss() * slop * 0.30 * (game.maxWind || 1);

    const sol = this.solve(game);
    const unit = game.players[game.turnSide];

    let angle = sol.angle;
    let power = sol.power;

    if (this.lastError !== null && this.lastSolution) {
      // Ranging in: nudge the charge to walk the last round onto the target.
      // Range goes roughly as the square of the charge, so a proportional
      // correction on the charge is close to right.
      const foe = game.players[game.turnSide === 0 ? 1 : 0];
      const reach = Math.max(120, Math.abs(foe.x - unit.x));
      const correction = clamp(-this.lastError / reach, -0.35, 0.35);
      const trust = 0.35 + 0.55 * this.skill;
      power = clamp(power * (1 + correction * trust * 0.5), POWER_MIN, POWER_MAX);
    }

    // Execution error on top, halved once it has a round to correct off. The
    // exponent makes the bottom of the ladder genuinely bad rather than merely
    // slightly worse: (1-skill)^1.25 spreads the four levels far apart.
    const ranged = this.lastError !== null ? 0.45 : 1;
    const slack = Math.pow(1 - this.skill, 1.25);
    angle = clamp(angle + gauss() * slack * 7.0 * ranged, ANGLE_MIN, ANGLE_MAX);
    power = clamp(power * (1 + gauss() * slack * 0.14 * ranged), POWER_MIN, POWER_MAX);

    this.target = { angle, power };
    this.lastSolution = sol;

    // Loading-stage quality, drawn the same way the harness models a player.
    const q = (tightness) => clamp(
      this.skill * 0.9 + 0.1 + gauss() * (0.3 - 0.22 * this.skill) * tightness, 0, 1);
    this.grades = {
      ram: q(1.0),
      elevation: q(1.0),
      fuse: q(1.15),
    };
    // A perfect stage is rare and has to be earned by skill, same as a person.
    this.perfects = {
      ram: this.grades.ram > 0.985 && Math.random() < this.skill,
      elevation: this.grades.elevation > 0.985 && Math.random() < this.skill,
      fuse: this.grades.fuse > 0.985 && Math.random() < this.skill,
    };
  }

  // Driven from Game.update while it is the AI's turn.
  update(game, dt) {
    if (game.turn !== this.turnSeen) {
      this.turnSeen = game.turn;
      this.phase = PHASE.THINK;
      this.t = 0;
      this.planTurn(game);
      this.startAngle = game.players[game.turnSide].angle;
    }

    this.t += dt;
    const unit = game.players[game.turnSide];

    switch (this.phase) {
      case PHASE.THINK:
        // A visible beat of consideration, longer for the careful ones.
        if (this.t > 0.5 + this.skill * 0.6) { this.phase = PHASE.LAY; this.t = 0; }
        break;

      case PHASE.LAY: {
        // Traverse the tube onto the solution so the player can read the shot
        // coming. Ease out, because a gun does not snap.
        const dur = 1.1;
        const k = Math.min(1, this.t / dur);
        const e = 1 - Math.pow(1 - k, 3);
        unit.angle = this.startAngle + (this.target.angle - this.startAngle) * e;
        game.aimAngle = unit.angle;
        game.aimPower = this.target.power;
        if (k >= 1) {
          this.phase = PHASE.LOAD;
          this.t = 0;
          game.beginAiLoad(this.grades, this.perfects);
        }
        break;
      }

      case PHASE.LOAD:
        // The panel reveal is driven by Game; wait for it to finish.
        break;

      default:
        break;
    }
  }

  // Record where the round actually fell, so the next one can be corrected.
  observe(signedError) {
    this.lastError = signedError;
    this.phase = PHASE.FIRED;
  }
}
