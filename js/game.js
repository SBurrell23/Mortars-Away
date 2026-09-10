// Match state machine, turn flow and the authoritative bits of simulation.
//
// Determinism contract with the network layer:
//   * The map, the wind and the shell weight for turn N are all derived from
//     (matchSeed, N) by both peers independently. Nothing is sent for them.
//   * A shot is transmitted as a raw velocity vector plus the shell modifiers.
//     Both peers then run physics.simulate() and get identical trajectories.
//   * Terrain collapse and gun settling run on a fixed-step accumulator whose
//     exit condition is state-based, so frame rate cannot change the outcome.
//   * The host sends a checksum after each resolve; a mismatch triggers a full
//     terrain resync rather than letting the two views drift apart.

import { Rng } from './rng.js';
import { Terrain } from './terrain.js';
import {
  mapById, generateMap, placeProps, buildBackdrop, WORLD_W, WORLD_H,
} from './maps.js';
import * as phys from './physics.js';
import {
  HP_MAX, BASE_MUZZLE, shellById, rollShell, rollWind, resolveShot, blastDamage,
  blastShove, fallDamage, gradeQuality, attritionForTurn, ANGLE_MIN, ANGLE_MAX,
  POWER_MIN, POWER_MAX, TURN_SECONDS, MAX_WIND, UNIT_HIT_RADIUS,
} from './balance.js';
import { LoadSequence } from './minigames.js';
import * as sfx from './audio.js';
import { teamColor } from './render.js';

export const ST = {
  INTRO: 'intro',
  AIM: 'aim',
  LOADING: 'loading',
  FLIGHT: 'flight',
  RESOLVE: 'resolve',
  HANDOFF: 'handoff',
  OVER: 'over',
};

const SETTLE_DT = 1 / 60;
const FLIGHT_POINTS_PER_SEC = 62;

export class Game {
  constructor(deps) {
    this.renderer = deps.renderer;
    this.effects = deps.effects;
    this.sprites = deps.sprites;
    this.tiles = deps.tiles;
    this.net = deps.net;
    this.onEvent = deps.onEvent || (() => {});

    this.state = ST.INTRO;
    this.stateT = 0;
    this.terrain = null;
    this.map = null;
    this.players = [];
    this.turn = 0;
    this.turnSide = 0;
    this.mySide = 0;
    this.localBoth = false;    // hot-seat: this client drives both guns
    this.matchSeed = 0;
    this.wind = 0;
    this.maxWind = MAX_WIND;
    this.currentShell = null;
    this.aimAngle = 45;
    this.aimPower = 0.75;
    this.load = new LoadSequence();
    this.shell = null;
    this.shotResult = null;
    this.pendingShot = null;
    this.turnDeadline = 0;
    this.turnRemaining = 0;
    this.turnLength = TURN_SECONDS;
    this.banner = null;
    this.toast = null;
    this.winner = -1;
    this.settleAcc = 0;
    this.settling = false;
    this.lastTrail = null;
    this.whistleHandle = null;
    this.aimSendAcc = 0;
    this.roundLog = [];
    this.desyncCount = 0;
    this.keyRepeat = { up: 0, down: 0, left: 0, right: 0 };
    this.stats = { shotsFired: 0, hits: 0, perfects: 0, bestDamage: 0 };
  }

  // ------------------------------------------------------------ setup

