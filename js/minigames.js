// The three loading stages. Each one is a tiny self-contained state machine
// that draws itself into a panel on the main canvas and reports a quality
// value between 0 and 1.

import { MINIGAMES } from './balance.js';
import * as sfx from './audio.js';

const FONT = '"Courier New", ui-monospace, monospace';

// The panel is sized for the fuse sight, which is the tallest of the three
// stages by some way. Every stage hangs its working area off the middle of the
// space between the header and the stage pips so the shorter ones do not sit
// up under the title with a drift of dead panel below them.
function bodyMid(box) {
  return box.y + 64 + (box.h - 82) / 2;
}

class Stage {
  constructor(cfg) {
    this.cfg = cfg;
    this.done = false;
    this.t = 0;
    this.result = null;
    this.flash = 0;
  }
  start() { this.t = 0; this.done = false; this.result = null; }
  update() {}
  press() {}
  draw() {}
  finish(quality, perfect, raw, extra) {
    if (this.done) return;
    this.done = true;
    this.result = Object.assign({ quality, perfect, raw }, extra || {});
    if (perfect) sfx.perfect();
    else if (quality >= 0.55) sfx.good();
    else sfx.fail();
  }
}

// ---------------------------------------------------------------- RAM

export class RamStage extends Stage {
  constructor() {
    super(MINIGAMES.ram);
    this.presses = 0;
    this.shake = 0;
    this.armed = false;
  }
  start() {
    super.start();
    this.presses = 0;
    this.shake = 0;
    // Short arming delay stops a held key from the previous screen counting.
    this.armed = false;
  }
  update(dt) {
    if (this.done) return;
    this.t += dt;
    if (this.t > 0.35) this.armed = true;
    this.shake = Math.max(0, this.shake - dt * 7);
    if (this.t * 1000 >= this.cfg.durationMs + 350) {
      const q = this.cfg.quality(this.presses);
      this.finish(q, this.cfg.isPerfect(this.presses), this.presses);
    }
  }
  press() {
    if (this.done || !this.armed) return;
    this.presses++;
    this.shake = 1;
    sfx.ram(0.6 + 0.4 * Math.min(1, this.presses / this.cfg.targetPresses));
  }
  draw(ctx, box) {
    const { x, y, w, h } = box;
    const cfg = this.cfg;
    const elapsed = Math.max(0, this.t * 1000 - 350);
    const timeLeft = Math.max(0, 1 - elapsed / cfg.durationMs);
    const fill = Math.min(1, this.presses / cfg.targetPresses);

    panel(ctx, box, cfg.title, cfg.hint);

    // Ramrod track.
    const bx = x + 40, bw = w - 80;
    const by = bodyMid(box) - 44, bh = 34;
    ctx.fillStyle = '#15120e';
    ctx.fillRect(bx, by, bw, bh);
    const grd = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grd.addColorStop(0, '#7a4a20');
    grd.addColorStop(0.7, '#c07a26');
    grd.addColorStop(1, '#f0c04a');
    ctx.fillStyle = grd;
    ctx.fillRect(bx + 2, by + 2, (bw - 4) * fill, bh - 4);
    // Target notch.
    ctx.fillStyle = '#e8e2cc';
    ctx.fillRect(bx + bw - 4, by - 6, 3, bh + 12);
    strokeRect(ctx, bx, by, bw, bh, '#5e5546');

    // The ramrod itself jolts on each stroke.
    const jolt = this.shake * 9;
    const rodX = bx + (bw - 4) * fill;
    ctx.fillStyle = '#cfc7ae';
    ctx.fillRect(rodX - 6 - jolt, by - 10, 8, bh + 20);
    ctx.fillStyle = '#8a8271';
    ctx.fillRect(rodX - 6 - jolt, by - 10, 8, 4);

    // Timer.
    const ty = by + bh + 22;
    ctx.fillStyle = '#241f18';
    ctx.fillRect(bx, ty, bw, 10);
    ctx.fillStyle = timeLeft > 0.3 ? '#6f9e4a' : '#c34a34';
    ctx.fillRect(bx + 1, ty + 1, (bw - 2) * timeLeft, 8);

    ctx.font = 'bold 26px ' + FONT;
    ctx.fillStyle = '#e8e2cc';
    ctx.textAlign = 'center';
    ctx.fillText(this.presses + ' / ' + cfg.targetPresses, x + w / 2, ty + 42);
    ctx.textAlign = 'left';
  }
}

// ---------------------------------------------------------- ELEVATION

