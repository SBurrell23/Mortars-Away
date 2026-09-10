// Particles, screen shake and floating text. Purely cosmetic: nothing in here
// feeds back into the simulation, so it never has to agree between peers.

export class Effects {
  constructor(worldW, worldH) {
    this.w = worldW;
    this.h = worldH;
    this.parts = [];
    this.texts = [];
    this.rings = [];
    this.booms = [];
    this.shake = 0;
    this.shakeDecay = 3.4;
    this.flash = 0;
    this.flashColor = '255,240,200';
    this.smokeMarks = [];
  }

  clear() {
    this.parts.length = 0;
    this.texts.length = 0;
    this.rings.length = 0;
    this.booms.length = 0;
    this.smokeMarks.length = 0;
    this.shake = 0;
    this.flash = 0;
  }

  addShake(amount) {
    this.shake = Math.min(46, this.shake + amount);
  }

  addFlash(amount, color) {
    this.flash = Math.min(1, this.flash + amount);
    if (color) this.flashColor = color;
  }

  text(x, y, str, color, opts) {
    const o = opts || {};
    this.texts.push({
      x, y, str,
      color: color || '#e8e2cc',
      life: o.life || 1.5,
      maxLife: o.life || 1.5,
      vy: o.vy !== undefined ? o.vy : -34,
      size: o.size || 20,
      bold: o.bold !== false,
      shadow: o.shadow !== false,
    });
  }

  particle(p) {
    if (this.parts.length > 1400) this.parts.shift();
    this.parts.push(p);
  }

  // ------------------------------------------------------- set pieces

  muzzleBlast(x, y, dirX, dirY, mass) {
    const n = Math.round(18 + mass * 14);
    for (let i = 0; i < n; i++) {
      const spread = (Math.random() - 0.5) * 0.9;
      const sp = 90 + Math.random() * 240 * mass;
      const cs = Math.cos(spread), sn = Math.sin(spread);
      const vx = (dirX * cs - dirY * sn) * sp;
      const vy = (dirX * sn + dirY * cs) * sp;
      this.particle({
        x, y, vx, vy,
        life: 0.3 + Math.random() * 0.6,
        maxLife: 0.9,
        r: 2 + Math.random() * 4,
        grav: 40,
        drag: 1.9,
        kind: 'smoke',
        hue: 40,
      });
    }
    for (let i = 0; i < 14; i++) {
      const spread = (Math.random() - 0.5) * 0.45;
      const sp = 260 + Math.random() * 420;
      const cs = Math.cos(spread), sn = Math.sin(spread);
      this.particle({
        x, y,
        vx: (dirX * cs - dirY * sn) * sp,
        vy: (dirX * sn + dirY * cs) * sp,
        life: 0.08 + Math.random() * 0.16,
        maxLife: 0.24,
        r: 1 + Math.random() * 2.5,
        grav: 0,
        drag: 3.5,
        kind: 'spark',
      });
    }
    this.addShake(3 + mass * 3);
    this.addFlash(0.1 + mass * 0.05, '255,214,140');
  }

  trailPuff(x, y, mass) {
    this.particle({
      x: x + (Math.random() - 0.5) * 3,
      y: y + (Math.random() - 0.5) * 3,
      vx: (Math.random() - 0.5) * 14,
      vy: (Math.random() - 0.5) * 14 - 6,
      life: 0.45 + Math.random() * 0.5,
      maxLife: 0.95,
      r: 1.6 + Math.random() * 2.2 * mass,
      grav: -6,
      drag: 1.1,
      kind: 'smoke',
      hue: 30,
      alpha: 0.5,
    });
  }

  // The main event. `power` scales with shell mass.
  explode(x, y, radius, power, airburst) {
    const p = Math.max(0.4, power);

    this.rings.push({ x, y, r: radius * 0.3, max: radius * 3.4, life: 0.42, maxLife: 0.42, w: 5 });
    this.rings.push({ x, y, r: radius * 0.1, max: radius * 1.7, life: 0.26, maxLife: 0.26, w: 9 });

    this.booms.push({
      x, y, t: 0,
      dur: 0.44 + p * 0.1,
      scale: (radius / 30) * (airburst ? 1.15 : 1),
    });

    // Fireball core.
    const fireN = Math.round(30 + p * 34);
    for (let i = 0; i < fireN; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 300) * p;
      this.particle({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.85 - 40,
        life: 0.16 + Math.random() * 0.34,
        maxLife: 0.5,
        r: 3 + Math.random() * 9 * p,
        grav: -30,
        drag: 2.6,
        kind: 'fire',
      });
    }