  startMatch(opts) {
    this.matchSeed = opts.seed >>> 0;
    this.mySide = opts.mySide;
    this.localBoth = !!opts.localBoth;
    this.map = mapById(opts.mapId);
    this.turn = 0;
    this.winner = -1;
    this.desyncCount = 0;
    this.roundLog = [];
    this.stats = { shotsFired: 0, hits: 0, perfects: 0, bestDamage: 0 };

    const rng = new Rng(this.matchSeed);
    const gen = generateMap(this.map, rng);

    this.terrain = new Terrain(WORLD_W, WORLD_H);
    this.terrain.build(gen.heightFn, this.map.layers, this.tiles, rng);

    this.props = placeProps(this.map, gen.heights, rng, gen.anchors);
    this.backdrop = buildBackdrop(this.map, rng);

    const names = opts.names || ['ALLIED', 'AXIS'];
    this.players = [0, 1].map((side) => ({
      id: side,
      side,
      name: names[side] || (side === 0 ? 'ALLIED' : 'AXIS'),
      x: gen.anchors[side],
      y: gen.padY[side],
      hp: HP_MAX,
      hpGhost: HP_MAX,
      angle: 45,
      facing: side === 0 ? 1 : -1,
      recoil: 0,
      hitFlash: 0,
      vy: 0,
      falling: false,
      fallFrom: 0,
      muzzle: { x: gen.anchors[side], y: gen.padY[side] - 20 },
    }));

    // The host always opens. Sides are assigned in the lobby.
    this.turnSide = 0;
    this.finalRound = false;
    this.effects.clear();
    this.setState(ST.INTRO);
    this.banner = { text: this.map.name.toUpperCase(), sub: this.map.desc, t: 3.0 };
    sfx.startWind();
    sfx.playMusic('battle');
    this.beginTurn(0, true);
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  // Wind and shell for a turn are a pure function of (seed, turn), so both
  // peers agree without exchanging a single byte.
  turnRng(turn) {
    return new Rng((this.matchSeed ^ Math.imul(turn + 1, 2654435761)) >>> 0);
  }

  beginTurn(turn, first) {
    this.turn = turn;
    this.turnSide = turn % 2 === 0 ? 0 : 1;

    // Counter-battery attrition once a duel has dragged on, so two gunners who
    // cannot find each other are not stuck there all night.
    const attr = attritionForTurn(turn);
    if (attr > 0) {
      for (const p of this.players) p.hp = Math.max(0, p.hp - attr);
      this.effects.text(WORLD_W / 2, 150, 'COUNTER-BATTERY FIRE  -' + attr, '#c9502f',
        { size: 22, life: 2.2 });
      if (this.checkElimination()) return;
    }

    const rng = this.turnRng(turn);
    this.wind = rollWind(rng, this.map.windBias);
    this.maxWind = MAX_WIND * this.map.windBias;
    this.currentShell = rollShell(rng);
    this.shell = null;
    this.shotResult = null;
    this.pendingShot = null;
    this.lastTrail = null;
    this.enemyLoading = false;
    // Drop a held checksum only once its turn is behind us.
    this.pendingSync = this.pendingSync && this.pendingSync.turn >= turn ? this.pendingSync : null;

    // Carry the player's previous aim over so ranging in feels continuous.
    const me = this.players[this.turnSide];
    this.aimAngle = me.lastAngle !== undefined ? me.lastAngle : 45;
    this.aimPower = me.lastPower !== undefined ? me.lastPower : 0.75;
    me.angle = this.aimAngle;

    this.turnLength = TURN_SECONDS;
    this.turnRemaining = TURN_SECONDS;
    this.turnDeadline = performance.now() + TURN_SECONDS * 1000;
    this.lastCountdownSecond = 99;

    sfx.setWind(this.wind, this.maxWind);
    this.setState(ST.AIM);

    // Guest side: the host runs a little ahead, so its checksum for this turn
    // has usually already arrived and been held. Check it now.
    if (this.pendingSync && this.pendingSync.turn === turn) {
      const held = this.pendingSync;
      this.pendingSync = null;
      this.verifySync(held);
    }

    // Host side: publish the checksum at the START of each turn, so the turn
    // number in the message is the one both peers should now be on. Publishing
    // it during the previous turn's resolve made a resyncing guest restore to a
    // turn the host had already left, and the match hung.
    if (!first && this.net && !this.net.local && this.net.isHost) {
      this.net.send({
        t: 'sync',
        turn,
        ck: this.terrain.checksum(),
        hp: [this.players[0].hp, this.players[1].hp],
        px: [Math.round(this.players[0].x), Math.round(this.players[1].x)],
        py: [Math.round(this.players[0].y), Math.round(this.players[1].y)],
      });
    }

    if (!first) {
      const who = this.isMyTurn() ? 'YOUR GUN' : this.players[this.turnSide].name.toUpperCase();
      this.toast = { text: who + ' -- ' + this.currentShell.short, t: 2.0, color: teamColor(this.turnSide) };
    }
    this.onEvent('turn', { turn, side: this.turnSide });
  }

  isMyTurn() {
    return this.localBoth || this.turnSide === this.mySide;
  }

  // ------------------------------------------------------------ input

  adjustAngle(delta) {
    if (this.state !== ST.AIM || !this.isMyTurn()) return;
    this.aimAngle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, this.aimAngle + delta));
    this.players[this.turnSide].angle = this.aimAngle;
  }

  adjustPower(delta) {
    if (this.state !== ST.AIM || !this.isMyTurn()) return;
    this.aimPower = Math.max(POWER_MIN, Math.min(POWER_MAX, this.aimPower + delta));
  }

  // Click-drag aiming: point at where you want the tube to look.
  aimAt(wx, wy) {
    if (this.state !== ST.AIM || !this.isMyTurn()) return;
    const u = this.players[this.turnSide];
    const dx = (wx - u.x) * u.facing;
    const dy = u.y - 20 - wy;
    if (dx <= 0) return;
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    this.aimAngle = Math.max(ANGLE_MIN, Math.min(ANGLE_MAX, deg));
    u.angle = this.aimAngle;
  }

  beginLoading() {
    if (this.state !== ST.AIM || !this.isMyTurn()) return;
    const u = this.players[this.turnSide];
    u.lastAngle = this.aimAngle;
    u.lastPower = this.aimPower;
    this.load.start();
    this.setState(ST.LOADING);
    if (!this.localBoth) this.net.send({ t: 'loading', turn: this.turn });
    sfx.uiClick(1.2);
  }

  minigamePress() {
    if (this.state !== ST.LOADING || !this.isMyTurn()) return;
    this.load.press();
  }

  // ------------------------------------------------------------ firing

  fireResolved() {
    const shell = this.currentShell;
    const ramR = this.load.results.ram;
    const elevR = this.load.results.elevation;
    const fuseR = this.load.results.fuse;

    const res = resolveShot({
      shell,
      angleDeg: this.aimAngle,
      power: this.aimPower,
      facing: this.players[this.turnSide].facing,
      ramQ: ramR.quality,
      elevQ: elevR.quality,
      elevSign: elevR.sign || 1,
      fuseQ: fuseR.quality,
      perfects: this.load.perfects,
    });

    const u = this.players[this.turnSide];
    const muzzle = u.muzzle;
    const v = phys.launchVector(res.finalAngle, res.speed, u.facing);

    const msg = {
      t: 'fire',
      turn: this.turn,
      x: muzzle.x,
      y: muzzle.y,
      vx: v.vx,
      vy: v.vy,
      shellId: shell.id,
      fuseRadius: res.fuseRadius,
      fuseArm: res.fuseArm,
      dmgMult: res.dmgMult,
      craterMult: res.craterMult,
      bonusDmg: res.bonusDmg,
      allPerfect: res.allPerfect,
      angle: res.finalAngle,
      grades: {
        ram: ramR.quality, elevation: elevR.quality, fuse: fuseR.quality,
        rp: !!this.load.perfects.ram,
        ep: !!this.load.perfects.elevation,
        fp: !!this.load.perfects.fuse,
      },
    };

    if (!this.localBoth) this.net.send(msg);
    this.executeShot(msg);
  }

  // Runs on both peers with identical input.
  executeShot(msg) {
    const shell = shellById(msg.shellId);
    const shooter = this.players[this.turn % 2 === 0 ? 0 : 1];
    const enemy = this.players[shooter.side === 0 ? 1 : 0];

    const world = {
      width: WORLD_W,
      height: WORLD_H,
      wind: this.wind,
      waterY: this.map.water || 0,
      solidAt: (x, y) => this.terrain.solidAt(x, y),
      targets: [{
        x: enemy.x, y: enemy.y - 16, r: UNIT_HIT_RADIUS, id: enemy.id,
      }],
    };

    const shot = {
      x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
      mass: shell.mass,
      windDrift: shell.windDrift,
      fuseArm: msg.fuseArm,
      fuseRadius: msg.fuseRadius,
    };

    this.shotResult = phys.simulate(shot, world);
    this.shotMsg = msg;
    this.shotShell = shell;

    // Muzzle flash and recoil.
    const dirLen = Math.hypot(msg.vx, msg.vy) || 1;
    this.effects.muzzleBlast(msg.x, msg.y, msg.vx / dirLen, msg.vy / dirLen, shell.mass);
    shooter.recoil = 1;
    sfx.fire(shell.mass);
    sfx.duck(0.5, 0.7);

    this.shell = {
      x: msg.x, y: msg.y, vx: msg.vx, vy: msg.vy,
      sprite: shell.sprite,
      fuseRadius: msg.fuseRadius,
      mass: shell.mass,
      idx: 0,
      trailAcc: 0,
    };
    this.flightPos = 0;
    this.lastTrail = null;
    this.whistleHandle = sfx.whistle();
    // The after-action report is about THIS player's shooting, so only credit
    // rounds this client actually fired. In a hot-seat duel both guns are ours.
    this.shotIsMine = this.isMyTurnFor(shooter.side);
    this.shotEnemyId = enemy.id;
    if (this.shotIsMine) {
      this.stats.shotsFired++;
      if (msg.allPerfect) this.stats.perfects++;
    }

    // Grade feedback for the shooter only.
    if (this.isMyTurnFor(shooter.side) && msg.grades) {
      const g = msg.grades;
      const parts = [];
      parts.push(gradeQuality(g.ram, g.rp).label);
      parts.push(gradeQuality(g.elevation, g.ep).label);
      parts.push(gradeQuality(g.fuse, g.fp).label);
      this.toast = {
        text: msg.allPerfect ? 'TEXTBOOK ROUND' : parts.join(' / '),
        t: 2.4,
        color: msg.allPerfect ? '#e2c45a' : '#e8e2cc',
      };
    }

    this.setState(ST.FLIGHT);
  }

  isMyTurnFor(side) {
    return this.localBoth || side === this.mySide;
  }

  // ----------------------------------------------------------- update

  update(dt) {
    this.stateT += dt;
    this.effects.update(dt);

    for (const p of this.players) {
      p.recoil = Math.max(0, p.recoil - dt * 5);
      p.hitFlash = Math.max(0, p.hitFlash - dt * 2.4);
      if (p.hpGhost > p.hp) p.hpGhost = Math.max(p.hp, p.hpGhost - dt * 42);
    }
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }
    if (this.toast) {
      this.toast.t -= dt;
      if (this.toast.t <= 0) this.toast = null;
    }

    switch (this.state) {
      case ST.AIM: this.updateAim(dt); break;
      case ST.LOADING: this.updateLoading(dt); break;
      case ST.FLIGHT: this.updateFlight(dt); break;
      case ST.RESOLVE: this.updateResolve(dt); break;
      case ST.HANDOFF:
        if (this.stateT > 1.15) this.beginTurn(this.turn + 1, false);
        break;
      default: break;
    }
  }

  updateAim(dt) {
    // Held-key acceleration so fine adjustment is possible but coarse
    // adjustment is not tedious.
    const k = this.keyRepeat;
    const accel = (held) => (held < 0.35 ? 1 : held < 1.1 ? 2.4 : 5.5);
    if (k.up > 0) { k.up += dt; this.adjustAngle(22 * dt * accel(k.up)); }
    if (k.down > 0) { k.down += dt; this.adjustAngle(-22 * dt * accel(k.down)); }
    if (k.right > 0) { k.right += dt; this.adjustPower(0.19 * dt * accel(k.right)); }
    if (k.left > 0) { k.left += dt; this.adjustPower(-0.19 * dt * accel(k.left)); }

    this.turnRemaining = Math.max(0, (this.turnDeadline - performance.now()) / 1000);
    const secs = Math.ceil(this.turnRemaining);
    if (this.isMyTurn() && secs <= 5 && secs !== this.lastCountdownSecond) {
      this.lastCountdownSecond = secs;
      if (secs > 0) sfx.countdown(secs === 1);
    }

    if (this.isMyTurn()) {
      // Stream the barrel angle so the opponent sees you ranging in.
      this.aimSendAcc += dt;
      if (!this.localBoth && this.aimSendAcc > 0.11) {
        this.aimSendAcc = 0;
        this.net.send({ t: 'aim', turn: this.turn, a: Math.round(this.aimAngle * 10) / 10 });
      }
      if (this.turnRemaining <= 0) {
        // Out of time: rush the load rather than forfeiting the turn.
        this.load.start();
        this.load.forceRushed();
        this.toast = { text: 'OUT OF TIME - RUSHED ROUND', t: 2.2, color: '#c9502f' };
        this.fireResolved();
      }
    }
  }

  updateLoading(dt) {
    this.load.update(dt);
    this.turnRemaining = Math.max(0, (this.turnDeadline - performance.now()) / 1000);
    if (this.load.done) this.fireResolved();
  }

  updateFlight(dt) {
    const r = this.shotResult;
    const pts = r.path;
    const total = pts.length / 2;

    // Long, high shots get a modest speed-up so nobody waits on ballistics.
    const speed = FLIGHT_POINTS_PER_SEC * (this.stateT > 3.5 ? 1.7 : 1);
    this.flightPos += dt * speed;
    const i = Math.min(total - 1, Math.floor(this.flightPos));

    const px = pts[i * 2], py = pts[i * 2 + 1];
    const prevI = Math.max(0, i - 1);
    this.shell.vx = (px - pts[prevI * 2]) * 60;
    this.shell.vy = (py - pts[prevI * 2 + 1]) * 60;
    this.shell.x = px;
    this.shell.y = py;

    // Smoke trail.
    this.shell.trailAcc += dt;
    if (this.shell.trailAcc > 0.016 && py > -40) {
      this.shell.trailAcc = 0;
      this.effects.trailPuff(px, py, this.shell.mass);
    }

    if (this.whistleHandle) {
      this.whistleHandle.update(i / Math.max(1, total - 1), this.shell.vy);
    }

    if (i >= total - 1) this.impact();
  }

  impact() {
    if (this.whistleHandle) { this.whistleHandle.stop(); this.whistleHandle = null; }
    const r = this.shotResult;
    const msg = this.shotMsg;
    const shell = this.shotShell;

    // Spotting report. Ranging in off the last round is how artillery actually
    // works, and without this a new player has no idea whether they were forty
    // pixels out or four hundred.
    const shooterNow = this.players[this.turnSide];
    const enemyNow = this.players[this.turnSide === 0 ? 1 : 0];
    const along = (r.x - enemyNow.x) * shooterNow.facing;
    shooterNow.lastRange = {
      err: Math.round(along),
      word: Math.abs(along) < 26 ? 'ON' : along > 0 ? 'LONG' : 'SHORT',
    };
    shooterNow.trail = r.path;

    if (r.outcome === phys.HIT_WATER) {
      sfx.splash();
      this.effects.splash(r.x, r.y);
      this.effects.text(r.x, r.y - 40, 'INTO THE DRINK', '#9fd0dc', { size: 20 });
      this.toast = { text: 'SHORT -- INTO THE WATER', t: 2.0, color: '#7fb6c9' };
      this.roundLog.push({ turn: this.turn, outcome: 'water', dmg: 0 });
      this.lastTrail = r.path;
      this.setState(ST.HANDOFF);
      return;
    }

    if (r.outcome === phys.OUT_OF_BOUNDS || r.outcome === phys.TIMED_OUT) {
      sfx.dud();
      this.toast = { text: r.outcome === phys.TIMED_OUT ? 'ROUND LOST' : 'OFF THE MAP', t: 2.0, color: '#9c9382' };
      this.effects.text(Math.max(40, Math.min(WORLD_W - 40, r.x)),
        Math.max(90, Math.min(WORLD_H - 60, r.y)), 'NO EFFECT', '#9c9382', { size: 22 });
      this.roundLog.push({ turn: this.turn, outcome: 'miss', dmg: 0 });
      this.lastTrail = r.path;
      this.setState(ST.HANDOFF);
      return;
    }

    const airburst = r.outcome === phys.HIT_AIRBURST;
    const direct = r.outcome === phys.HIT_UNIT;
    const craterR = Math.round(shell.crater * (msg.craterMult || 1) * (airburst ? 0.42 : 1));

    this.effects.explode(r.x, r.y, craterR, shell.mass * (airburst ? 1.1 : 1), airburst);
    sfx.explosion(shell.mass * (airburst ? 1.15 : 1), 0);
    sfx.duck(0.28, 1.2);

    // Carve the ground.
    this.terrain.destroy(r.x, r.y, craterR);
    const loose = this.terrain.findLooseChunks(r.x, r.y, craterR);
    if (loose.length) {
      this.terrain.chunks.push(...loose);
      sfx.crumble();
    }

    // Damage everyone in range.
    let totalDamage = 0;
    let damageToEnemy = 0;
    for (const p of this.players) {
      const ux = p.x, uy = p.y - 16;
      const d = Math.hypot(r.x - ux, r.y - uy);
      const isDirect = direct && r.targetId === p.id;
      const dmg = blastDamage(shell, d, msg.dmgMult, isDirect, airburst, msg.bonusDmg);
      if (dmg <= 0) continue;
      p.hp = Math.max(0, p.hp - dmg);
      p.hitFlash = 1;
      totalDamage += dmg;
      if (p.id === this.shotEnemyId) damageToEnemy += dmg;
      const shove = blastShove(shell, ux - r.x, d);
      p.x = Math.max(24, Math.min(WORLD_W - 24, p.x + shove));
      const mine = this.isMyTurnFor(p.side);
      sfx.hurt(mine);
      this.effects.text(ux, uy - 30, '-' + dmg, isDirect ? '#f2d071' : '#e8734a',
        { size: isDirect ? 30 : 24 });
      if (isDirect) this.effects.text(ux, uy - 58, 'DIRECT HIT', '#e2c45a', { size: 18, life: 1.8 });
      else if (airburst) this.effects.text(ux, uy - 58, 'AIRBURST', '#e2c45a', { size: 18, life: 1.8 });
    }
    if (this.shotIsMine && damageToEnemy > 0) {
      this.stats.hits++;
      this.stats.bestDamage = Math.max(this.stats.bestDamage, damageToEnemy);
    }
    this.roundLog.push({
      turn: this.turn, outcome: direct ? 'direct' : airburst ? 'airburst' : 'blast', dmg: totalDamage,
    });

    // Guns start falling if their ground went away.
    for (const p of this.players) {
      p.fallFrom = p.y;
      p.falling = false;
      p.vy = 0;
    }

    this.lastTrail = r.path;
    this.settleAcc = 0;
    this.settling = true;
    this.setState(ST.RESOLVE);
  }

  // Fixed-step settle so both peers land on identical geometry.
  updateResolve(dt) {
    this.settleAcc += Math.min(0.1, dt);
    let guard = 0;
    while (this.settleAcc >= SETTLE_DT && guard < 240) {
      this.settleAcc -= SETTLE_DT;
      guard++;
      this.settleStep();
    }
    if (!this.settling && this.stateT > 1.5) {
      this.finishResolve();
    }
  }

  settleStep() {
    let busy = false;

    // Falling terrain clusters.
    const landed = [];
    for (const ch of this.terrain.chunks) landed.push(ch);
    if (this.terrain.stepChunks(SETTLE_DT, 900)) busy = true;
    for (const ch of landed) {
      if (this.terrain.chunks.indexOf(ch) === -1) {
        this.effects.collapse(ch.x + 8, ch.y + 8, Math.min(10, 3 + (ch.count >> 5)));
      }
    }

    // Guns fall until they find ground.
    for (const p of this.players) {
      const support = this.terrain.groundLevel(p.x, 14);
      if (support > p.y + 1.5) {
        p.falling = true;
        p.vy += 900 * SETTLE_DT;
        p.y = Math.min(support, p.y + p.vy * SETTLE_DT);
        busy = true;
        if (p.y >= support) {
          const drop = p.y - p.fallFrom;
          p.vy = 0;
          p.falling = false;
          const dmg = fallDamage(drop);
          if (dmg > 0) {
            p.hp = Math.max(0, p.hp - dmg);
            p.hitFlash = 1;
            this.effects.text(p.x, p.y - 44, '-' + dmg + ' FALL', '#e8734a', { size: 20 });
            sfx.hurt(this.isMyTurnFor(p.side));
          }
          this.effects.collapse(p.x, p.y, 8);
          p.fallFrom = p.y;
        }
      } else if (support < p.y) {
        // Ground rose under the gun (debris landed on it); ride it up.
        p.y = support;
      }
    }

    if (!busy) this.settling = false;
  }

  finishResolve() {
    if (this.checkElimination()) return;

    this.setState(ST.HANDOFF);
  }

  // A kill only ends the match once both batteries have fired the same number
  // of rounds. Without this the side that opens wins about two thirds of
  // high-level games purely for going first; with it, a gun that is knocked out
  // on an even turn still gets its reply in, and if that reply kills too, the
  // duel is a draw. Returns true if the match is over.
  checkElimination() {
    const dead = this.players.filter((p) => p.hp <= 0);
    if (!dead.length) return false;

    // Side 0 fires on even turns, side 1 on odd, so shot counts are level
    // exactly when the turn index that just finished is odd.
    const level = this.turn % 2 === 1;
    if (!level && !this.finalRound) {
      this.finalRound = true;
      this.banner = {
        text: 'RETURN FIRE',
        sub: dead[0].name.toUpperCase() + ' has one round left',
        t: 2.6,
      };
      sfx.countdown(true);
      return false;
    }

    this.winner = dead.length === 2 ? -2 : (dead[0].side === 0 ? 1 : 0);
    this.endMatch();
    return true;
  }

  endMatch() {
    this.setState(ST.OVER);
    sfx.stopMusic();
    sfx.stopWind();
    const won = this.winner === this.mySide || (this.localBoth && this.winner >= 0);
    if (this.winner === -2) {
      this.banner = { text: 'MUTUAL DESTRUCTION', sub: 'Both batteries silenced', t: 999 };
    } else if (this.localBoth) {
      this.banner = {
        text: this.players[this.winner].name.toUpperCase() + ' WINS',
        sub: 'Battery ' + this.players[this.winner === 0 ? 1 : 0].name.toUpperCase() + ' is silenced',
        t: 999,
      };
    } else {
      this.banner = {
        text: won ? 'VICTORY' : 'DEFEAT',
        sub: won ? 'Enemy battery silenced' : 'Your battery is silenced',
        t: 999,
      };
    }
    if (won || this.localBoth) sfx.victory(); else sfx.defeat();
    this.onEvent('gameover', { winner: this.winner, stats: this.stats });
  }

  // ---------------------------------------------------------- network

  onMessage(msg) {
    switch (msg.t) {
      case 'aim':
        if (msg.turn === this.turn && this.turnSide !== this.mySide) {
          this.players[this.turnSide].angle = msg.a;
        }
        break;

      case 'loading':
        if (msg.turn === this.turn && this.turnSide !== this.mySide) {
          this.enemyLoading = true;
        }
        break;

      case 'fire':
        if (msg.turn !== this.turn) {
          // Arrived for a turn we are not on: ask for a full resync.
          this.requestResync();
          return;
        }
        this.executeShot(msg);
        break;

      case 'sync':
        this.verifySync(msg);
        break;

      case 'needresync':
        if (this.net.isHost) this.sendFullState();
        break;

      case 'fullstate':
        this.applyFullState(msg);
        break;

      default:
        break;
    }
  }

  verifySync(msg) {
    // The host enters the next turn while the guest is still playing out the
    // explosion, so its checksum routinely arrives a turn early. Hold onto it
    // and check it the moment this peer reaches that turn -- dropping it, as
    // an earlier version did, meant desyncs were never detected at all.
    if (msg.turn > this.turn) { this.pendingSync = msg; return; }
    if (msg.turn < this.turn) return;
    this.pendingSync = null;
    const mine = this.terrain.checksum();
    const hpOk = Math.abs(msg.hp[0] - this.players[0].hp) < 0.5
      && Math.abs(msg.hp[1] - this.players[1].hp) < 0.5;
    if (mine === msg.ck && hpOk) {
      this.desyncCount = 0;
      return;
    }
    this.desyncCount++;
    this.onEvent('desync', { count: this.desyncCount });
    this.requestResync();
  }

  requestResync() {
    if (!this.net || this.net.local) return;
    if (this.net.isHost) return; // the host is the reference, nothing to ask
    this.net.send({ t: 'needresync' });
    this.toast = { text: 'RESYNCHRONISING', t: 2.0, color: '#d0a03a' };
  }

  sendFullState() {
    this.net.send({
      t: 'fullstate',
      turn: this.turn,
      terrain: this.terrain.serialize(),
      hp: [this.players[0].hp, this.players[1].hp],
      px: [this.players[0].x, this.players[1].x],
      py: [this.players[0].y, this.players[1].y],
    });
  }

  applyFullState(msg) {
    this.terrain.deserialize(msg.terrain);
    for (let i = 0; i < 2; i++) {
      this.players[i].hp = msg.hp[i];
      this.players[i].hpGhost = msg.hp[i];
      this.players[i].x = msg.px[i];
      this.players[i].y = msg.py[i];
    }
    if (this.whistleHandle) { this.whistleHandle.stop(); this.whistleHandle = null; }
    this.effects.clear();
    this.shell = null;
    this.shotResult = null;
    this.lastTrail = null;
    this.settling = false;
    // Always re-enter the host's turn, even if the numbers happen to agree, so
    // there is exactly one path back into a known-good state.
    this.beginTurn(msg.turn, true);
    this.toast = { text: 'STATE RESTORED', t: 1.6, color: '#6f9e4a' };
  }

  // ------------------------------------------------------------- draw

  draw(dt) {
    const r = this.renderer;
    const shake = this.effects.shakeOffset();
    r.begin(shake);

    r.drawSky(this.map);
    r.drawBackdrop(this.backdrop, this.sprites, this.map, dt);
    this.effects.drawGroundSmoke(r.ctx);
    r.drawTerrain(this.terrain);
    r.drawProps(this.props, this.sprites);
    r.drawWater(this.map, r.time);

    // The arc of the round just fired stays up through the impact, and while a
    // gunner is aiming they see their OWN last arc rather than the enemy's --
    // that is the line they are correcting off.
    if (this.lastTrail) r.drawTrail(this.lastTrail, 0.16);
    else if (this.state === ST.AIM) {
      const own = this.players[this.turnSide].trail;
      if (own) r.drawTrail(own, 0.11);
    }

    // Aiming ghost, shooter only.
    if (this.state === ST.AIM && this.isMyTurn()) {
      r.drawAimGhost(this.aimGhost());
    }

    const marker = this.state === ST.AIM || this.state === ST.LOADING;
    for (const p of this.players) {
      r.drawMortar(p, this.sprites, { marker: marker && p.side === this.turnSide });
    }

    if (this.shell && this.state === ST.FLIGHT) {
      r.drawShell(this.shell, this.sprites);
      r.drawOffscreenShell(this.shell);
    }

    this.effects.draw(r.ctx, this.boomFrames);
    this.effects.drawTexts(r.ctx);
    r.drawVignette();
    this.effects.drawFlash(r.ctx, WORLD_W, WORLD_H);

    r.drawHud(this, this.sprites);
    if (this.state === ST.AIM && this.isMyTurn()) r.drawGunPanel(this, this.sprites);

    if (this.state === ST.AIM && !this.isMyTurn()) {
      r.drawBanner(this.enemyLoading ? 'ENEMY IS LOADING' : 'ENEMY IS RANGING IN',
        this.enemyLoading ? 'Brace' : this.players[this.turnSide].name.toUpperCase() + ' has the gun',
        '#9c9382');
    }

    if (this.banner) {
      r.drawBanner(this.banner.text, this.banner.sub,
        this.state === ST.OVER
          ? (this.winner === this.mySide || this.localBoth ? '#e2c45a' : '#c9502f')
          : '#e2c45a');
    }
    if (this.toast) r.drawToast(this.toast.text, this.toast.color);

    // Drawn last: while a gunner is working the loading stages, nothing is
    // allowed to sit on top of the panel they are reacting to.
    if (this.state === ST.LOADING && this.isMyTurn()) {
      const box = { x: WORLD_W / 2 - 300, y: WORLD_H / 2 - 140, w: 600, h: 290 };
      this.load.draw(r.ctx, box);
    }

    if (this.state === ST.AIM && this.isMyTurn()) this.drawAimHelp(r);

    r.drawScanlines();
    r.end();
  }

  drawAimHelp(r) {
    const ctx = r.ctx;
    ctx.save();
    ctx.font = '13px "Courier New", ui-monospace, monospace';
    ctx.fillStyle = 'rgba(232,226,204,0.55)';
    ctx.textAlign = 'right';
    ctx.fillText('W / S  elevation      A / D  charge      SPACE  load and fire', WORLD_W - 18, WORLD_H - 22);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  aimGhost() {
    const u = this.players[this.turnSide];
    const shell = this.currentShell;
    const speed = BASE_MUZZLE * shell.velMult * this.aimPower;
    const v = phys.launchVector(this.aimAngle, speed, u.facing);
    const m = u.muzzle;
    return phys.previewPath({
      x: m.x, y: m.y, vx: v.vx, vy: v.vy,
      mass: shell.mass, windDrift: shell.windDrift,
    }, { width: WORLD_W, height: WORLD_H, wind: this.wind, waterY: this.map.water || 0 }, 0.85);
  }
}