export class ElevationStage extends Stage {
  constructor() {
    super(MINIGAMES.elevation);
    this.pos = 0;
    this.dir = 1;
    this.lockedAt = null;
  }
  start() {
    super.start();
    this.pos = 0;
    this.dir = 1;
    this.lockedAt = null;
  }
  update(dt) {
    if (this.done) {
      this.flash = Math.max(0, this.flash - dt * 3);
      return;
    }
    this.t += dt;
    const cfg = this.cfg;
    this.pos += this.dir * cfg.speed * dt;
    if (this.pos > cfg.barWidth) { this.pos = cfg.barWidth - (this.pos - cfg.barWidth); this.dir = -1; }
    if (this.pos < 0) { this.pos = -this.pos; this.dir = 1; }
    // Auto-lock at the worst possible moment if the player dithers.
    if (this.t > 8) this.press();
  }
  press() {
    if (this.done) return;
    const cfg = this.cfg;
    const err = Math.abs(this.pos - cfg.barWidth / 2);
    this.lockedAt = this.pos;
    this.flash = 1;
    const perfect = cfg.isPerfect(err);
    // Which side of centre decides which way the tube is off.
    const sign = this.pos >= cfg.barWidth / 2 ? 1 : -1;
    this.finish(cfg.quality(err), perfect, err, { sign });
  }
  draw(ctx, box) {
    const { x, y, w, h } = box;
    const cfg = this.cfg;
    panel(ctx, box, cfg.title, cfg.hint);

    const bw = cfg.barWidth;
    const bx = x + (w - bw) / 2;
    const by = bodyMid(box) - 28, bh = 40;

    ctx.fillStyle = '#15120e';
    ctx.fillRect(bx, by, bw, bh);

    // Graduation marks so the bar reads like a gunner's sight.
    ctx.fillStyle = '#3c362c';
    for (let i = 0; i <= 20; i++) {
      const gx = bx + (bw * i) / 20;
      const tall = i % 5 === 0;
      ctx.fillRect(gx | 0, by + (tall ? 4 : 10), 1, tall ? bh - 8 : bh - 20);
    }

    // Good band and perfect core.
    const cx = bx + bw / 2;
    ctx.fillStyle = 'rgba(111,158,74,0.30)';
    ctx.fillRect(cx - cfg.goodZone, by, cfg.goodZone * 2, bh);
    ctx.fillStyle = 'rgba(226,196,90,0.55)';
    ctx.fillRect(cx - cfg.perfectZone, by, cfg.perfectZone * 2, bh);
    ctx.fillStyle = '#e8e2cc';
    ctx.fillRect(cx - 1, by - 8, 2, bh + 16);

    strokeRect(ctx, bx, by, bw, bh, '#5e5546');

    // The sweeping marker.
    const mx = bx + (this.lockedAt !== null ? this.lockedAt : this.pos);
    ctx.fillStyle = this.done ? (this.result.perfect ? '#e2c45a' : '#c9502f') : '#d8d2bb';
    ctx.fillRect(mx - 3, by - 12, 6, bh + 24);
    ctx.fillStyle = '#15120e';
    ctx.fillRect(mx - 1, by - 12, 2, bh + 24);

    if (this.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.flash * 0.28).toFixed(3) + ')';
      ctx.fillRect(bx, by - 14, bw, bh + 28);
    }

    ctx.font = '15px ' + FONT;
    ctx.fillStyle = '#9c9382';
    ctx.textAlign = 'center';
    ctx.fillText('OFF CENTRE COSTS YOU ELEVATION', x + w / 2, by + bh + 30);
    ctx.textAlign = 'left';
  }
}

// --------------------------------------------------------------- FUSE

