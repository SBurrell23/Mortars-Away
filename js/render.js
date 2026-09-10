// All world and HUD drawing. Nothing here mutates game state.

import { WORLD_W, WORLD_H } from './maps.js';
import { windLabel, HP_MAX } from './balance.js';

export const UNIT_SCALE = 2;
// On-canvas fire control, so a mouse or a touchscreen alone can play.
export const FIRE_BTN = { x: 370, y: WORLD_H - 148, w: 168, h: 74 };
export const PROP_SCALE = 2;
export const TILE_SCALE = 2;

const FONT = '"Courier New", ui-monospace, monospace';
const INK = '#e8e2cc';
const INK_DIM = '#9c9382';
const GOLD = '#e2c45a';
const ALLIED = '#8fae5e';
const AXIS = '#9aa4ae';

export function teamColor(side) { return side === 0 ? ALLIED : AXIS; }

// Upscale a sprite canvas by an integer factor with no smoothing.
export function upscale(cv, factor) {
  if (!cv) return cv;
  const out = document.createElement('canvas');
  out.width = cv.width * factor;
  out.height = cv.height * factor;
  const c = out.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(cv, 0, 0, out.width, out.height);
  return out;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.time = 0;
  }

  resize() {
    const c = this.canvas;
    const rect = c.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    // Letterbox the 1280x720 playfield inside whatever the element is.
    this.scale = Math.min(w / WORLD_W, h / WORLD_H);
    this.offX = (w - WORLD_W * this.scale) / 2;
    this.offY = (h - WORLD_H * this.scale) / 2;
    this.ctx.imageSmoothingEnabled = false;
  }

  // Convert a DOM pointer event into playfield coordinates.
  toWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = (clientX - rect.left) * dpr;
    const py = (clientY - rect.top) * dpr;
    return {
      x: (px - this.offX) / this.scale,
      y: (py - this.offY) / this.scale,
    };
  }

  begin(shake) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#07080a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.offX + (shake ? shake.x : 0), this.offY + (shake ? shake.y : 0));
    ctx.scale(this.scale, this.scale);
    ctx.beginPath();
    ctx.rect(0, 0, WORLD_W, WORLD_H);
    ctx.clip();
  }

  end() {
    this.ctx.restore();
  }

  // ----------------------------------------------------------- world

  drawSky(map) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    g.addColorStop(0, map.sky[0]);
    g.addColorStop(0.55, map.sky[1]);
    g.addColorStop(1, map.sky[2]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  drawBackdrop(backdrop, sprites, map, dt) {
    const ctx = this.ctx;
    this.time += dt;

    // Distant ridges.
    for (const hl of backdrop.hills) {
      const img = sprites[hl.name];
      if (!img) continue;
      const s = 3.2;
      ctx.globalAlpha = 0.26 - hl.depth * 0.3;
      ctx.drawImage(img, hl.x, hl.y, img.width * s, img.height * s);
      ctx.globalAlpha = 1;
    }

    // Smoke columns on the horizon.
    const sc = sprites.smoke_column;
    if (sc) {
      for (const sm of backdrop.smoke) {
        const sway = Math.sin(this.time * 0.5 + sm.x) * 4;
        ctx.globalAlpha = 0.15;
        ctx.drawImage(sc, sm.x + sway, sm.y - sc.height * sm.scale * 2,
          sc.width * sm.scale * 2, sc.height * sm.scale * 2);
        ctx.globalAlpha = 1;
      }
    }

    // Clouds drift.
    for (const cl of backdrop.clouds) {
      const img = sprites[cl.name];
      if (!img) continue;
      cl.x += cl.speed * dt;
      if (cl.x > WORLD_W + 160) cl.x = -img.width * cl.scale - 40;
      ctx.globalAlpha = cl.alpha;
      ctx.drawImage(img, cl.x, cl.y, img.width * cl.scale, img.height * cl.scale);
      ctx.globalAlpha = 1;
    }

    // Haze that pushes the backdrop away from the playfield. A gradient, not a
    // band: a hard horizontal edge across the sky reads as a rendering bug.
    if (!this._fogCache || this._fogCache.key !== map.fog) {
      const fg = ctx.createLinearGradient(0, 250, 0, WORLD_H);
      fg.addColorStop(0, 'rgba(0,0,0,0)');
      fg.addColorStop(0.55, map.fog);
      fg.addColorStop(1, map.fog);
      this._fogCache = { key: map.fog, grad: fg };
    }
    ctx.fillStyle = this._fogCache.grad;
    ctx.fillRect(0, 250, WORLD_W, WORLD_H - 250);

    // Birds.
    const bd = sprites.bird_a;
    if (bd) {
      ctx.globalAlpha = 0.35;
      for (const b of backdrop.birds) {
        b.x += b.speed * dt;
        if (b.x > WORLD_W + 20) b.x = -20;
        if (b.x < -20) b.x = WORLD_W + 20;
        const bob = Math.sin(this.time * 2.2 + b.phase) * 6;
        ctx.drawImage(bd, b.x, b.y + bob, bd.width * 2, bd.height * 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawTerrain(terrain) {
    this.ctx.drawImage(terrain.surface, 0, 0);
    terrain.drawChunks(this.ctx);
  }

  // Open water, drawn over the terrain so island flanks fade into it instead
  // of reading as pillars over an abyss.
  drawWater(map, t) {
    if (!map.water) return;
    const ctx = this.ctx;
    const y = map.water;
    const cols = map.waterColor || ['rgba(38,104,128,0.62)', 'rgba(20,62,84,0.86)'];
    const g = ctx.createLinearGradient(0, y, 0, WORLD_H);
    g.addColorStop(0, cols[0]);
    g.addColorStop(1, cols[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, y, WORLD_W, WORLD_H - y);

    // A couple of slow swells so the surface is not a dead straight edge.
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#cfe6ec';
    for (let x = 0; x < WORLD_W; x += 4) {
      const h = Math.sin(x * 0.021 + t * 1.1) * 1.6 + Math.sin(x * 0.007 - t * 0.7) * 2.2;
      ctx.fillRect(x, y + h - 1, 3, 2);
    }
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 26; i++) {
      const sx = (i * 137 + Math.sin(t * 0.4 + i) * 30) % WORLD_W;
      const sy = y + 14 + ((i * 53) % Math.max(1, WORLD_H - y - 20));
      ctx.fillRect(sx, sy, 18, 1);
    }
    ctx.restore();
  }

  drawProps(props, sprites) {
    const ctx = this.ctx;
    for (const p of props) {
      const img = sprites[p.name];
      if (!img) continue;
      const w = img.width * PROP_SCALE, h = img.height * PROP_SCALE;
      ctx.save();
      if (p.flip) {
        ctx.translate(p.x + w / 2, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, -w / 2, p.y - h + 2, w, h);
      } else {
        ctx.drawImage(img, p.x - w / 2, p.y - h + 2, w, h);
      }
      ctx.restore();
    }
  }

  // ----------------------------------------------------------- units

  drawMortar(unit, sprites, opts) {
    const ctx = this.ctx;
    const side = unit.side;
    const facing = unit.facing; // 1 = aims right, -1 = aims left
    const baseName = side === 0 ? 'mortarBase_allied' : 'mortarBase_axis';
    const barrelName = side === 0 ? 'mortarBarrel_allied' : 'mortarBarrel_axis';
    const crewName = (side === 0 ? 'crew_allied_' : 'crew_axis_') + (unit.hitFlash > 0 ? 'hit' : 'idle');
    const base = sprites[baseName];
    const barrel = sprites[barrelName];
    const crew = sprites[crewName];

    const bx = unit.x, by = unit.y;

    // Contact shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(bx, by + 2, 30, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Crew stands behind the tube on the outboard side.
    if (crew) {
      const cw = crew.width * UNIT_SCALE, ch = crew.height * UNIT_SCALE;
      ctx.save();
      const cxp = bx - facing * 32;
      if (facing < 0) {
        ctx.translate(cxp + cw / 2, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(crew, -cw / 2, by - ch, cw, ch);
      } else {
        ctx.drawImage(crew, cxp - cw / 2, by - ch, cw, ch);
      }
      ctx.restore();
    }

    // Barrel pivots about pixel (3,4) of its sprite.
    if (barrel) {
      const pivotX = bx + facing * 2;
      const pivotY = by - 20;
      const bw = barrel.width * UNIT_SCALE, bh = barrel.height * UNIT_SCALE;
      const px = 3 * UNIT_SCALE, py = 4 * UNIT_SCALE;
      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.rotate((-unit.angle * Math.PI) / 180 * facing);
      ctx.scale(facing, 1);
      // Recoil kick along the barrel axis.
      const rec = unit.recoil || 0;
      ctx.translate(-rec * 9, 0);
      ctx.drawImage(barrel, -px, -py, bw, bh);
      ctx.restore();
      unit.muzzle = this.muzzlePoint(unit);
    }

    if (base) {
      const w = base.width * UNIT_SCALE, h = base.height * UNIT_SCALE;
      ctx.save();
      if (facing < 0) {
        ctx.translate(bx, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(base, -w / 2, by - h + 2, w, h);
      } else {
        ctx.drawImage(base, bx - w / 2, by - h + 2, w, h);
      }
      ctx.restore();
    }

    // Damage flash.
    if (unit.hitFlash > 0) {
      ctx.globalAlpha = Math.min(0.7, unit.hitFlash);
      ctx.fillStyle = '#ffd9a0';
      ctx.fillRect(bx - 30, by - 44, 60, 46);
      ctx.globalAlpha = 1;
    }

    if (opts && opts.marker) this.drawTurnMarker(bx, by - 74, teamColor(side));
    this.drawUnitHealth(unit);
  }

  muzzlePoint(unit) {
    const facing = unit.facing;
    const pivotX = unit.x + facing * 2;
    const pivotY = unit.y - 20;
    const len = 25 * UNIT_SCALE;
    const rad = (unit.angle * Math.PI) / 180;
    return {
      x: pivotX + Math.cos(rad) * len * facing,
      y: pivotY - Math.sin(rad) * len,
    };
  }

  drawUnitHealth(unit) {
    const ctx = this.ctx;
    const w = 56, h = 7;
    const x = unit.x - w / 2, y = unit.y - 62;
    ctx.fillStyle = 'rgba(10,9,7,0.8)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    const f = Math.max(0, unit.hp / HP_MAX);
    // The bar drains toward a trailing ghost so damage reads at a glance.
    const gf = Math.max(f, unit.hpGhost !== undefined ? unit.hpGhost / HP_MAX : f);
    ctx.fillStyle = 'rgba(190,60,40,0.75)';
    ctx.fillRect(x, y, w * gf, h);
    ctx.fillStyle = f > 0.55 ? '#7fae4e' : f > 0.28 ? '#d0a03a' : '#c9502f';
    ctx.fillRect(x, y, w * f, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  drawTurnMarker(x, y, color) {
    const ctx = this.ctx;
    const bob = Math.sin(this.time * 4) * 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + bob + 12);
    ctx.lineTo(x - 9, y + bob);
    ctx.lineTo(x + 9, y + bob);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ------------------------------------------------------- projectile

  drawShell(shell, sprites) {
    const ctx = this.ctx;
    const img = sprites[shell.sprite];
    const ang = Math.atan2(shell.vy, shell.vx) + Math.PI / 2;
    if (shell.y < 8) return; // handled by the off-screen indicator
    ctx.save();
    ctx.translate(shell.x, shell.y);
    ctx.rotate(ang);
    if (img) {
      const w = img.width * UNIT_SCALE, h = img.height * UNIT_SCALE;
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.fillStyle = '#c9c2ae';
      ctx.fillRect(-3, -8, 6, 16);
    }
    ctx.restore();

    // Proximity fuse halo, so the player can see what a good fuse bought them.
    if (shell.fuseRadius > 2) {
      ctx.strokeStyle = 'rgba(226,196,90,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(shell.x, shell.y, shell.fuseRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Arrow at the top of the screen tracking a shell that has arced out of view.
  drawOffscreenShell(shell) {
    if (shell.y >= 8) return;
    const ctx = this.ctx;
    const x = Math.max(16, Math.min(WORLD_W - 16, shell.x));
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(x, 6);
    ctx.lineTo(x - 9, 22);
    ctx.lineTo(x + 9, 22);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 12px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(-shell.y) + '', x, 36);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  drawTrail(points, alpha) {
    if (!points || points.length < 4) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(226,220,200,' + (alpha || 0.22).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // The short aiming ghost. Deliberately truncated so it hints at the line
  // without solving the shot for you.
  drawAimGhost(points) {
    if (!points || points.length < 4) return;
    const ctx = this.ctx;
    ctx.save();
    const n = points.length / 2;
    for (let i = 1; i < n; i++) {
      const a = 0.5 * (1 - i / n);
      ctx.fillStyle = 'rgba(232,226,204,' + a.toFixed(3) + ')';
      ctx.fillRect(points[i * 2] - 1.5, points[i * 2 + 1] - 1.5, 3, 3);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------- HUD

  drawHud(g, sprites) {
    const ctx = this.ctx;
    ctx.save();

    // Top banner.
    ctx.fillStyle = 'rgba(12,11,9,0.82)';
    ctx.fillRect(0, 0, WORLD_W, 62);
    ctx.fillStyle = 'rgba(120,110,90,0.35)';
    ctx.fillRect(0, 61, WORLD_W, 2);

    // Player plates.
    this.drawPlayerPlate(g.players[0], 16, 8, false, g.turnSide === 0);
    this.drawPlayerPlate(g.players[1], WORLD_W - 16, 8, true, g.turnSide === 1);

    // Centre: wind.
    this.drawWind(g.wind, g.maxWind, sprites, WORLD_W / 2, 30);

    // Turn timer bar under the banner.
    if (g.turnDeadline > 0) {
      const left = Math.max(0, g.turnRemaining / g.turnLength);
      const w = 300;
      ctx.fillStyle = 'rgba(10,9,7,0.85)';
      ctx.fillRect(WORLD_W / 2 - w / 2, 63, w, 6);
      ctx.fillStyle = left > 0.35 ? '#6f9e4a' : left > 0.15 ? '#d0a03a' : '#c9502f';
      ctx.fillRect(WORLD_W / 2 - w / 2, 63, w * left, 6);
    }

    ctx.restore();
  }

  drawPlayerPlate(p, x, y, rightAlign, active) {
    const ctx = this.ctx;
    const w = 268, h = 46;
    const px = rightAlign ? x - w : x;
    ctx.fillStyle = active ? 'rgba(46,42,32,0.95)' : 'rgba(22,20,16,0.85)';
    ctx.fillRect(px, y, w, h);
    ctx.strokeStyle = active ? GOLD : 'rgba(110,102,86,0.6)';
    ctx.lineWidth = active ? 2 : 1;
    ctx.strokeRect(px + 1, y + 1, w - 2, h - 2);

    ctx.fillStyle = teamColor(p.side);
    ctx.fillRect(px + 6, y + 6, 5, h - 12);

    ctx.font = 'bold 16px ' + FONT;
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    const name = p.name.length > 16 ? p.name.slice(0, 15) + '.' : p.name;
    ctx.fillText(name.toUpperCase(), px + 18, y + 20);

    // Health bar.
    const bw = w - 92, bx = px + 18, by = y + 28;
    ctx.fillStyle = 'rgba(8,7,6,0.9)';
    ctx.fillRect(bx, by, bw, 10);
    const f = Math.max(0, p.hp / HP_MAX);
    const gf = Math.max(f, (p.hpGhost || 0) / HP_MAX);
    ctx.fillStyle = 'rgba(190,60,40,0.7)';
    ctx.fillRect(bx, by, bw * gf, 10);
    ctx.fillStyle = f > 0.55 ? '#7fae4e' : f > 0.28 ? '#d0a03a' : '#c9502f';
    ctx.fillRect(bx, by, bw * f, 10);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 9);

    ctx.font = 'bold 18px ' + FONT;
    ctx.fillStyle = INK;
    ctx.textAlign = 'right';
    ctx.fillText(Math.max(0, Math.round(p.hp)) + '', px + w - 12, y + 38);
    ctx.textAlign = 'left';
  }

  drawWind(wind, maxWind, sprites, cx, cy) {
    const ctx = this.ctx;
    const lab = windLabel(wind);
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px ' + FONT;
    ctx.fillStyle = INK_DIM;
    ctx.fillText('WIND', cx, cy - 12);

    // Arrow whose length tracks strength.
    const dir = wind >= 0 ? 1 : -1;
    const len = 22 + Math.min(1, Math.abs(wind) / (maxWind || 1)) * 58;
    const y = cy + 4;
    ctx.strokeStyle = Math.abs(wind) > 0.6 ? '#c9502f' : Math.abs(wind) > 0.3 ? GOLD : INK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - (dir * len) / 2, y);
    ctx.lineTo(cx + (dir * len) / 2, y);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.moveTo(cx + (dir * len) / 2 + dir * 9, y);
    ctx.lineTo(cx + (dir * len) / 2 - dir * 3, y - 6);
    ctx.lineTo(cx + (dir * len) / 2 - dir * 3, y + 6);
    ctx.closePath();
    ctx.fill();

    ctx.font = 'bold 14px ' + FONT;
    ctx.fillStyle = INK;
    ctx.fillText(lab.word + (lab.dir ? ' ' + lab.dir : '') + '  ' + lab.kph, cx, cy + 26);
    ctx.textAlign = 'left';
  }

  // Bottom-left gunner's panel: shell in the tube, elevation, charge.
  drawGunPanel(g, sprites) {
    const ctx = this.ctx;
    const w = 340, h = 132;
    const x = 16, y = WORLD_H - h - 16;

    ctx.fillStyle = 'rgba(14,13,10,0.9)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(120,110,90,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

    const shell = g.currentShell;
    ctx.font = 'bold 15px ' + FONT;
    ctx.fillStyle = INK_DIM;
    ctx.fillText('IN THE TUBE', x + 14, y + 24);

    ctx.font = 'bold 21px ' + FONT;
    ctx.fillStyle = GOLD;
    ctx.fillText(shell ? shell.name.toUpperCase() : '-', x + 14, y + 48);

    ctx.font = '13px ' + FONT;
    ctx.fillStyle = INK_DIM;
    ctx.fillText(shell ? shell.mass.toFixed(2) + ' MASS' : '', x + 14, y + 66);

    // Weight / drift / blast pips give the tradeoff at a glance.
    if (shell) {
      this.drawPips(x + 130, y + 58, 'REACH', shell.velMult, 0.7, 1.3);
      this.drawPips(x + 130, y + 76, 'DRIFT', shell.windDrift, 0.3, 2.3);
      this.drawPips(x + 130, y + 94, 'BLAST', shell.falloff, 50, 150);
    }

    // Spotting report from this gun's previous round.
    const lr = g.players[g.turnSide].lastRange;
    if (lr) {
      ctx.font = '12px ' + FONT;
      ctx.fillStyle = INK_DIM;
      ctx.fillText('LAST ROUND', x + 130, y + 24);
      ctx.font = 'bold 16px ' + FONT;
      ctx.fillStyle = lr.word === 'ON' ? '#7fae4e' : lr.word === 'LONG' ? '#e8734a' : '#6fa0c9';
      ctx.fillText(lr.word === 'ON' ? 'ON TARGET' : Math.abs(lr.err) + ' ' + lr.word,
        x + 130, y + 43);
    }

    // Angle and power readouts.
    ctx.font = 'bold 15px ' + FONT;
    ctx.fillStyle = INK_DIM;
    ctx.fillText('ELEV', x + 14, y + 92);
    ctx.font = 'bold 22px ' + FONT;
    ctx.fillStyle = INK;
    ctx.fillText(g.aimAngle.toFixed(1) + '°', x + 14, y + 114);

    // Power meter.
    const pw = 300, px = x + 14, py = y + h - 12;
    ctx.fillStyle = 'rgba(8,7,6,0.9)';
    ctx.fillRect(px, py - 6, pw, 7);
    const pf = (g.aimPower - 0.35) / 0.65;
    const grd = ctx.createLinearGradient(px, 0, px + pw, 0);
    grd.addColorStop(0, '#5e7a3c');
    grd.addColorStop(0.6, '#d0a03a');
    grd.addColorStop(1, '#c9502f');
    ctx.fillStyle = grd;
    ctx.fillRect(px, py - 6, pw * pf, 7);
    ctx.fillStyle = INK;
    ctx.fillRect(px + pw * pf - 1, py - 11, 3, 17);

    this.drawFireButton();
  }

  drawFireButton() {
    const ctx = this.ctx;
    const b = FIRE_BTN;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.4);
    ctx.fillStyle = 'rgba(70,58,22,0.95)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.strokeStyle = 'rgba(226,196,90,' + (0.55 + pulse * 0.45).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    ctx.textAlign = 'center';
    ctx.font = 'bold 26px ' + FONT;
    ctx.fillStyle = GOLD;
    ctx.fillText('LOAD', b.x + b.w / 2, b.y + 34);
    ctx.font = '12px ' + FONT;
    ctx.fillStyle = INK_DIM;
    ctx.fillText('SPACE / CLICK', b.x + b.w / 2, b.y + 56);
    ctx.textAlign = 'left';
  }

  drawPips(x, y, label, value, lo, hi) {
    const ctx = this.ctx;
    ctx.font = '11px ' + FONT;
    ctx.fillStyle = INK_DIM;
    ctx.fillText(label, x, y + 8);
    const n = 6;
    const f = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i / n < f ? GOLD : 'rgba(90,84,70,0.7)';
      ctx.fillRect(x + 52 + i * 13, y, 10, 9);
    }
  }

  // The enemy crew's loading stages, revealed one at a time.
  drawAiLoad(a, name) {
    const ctx = this.ctx;
    const w = 460, h = 208;
    const x = WORLD_W / 2 - w / 2, y = WORLD_H / 2 - h / 2 - 30;

    ctx.fillStyle = 'rgba(16,14,11,0.92)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#6b6152';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.strokeStyle = '#2c2820';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);

    ctx.textAlign = 'center';
    ctx.font = 'bold 21px ' + FONT;
    ctx.fillStyle = GOLD;
    ctx.fillText(name.toUpperCase() + ' IS LOADING', x + w / 2, y + 40);

    ctx.textAlign = 'left';
    for (let i = 0; i < a.stages.length; i++) {
      const st = a.stages[i];
      const ry = y + 68 + i * 38;
      const shown = i < a.revealed;

      ctx.font = '15px ' + FONT;
      ctx.fillStyle = shown ? INK : '#4a4438';
      ctx.fillText(st.title, x + 34, ry + 15);

      // Quality bar.
      const bx = x + 236, bw = 130;
      ctx.fillStyle = '#15120e';
      ctx.fillRect(bx, ry + 3, bw, 14);
      if (shown) {
        ctx.fillStyle = st.perfect ? '#e2c45a'
          : st.q >= 0.85 ? '#7fae4e' : st.q >= 0.55 ? '#d0a03a' : '#c9502f';
        ctx.fillRect(bx + 1, ry + 4, (bw - 2) * st.q, 12);
      }
      ctx.strokeStyle = '#5e5546';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, ry + 3.5, bw - 1, 13);

      if (shown) {
        ctx.font = 'bold 13px ' + FONT;
        ctx.fillStyle = st.perfect ? '#e2c45a' : INK_DIM;
        ctx.textAlign = 'right';
        ctx.fillText(st.perfect ? 'PERFECT' : st.q >= 0.85 ? 'GOOD'
          : st.q >= 0.55 ? 'FAIR' : st.q >= 0.25 ? 'POOR' : 'FUMBLED',
          x + w - 30, ry + 15);
        ctx.textAlign = 'left';
      }
    }
    ctx.textAlign = 'left';
  }

  drawBanner(text, sub, color) {
    const ctx = this.ctx;
    const y = WORLD_H / 2 - 70;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(10,9,7,0.72)';
    ctx.fillRect(0, y - 8, WORLD_W, sub ? 96 : 64);
    ctx.fillStyle = color || GOLD;
    ctx.font = 'bold 46px ' + FONT;
    ctx.fillText(text, WORLD_W / 2, y + 42);
    if (sub) {
      ctx.font = '18px ' + FONT;
      ctx.fillStyle = INK_DIM;
      ctx.fillText(sub, WORLD_W / 2, y + 72);
    }
    ctx.restore();
  }

  drawToast(text, color) {
    const ctx = this.ctx;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px ' + FONT;
    ctx.fillStyle = 'rgba(10,9,7,0.8)';
    const w = ctx.measureText(text).width + 40;
    ctx.fillRect(WORLD_W / 2 - w / 2, 86, w, 38);
    ctx.strokeStyle = color || GOLD;
    ctx.lineWidth = 2;
    ctx.strokeRect(WORLD_W / 2 - w / 2 + 1, 87, w - 2, 36);
    ctx.fillStyle = color || GOLD;
    ctx.fillText(text, WORLD_W / 2, 112);
    ctx.restore();
  }

  drawVignette() {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.36,
      WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.92);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  drawScanlines() {
    if (this.scanlines === false) return;
    const ctx = this.ctx;
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000';
    for (let y = 0; y < WORLD_H; y += 3) ctx.fillRect(0, y, WORLD_W, 1);
    ctx.globalAlpha = 1;
  }
}