    // Dirt and rock thrown out. Airbursts throw far less.
    const dirtN = Math.round((airburst ? 16 : 52) + p * 30);
    for (let i = 0; i < dirtN; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * (airburst ? 3.0 : 2.2);
      const sp = (110 + Math.random() * 430) * Math.sqrt(p);
      this.particle({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.7 + Math.random() * 1.5,
        maxLife: 2.2,
        r: 1 + Math.random() * 3.4,
        grav: 620,
        drag: 0.28,
        kind: 'dirt',
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * 6.28,
      });
    }

    // Sparks.
    for (let i = 0; i < Math.round(24 * p); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 200 + Math.random() * 620;
      this.particle({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 60,
        life: 0.12 + Math.random() * 0.3,
        maxLife: 0.42,
        r: 1 + Math.random() * 1.8,
        grav: 500,
        drag: 1.2,
        kind: 'spark',
      });
    }

    // Rolling smoke that lingers over the crater.
    for (let i = 0; i < Math.round(20 + p * 18); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 20 + Math.random() * 110 * p;
      this.particle({
        x: x + (Math.random() - 0.5) * radius,
        y: y + (Math.random() - 0.5) * radius * 0.6,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.5 - 26,
        life: 1.1 + Math.random() * 2.0,
        maxLife: 3.1,
        r: 6 + Math.random() * 16 * p,
        grav: -14,
        drag: 0.9,
        kind: 'smoke',
        hue: 12,
        alpha: 0.55,
      });
    }

    this.addShake(9 + p * 15);
    this.addFlash(Math.min(0.85, 0.28 + p * 0.2), '255,232,178');