export class FuseStage extends Stage {
  constructor() {
    super(MINIGAMES.fuse);
    this.r = MINIGAMES.fuse.minR;
    this.lockedR = null;
  }
  start() {
    super.start();
    this.r = this.cfg.minR;
    this.lockedR = null;
  }
  update(dt) {
    if (this.done) {
      this.flash = Math.max(0, this.flash - dt * 3);
      return;
    }
    this.t += dt;
    const cfg = this.cfg;
    // Triangle wave between minR and maxR.
    const phase = (this.t * 1000 % cfg.cycleMs) / cfg.cycleMs;
    const tri = phase < 0.5 ? phase * 2 : 2 - phase * 2;
    this.r = cfg.minR + (cfg.maxR - cfg.minR) * tri;
    if (this.t > 9) this.press();
  }
  press() {
    if (this.done) return;
    const cfg = this.cfg;
    const err = Math.abs(this.r - cfg.targetR);
    this.lockedR = this.r;
    this.flash = 1;
    this.finish(cfg.quality(err), cfg.isPerfect(err), err);
  }
  draw(ctx, box) {
    const { x, y, w, h } = box;
    const cfg = this.cfg;
    panel(ctx, box, cfg.title, cfg.hint);

    const cx = x + w / 2;
    // At the top of its swing the ring reaches maxR, so the sight plus its
    // graticule arms is a good 210px tall. Centring it leaves just enough
    // clearance for the header above and the caption below.
    const cy = bodyMid(box) - 8;
    const arm = cfg.maxR + 10;
    const r = this.lockedR !== null ? this.lockedR : this.r;

    // Sight graticule.
    ctx.strokeStyle = '#3c362c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
    ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
    ctx.stroke();

    // Tolerance band around the target ring.
    ctx.strokeStyle = 'rgba(111,158,74,0.34)';
    ctx.lineWidth = cfg.goodZone * 2;
    ring(ctx, cx, cy, cfg.targetR);

    // The target ring itself.
    ctx.strokeStyle = '#e2c45a';
    ctx.lineWidth = 2;
    ring(ctx, cx, cy, cfg.targetR);
    ctx.strokeStyle = 'rgba(226,196,90,0.35)';
    ctx.lineWidth = 1;
    ring(ctx, cx, cy, cfg.targetR - cfg.perfectZone);
    ring(ctx, cx, cy, cfg.targetR + cfg.perfectZone);

    // The pulsing ring the player is trying to freeze.
    ctx.strokeStyle = this.done ? (this.result.perfect ? '#f6e6a2' : '#c9502f') : '#d8d2bb';
    ctx.lineWidth = 3;
    ring(ctx, cx, cy, r);

    if (this.flash > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (this.flash * 0.6).toFixed(3) + ')';
      ctx.lineWidth = 6;
      ring(ctx, cx, cy, r);
    }

    ctx.font = '15px ' + FONT;
    ctx.fillStyle = '#9c9382';
    ctx.textAlign = 'center';
    ctx.fillText('A TIGHT FUSE BURSTS ON PROXIMITY', cx, cy + cfg.maxR + 26);
    ctx.textAlign = 'left';
  }
}

function ring(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
  ctx.stroke();
}

function strokeRect(ctx, x, y, w, h, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function panel(ctx, box, title, hint) {
  const { x, y, w, h } = box;
  ctx.fillStyle = 'rgba(16,14,11,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#6b6152';
  ctx.lineWidth = 3;
  ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  ctx.strokeStyle = '#2c2820';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);

  ctx.textAlign = 'center';
  ctx.font = 'bold 26px ' + FONT;
  ctx.fillStyle = '#e2c45a';
  ctx.fillText(title, x + w / 2, y + 40);
  ctx.font = '14px ' + FONT;
  ctx.fillStyle = '#9c9382';
  ctx.fillText(hint, x + w / 2, y + 60);
  ctx.textAlign = 'left';
}

// ------------------------------------------------------------ chain

// Runs ram -> elevation -> fuse and collects the results.
export class LoadSequence {
  constructor() {
    this.stages = [new RamStage(), new ElevationStage(), new FuseStage()];
    this.index = 0;
    this.done = false;
    this.holdT = 0;
    this.results = {};
    this.perfects = {};
  }
  start() {
    this.index = 0;
    this.done = false;
    this.holdT = 0;
    this.results = {};
    this.perfects = {};
    this.stages.forEach((s) => { s.done = false; s.result = null; });
    this.stages[0].start();
  }
  get current() { return this.stages[this.index]; }
  update(dt) {
    if (this.done) return;
    const st = this.stages[this.index];
    st.update(dt);
    if (st.done) {
      // Let the player see the outcome for a beat before moving on.
      this.holdT += dt;
      if (this.holdT > 0.62) {
        this.results[st.cfg.id] = st.result;
        this.perfects[st.cfg.id] = st.result.perfect;
        this.holdT = 0;
        this.index++;
        if (this.index >= this.stages.length) {
          this.done = true;
        } else {
          this.stages[this.index].start();
        }
      }
    }
  }
  press() {
    if (this.done) return;
    this.stages[this.index].press();
  }
  draw(ctx, box) {
    if (this.done) return;
    this.stages[this.index].draw(ctx, box);
    // Stage pips. Three 22px pips on a 34px pitch are 90px of row, so the run
    // starts 45px left of centre rather than 34 -- otherwise the whole strip
    // sits visibly off to the right of the panel.
    const { x, y, w, h } = box;
    const pipY = y + h - 18;
    for (let i = 0; i < this.stages.length; i++) {
      const px = x + w / 2 - 45 + i * 34;
      const st = this.stages[i];
      ctx.fillStyle = i < this.index ? (this.perfects[st.cfg.id] ? '#e2c45a' : '#6f9e4a')
        : i === this.index ? '#d8d2bb' : '#4a4438';
      ctx.fillRect(px, pipY, 22, 6);
    }
  }
  // Timed-out turns fire a rushed round rather than skipping the turn.
  forceRushed() {
    const rushed = { quality: 0.3, perfect: false, raw: 0, sign: 1 };
    for (const st of this.stages) {
      if (!this.results[st.cfg.id]) {
        this.results[st.cfg.id] = st.result || rushed;
        this.perfects[st.cfg.id] = false;
      }
    }
    this.done = true;
  }
}