    if (!airburst) {
      this.smokeMarks.push({ x, y, r: radius * 1.4, life: 9, maxLife: 9 });
    }
  }

  // Dirt kicked up where a dud round buries itself.
  thud(x, y) {
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
      const sp = 50 + Math.random() * 160;
      this.particle({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: 0.4 + Math.random() * 0.7,
        maxLife: 1.1,
        r: 1 + Math.random() * 2.4,
        grav: 620,
        drag: 0.4,
        kind: 'dirt',
        spin: (Math.random() - 0.5) * 8,
        rot: 0,
      });
    }
    this.addShake(3);
  }

  // Dust puff when collapsing ground lands.
  collapse(x, y, count) {
    for (let i = 0; i < count; i++) {
      this.particle({
        x: x + (Math.random() - 0.5) * 30,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 60,
        vy: -Math.random() * 40,
        life: 0.5 + Math.random() * 0.9,
        maxLife: 1.4,
        r: 3 + Math.random() * 7,
        grav: -10,
        drag: 1.3,
        kind: 'smoke',
        hue: 26,
        alpha: 0.4,
      });
    }
  }

  // ---------------------------------------------------------- update

  update(dt) {
    const parts = this.parts;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.vy += (p.grav || 0) * dt;
      if (p.drag) {
        const d = 1 - Math.min(0.95, p.drag * dt);
        p.vx *= d; p.vy *= d;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.spin) p.rot += p.spin * dt;
      // Dirt bounces off the bottom of the world instead of vanishing.
      if (p.kind === 'dirt' && p.y > this.h + 30) { parts.splice(i, 1); }
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= 1 - Math.min(0.9, 1.6 * dt);
      if (t.life <= 0) this.texts.splice(i, 1);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const k = 1 - r.life / r.maxLife;
      r.r = r.max * (1 - Math.pow(1 - k, 2.4));
      if (r.life <= 0) this.rings.splice(i, 1);
    }

    for (let i = this.booms.length - 1; i >= 0; i--) {
      this.booms[i].t += dt;
      if (this.booms[i].t >= this.booms[i].dur) this.booms.splice(i, 1);
    }

    for (let i = this.smokeMarks.length - 1; i >= 0; i--) {
      this.smokeMarks[i].life -= dt;
      if (this.smokeMarks[i].life <= 0) this.smokeMarks.splice(i, 1);
    }

    this.shake = Math.max(0, this.shake - this.shake * this.shakeDecay * dt - 1.2 * dt);
    this.flash = Math.max(0, this.flash - this.flash * 6 * dt - 0.25 * dt);
  }

  shakeOffset() {
    if (this.shakeEnabled === false) return { x: 0, y: 0 };
    if (this.shake < 0.2) return { x: 0, y: 0 };
    const s = this.shake;
    return {
      x: (Math.random() - 0.5) * s,
      y: (Math.random() - 0.5) * s * 0.7,
    };
  }

  // ------------------------------------------------------------ draw

  // Smoke that hangs over craters, drawn under the units.
  drawGroundSmoke(ctx) {
    for (const s of this.smokeMarks) {
      const a = Math.min(0.34, (s.life / s.maxLife) * 0.34);
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, 'rgba(40,36,32,' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(40,36,32,0)');
      ctx.fillStyle = g;
      ctx.fillRect(s.x - s.r, s.y - s.r, s.r * 2, s.r * 2);
    }
  }

  draw(ctx, boomFrames) {
    ctx.save();

    // Shockwave rings.
    for (const r of this.rings) {
      const a = Math.max(0, r.life / r.maxLife);
      ctx.strokeStyle = 'rgba(255,238,200,' + (a * 0.55).toFixed(3) + ')';
      ctx.lineWidth = r.w * a;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, r.r), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Particles, back to front by kind.
    for (const p of this.parts) {
      const k = p.life / p.maxLife;
      if (p.kind === 'smoke') {
        const a = Math.min(1, k * (p.alpha !== undefined ? p.alpha : 0.6));
        const size = p.r * (2.1 - k * 1.1);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
        const c = p.hue > 30 ? '92,84,72' : '58,54,50';
        g.addColorStop(0, 'rgba(' + c + ',' + a.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + c + ',0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
      } else if (p.kind === 'fire') {
        const a = Math.min(1, k * 1.1);
        const size = p.r * (0.5 + k);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, size);
        g.addColorStop(0, 'rgba(255,248,214,' + a.toFixed(3) + ')');
        g.addColorStop(0.4, 'rgba(255,176,52,' + (a * 0.9).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(180,44,16,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - size, p.y - size, size * 2, size * 2);
      } else if (p.kind === 'spark') {
        ctx.fillStyle = 'rgba(255,' + Math.round(190 + 60 * k) + ',' + Math.round(90 + 90 * k) + ',' + k.toFixed(3) + ')';
        const l = Math.max(1.5, Math.hypot(p.vx, p.vy) * 0.012);
        ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r + l * 0.3, p.r);
      } else {
        // dirt
        const shade = 40 + Math.floor(k * 26);
        ctx.fillStyle = 'rgb(' + (shade + 26) + ',' + (shade + 12) + ',' + shade + ')';
        const s = p.r;
        if (p.rot) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-s, -s * 0.7, s * 2, s * 1.4);
          ctx.restore();
        } else {
          ctx.fillRect(p.x - s, p.y - s, s * 2, s * 2);
        }
      }
    }

    // Sprite-based fireballs on top of the particle soup.
    if (boomFrames && boomFrames.length) {
      for (const b of this.booms) {
        const f = Math.min(boomFrames.length - 1, Math.floor((b.t / b.dur) * boomFrames.length));
        const img = boomFrames[f];
        if (!img) continue;
        const s = b.scale * (1 + (b.t / b.dur) * 0.5);
        const w = img.width * s, h = img.height * s;
        ctx.globalAlpha = Math.max(0, 1 - Math.pow(b.t / b.dur, 2.4));
        ctx.drawImage(img, b.x - w / 2, b.y - h / 2, w, h);
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
  }

  drawTexts(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const a = Math.min(1, t.life / (t.maxLife * 0.4));
      ctx.globalAlpha = a;
      ctx.font = (t.bold ? 'bold ' : '') + t.size + 'px "Courier New", ui-monospace, monospace';
      if (t.shadow) {
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillText(t.str, t.x + 2, t.y + 2);
      }
      ctx.fillStyle = t.color;
      ctx.fillText(t.str, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.restore();
  }

  drawFlash(ctx, w, h) {
    if (this.flash <= 0.002) return;
    ctx.fillStyle = 'rgba(' + this.flashColor + ',' + (this.flash * 0.6).toFixed(3) + ')';
    ctx.fillRect(0, 0, w, h);
  }
}
