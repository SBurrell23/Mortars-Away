// Destructible per-pixel terrain, Worms-style.
//
// Three parallel representations:
//   mask     Uint8Array, 1 byte per pixel. 0 = air, 1 = solid. This is the
//            authoritative collision data and the thing both peers must agree on.
//   texture  an offscreen canvas painted once with the map's material layers,
//            as if the ground were completely solid. Never mutated except by
//            permanent scorch marks.
//   surface  the canvas we actually draw. Equals `texture` wherever mask is
//            solid, transparent elsewhere. Rebuilt only inside dirty rects.

const FALLBACK_COLORS = {
  grass: ['#2e4020', '#26361b', '#1d2a15'],
  dirt: ['#5a4433', '#4c3a2b', '#413124'],
  clay: ['#6b4230', '#5b3828', '#4d2f22'],
  rock: ['#4a4a52', '#3e3e46', '#33333a'],
  snow: ['#c3ccd6', '#aab4c0', '#8f99a6'],
  sand: ['#c2a86a', '#ab935a', '#937e4c'],
  ash: ['#3b3a3a', '#323131', '#292828'],
  mud: ['#463527', '#3b2d21', '#31251b'],
};

// Depth in pixels below the surface at which each successive layer starts.
const LAYER_DEPTHS = [0, 18, 96, 250];

export class Terrain {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.mask = new Uint8Array(width * height);
    this.version = 0; // bumped on every destructive edit, used in desync checks

    this.texture = document.createElement('canvas');
    this.texture.width = width;
    this.texture.height = height;
    this.texCtx = this.texture.getContext('2d', { willReadFrequently: true });

    this.surface = document.createElement('canvas');
    this.surface.width = width;
    this.surface.height = height;
    this.surCtx = this.surface.getContext('2d', { willReadFrequently: true });

    this.chunks = []; // falling debris clusters awaiting settle
  }

  // ------------------------------------------------------------- build

  // heightFn(x) -> surface y for that column. layers is an array of tile names,
  // outermost first. tiles is { name: canvas } or null for flat colours.
  build(heightFn, layers, tiles, rng) {
    const { w, h, mask } = this;
    const heights = new Int32Array(w);
    for (let x = 0; x < w; x++) {
      heights[x] = Math.max(0, Math.min(h, Math.round(heightFn(x))));
    }
    this.heights = heights;

    for (let x = 0; x < w; x++) {
      const top = heights[x];
      for (let y = top; y < h; y++) mask[y * w + x] = 1;
    }

    this.paintTexture(layers, tiles, rng);
    this.rebuild(0, 0, w, h);
    return this;
  }

  paintTexture(layers, tiles, rng) {
    const { w, h, texCtx, heights } = this;
    // Start with the deepest layer everywhere so cavities reveal bedrock.
    const deepest = layers[layers.length - 1];
    this.fillWithTile(texCtx, 0, 0, w, h, deepest, tiles, rng, 0, 0);

    // Then paint each shallower layer down to its depth band. Each layer gets
    // its own pattern offset so the 32px grids never line up with each other.
    for (let li = layers.length - 2; li >= 0; li--) {
      const name = layers[li];
      const maxDepth = LAYER_DEPTHS[li + 1] !== undefined ? LAYER_DEPTHS[li + 1] : 60;
      const band = document.createElement('canvas');
      band.width = w; band.height = h;
      const bctx = band.getContext('2d');
      this.fillWithTile(bctx, 0, 0, w, h, name, tiles, rng, (li * 11) % 32, (li * 19) % 32);
      // Knock out everything below the band using destination-in with a path.
      bctx.globalCompositeOperation = 'destination-in';
      bctx.fillStyle = '#fff';
      bctx.beginPath();
      bctx.moveTo(0, 0);
      // Wobble scales with band depth so the thin topsoil layer stays intact.
      const wobAmp = Math.min(11, maxDepth * 0.28);
      for (let x = 0; x < w; x++) {
        const wob = (Math.sin(x * 0.031) * 0.4 + Math.sin(x * 0.0083 + 2.1) * 0.6) * wobAmp;
        bctx.lineTo(x, heights[x] + maxDepth + wob);
      }
      bctx.lineTo(w, 0);
      bctx.closePath();
      bctx.fill();
      texCtx.drawImage(band, 0, 0);
    }

    // Break up the tile grid. A 32px repeat is very legible to the eye, so a
    // low-frequency wash of light and dark blotches is laid over the whole
    // texture; it is the single biggest thing standing between this and
    // looking like wallpaper.
    texCtx.globalCompositeOperation = 'source-over';
    this.mottle(texCtx, w, h, rng);

    // Subtle vertical shading: deeper ground reads darker.
    const grad = texCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0.13)');
    grad.addColorStop(1, 'rgba(0,0,0,0.26)');
    texCtx.fillStyle = grad;
    texCtx.fillRect(0, 0, w, h);
  }

  mottle(ctx, w, h, rng) {
    const r = rng || { float: Math.random, bool: () => Math.random() < 0.5 };
    // Two octaves: broad tonal drift, then tighter blotches.
    const passes = [
      { count: 90, min: 150, max: 380, alpha: 0.13 },
      { count: 260, min: 34, max: 130, alpha: 0.10 },
    ];
    for (const pass of passes) {
      for (let i = 0; i < pass.count; i++) {
        const x = r.float() * w;
        const y = r.float() * h;
        const rad = pass.min + r.float() * (pass.max - pass.min);
        const a = (0.25 + r.float() * 0.75) * pass.alpha;
        const dark = r.float() < 0.55;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, dark
          ? 'rgba(12,9,6,' + a.toFixed(3) + ')'
          : 'rgba(226,206,168,' + (a * 0.62).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
    }
  }

  fillWithTile(ctx, x, y, w, h, name, tiles, rng, offX, offY) {
    const tile = tiles && tiles[name];
    if (tile) {
      const pat = ctx.createPattern(tile, 'repeat');
      ctx.save();
      ctx.translate(offX || 0, offY || 0);
      ctx.fillStyle = pat;
      ctx.fillRect(x - (offX || 0), y - (offY || 0), w + 64, h + 64);
      ctx.restore();
      return;
    }
    const cols = FALLBACK_COLORS[name] || FALLBACK_COLORS.dirt;
    ctx.fillStyle = cols[0];
    ctx.fillRect(x, y, w, h);
    // Cheap dithered noise so flat colour does not look like a bug.
    const r = rng || { float: Math.random };
    for (let i = 0; i < (w * h) / 26; i++) {
      const px = x + Math.floor(r.float() * w);
      const py = y + Math.floor(r.float() * h);
      ctx.fillStyle = cols[1 + Math.floor(r.float() * (cols.length - 1))];
      ctx.fillRect(px, py, 2, 2);
    }
  }

  // ------------------------------------------------------- queries

  solidAt(x, y) {
    const xi = x | 0, yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return false;
    return this.mask[yi * this.w + xi] === 1;
  }

  // Topmost solid pixel in a column, or this.h if the column is empty.
  columnTop(x, fromY = 0) {
    const xi = x | 0;
    if (xi < 0 || xi >= this.w) return this.h;
    const { w, h, mask } = this;
    for (let y = Math.max(0, fromY | 0); y < h; y++) {
      if (mask[y * w + xi] === 1) return y;
    }
    return h;
  }

  // Average ground height across a footprint, used to seat units flatly.
  groundLevel(x, halfWidth) {
    let sum = 0, n = 0;
    for (let i = -halfWidth; i <= halfWidth; i++) {
      const t = this.columnTop(x + i);
      if (t < this.h) { sum += t; n++; }
    }
    return n ? sum / n : this.h;
  }

  // ------------------------------------------------------ destruction

  // Carve a circular crater. Returns the dirty rect that was repainted.
  // Deterministic: integer maths only, no RNG.
  destroy(cx, cy, radius) {
    const { w, h, mask } = this;
    const r = Math.max(1, radius | 0);
    const x0 = Math.max(0, (cx | 0) - r - 3);
    const x1 = Math.min(w - 1, (cx | 0) + r + 3);
    const y0 = Math.max(0, (cy | 0) - r - 3);
    const y1 = Math.min(h - 1, (cy | 0) + r + 3);
    const r2 = r * r;
    let removed = 0;
    for (let y = y0; y <= y1; y++) {
      const dy = y - (cy | 0);
      const dy2 = dy * dy;
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const dx = x - (cx | 0);
        if (dx * dx + dy2 <= r2) {
          if (mask[row + x]) { mask[row + x] = 0; removed++; }
        }
      }
    }
    this.scorch(cx, cy, r);
    this.rebuild(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    this.version++;
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, removed };
  }

  // Permanent blackening painted into the texture around a crater rim.
  scorch(cx, cy, r) {
    const c = this.texCtx;
    c.save();
    c.globalCompositeOperation = 'source-over';
    const g = c.createRadialGradient(cx, cy, r * 0.55, cx, cy, r * 1.75);
    g.addColorStop(0, 'rgba(14,10,8,0.85)');
    g.addColorStop(0.5, 'rgba(24,17,12,0.45)');
    g.addColorStop(1, 'rgba(24,17,12,0)');
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, r * 1.75, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  // Re-derive `surface` from `texture` + `mask` inside a rect.
  rebuild(rx, ry, rw, rh) {
    rx = Math.max(0, rx | 0); ry = Math.max(0, ry | 0);
    rw = Math.min(this.w - rx, rw | 0); rh = Math.min(this.h - ry, rh | 0);
    if (rw <= 0 || rh <= 0) return;
    const src = this.texCtx.getImageData(rx, ry, rw, rh);
    const d = src.data;
    const { w, mask } = this;
    for (let y = 0; y < rh; y++) {
      const mrow = (ry + y) * w + rx;
      const drow = y * rw;
      for (let x = 0; x < rw; x++) {
        if (mask[mrow + x] === 0) d[(drow + x) * 4 + 3] = 0;
      }
    }
    this.surCtx.putImageData(src, rx, ry);
  }

  // Stamp solid pixels back in (used when falling debris lands).
  addPixels(pixels, ox, oy) {
    const { w, h, mask } = this;
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (let i = 0; i < pixels.length; i += 2) {
      const x = pixels[i] + ox, y = pixels[i + 1] + oy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      mask[y * w + x] = 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (maxX >= minX) this.rebuild(minX, minY, maxX - minX + 1, maxY - minY + 1);
    this.version++;
  }

  // --------------------------------------------------- collapse pass
  //
  // After a crater, find solid clusters near it that are no longer connected
  // to the main body of terrain and hand them back as falling debris.
  // The search is confined to a box around the crater so cost stays bounded.

  findLooseChunks(cx, cy, radius) {
    const pad = Math.max(70, radius + 40);
    const bx0 = Math.max(0, (cx - radius - pad) | 0);
    const bx1 = Math.min(this.w - 1, (cx + radius + pad) | 0);
    const by0 = Math.max(0, (cy - radius - pad) | 0);
    const by1 = Math.min(this.h - 1, (cy + radius + pad) | 0);
    const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
    if (bw <= 0 || bh <= 0) return [];

    const { w, mask } = this;
    const seen = new Uint8Array(bw * bh);
    const chunks = [];
    const stack = new Int32Array(bw * bh);

    for (let ly = 0; ly < bh; ly++) {
      for (let lx = 0; lx < bw; lx++) {
        const li = ly * bw + lx;
        if (seen[li]) continue;
        if (mask[(by0 + ly) * w + bx0 + lx] === 0) { seen[li] = 1; continue; }

        // Flood fill this cluster inside the box.
        let sp = 0;
        stack[sp++] = li;
        seen[li] = 1;
        const cells = [];
        let anchored = false;
        while (sp > 0) {
          const ci = stack[--sp];
          const cxl = ci % bw, cyl = (ci / bw) | 0;
          cells.push(ci);
          // Touching the box edge means it may continue into terrain we did
          // not scan, so treat it as connected to the world.
          if (cxl === 0 || cxl === bw - 1 || cyl === bh - 1) anchored = true;
          if (by0 + cyl >= this.h - 1) anchored = true;
          if (cells.length > 90000) { anchored = true; break; }
          const nb = [
            cxl > 0 ? ci - 1 : -1,
            cxl < bw - 1 ? ci + 1 : -1,
            cyl > 0 ? ci - bw : -1,
            cyl < bh - 1 ? ci + bw : -1,
          ];
          for (let k = 0; k < 4; k++) {
            const ni = nb[k];
            if (ni < 0 || seen[ni]) continue;
            const nx = ni % bw, ny = (ni / bw) | 0;
            if (mask[(by0 + ny) * w + bx0 + nx] === 0) { seen[ni] = 1; continue; }
            seen[ni] = 1;
            stack[sp++] = ni;
          }
        }
        if (anchored || cells.length < 6) continue;

        // Unsupported. Lift it out of the mask and hand it back.
        const pts = new Int16Array(cells.length * 2);
        let minX = 1e9, minY = 1e9;
        for (let k = 0; k < cells.length; k++) {
          const gx = bx0 + (cells[k] % bw);
          const gy = by0 + ((cells[k] / bw) | 0);
          if (gx < minX) minX = gx;
          if (gy < minY) minY = gy;
          pts[k * 2] = gx; pts[k * 2 + 1] = gy;
        }
        for (let k = 0; k < cells.length; k++) {
          pts[k * 2] -= minX; pts[k * 2 + 1] -= minY;
        }
        chunks.push({ pixels: pts, x: minX, y: minY, vy: 0, count: cells.length });
      }
    }

    // Remove chunk pixels from the mask so they stop colliding while airborne.
    for (const ch of chunks) {
      for (let i = 0; i < ch.pixels.length; i += 2) {
        const gx = ch.pixels[i] + ch.x, gy = ch.pixels[i + 1] + ch.y;
        mask[gy * w + gx] = 0;
      }
    }
    if (chunks.length) {
      this.rebuild(bx0, by0, bw, bh);
      this.version++;
    }
    return chunks;
  }

  // Advance airborne debris. Returns true while anything is still moving.
  stepChunks(dt, gravity) {
    if (!this.chunks.length) return false;
    let moving = false;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const ch = this.chunks[i];
      ch.vy += gravity * dt;
      let step = Math.max(1, Math.round(ch.vy * dt));
      let landed = false;
      for (let s = 0; s < step; s++) {
        if (this.chunkBlocked(ch, ch.y + 1)) { landed = true; break; }
        ch.y += 1;
        if (ch.y > this.h + 60) { landed = true; break; }
      }
      if (landed) {
        if (ch.y <= this.h) this.addPixels(ch.pixels, ch.x, ch.y);
        this.chunks.splice(i, 1);
      } else {
        moving = true;
      }
    }
    return moving;
  }

  chunkBlocked(ch, newY) {
    const { w, h, mask } = this;
    for (let i = 0; i < ch.pixels.length; i += 2) {
      const gx = ch.pixels[i] + ch.x;
      const gy = ch.pixels[i + 1] + newY;
      if (gy >= h) return true;
      if (gx < 0 || gx >= w || gy < 0) continue;
      if (mask[gy * w + gx] === 1) return true;
    }
    return false;
  }

  drawChunks(ctx) {
    if (!this.chunks.length) return;
    ctx.save();
    for (const ch of this.chunks) {
      // Draw the cluster by clipping the texture to its footprint. Cheap enough
      // because loose clusters are small and short-lived.
      ctx.fillStyle = 'rgba(70,54,40,1)';
      for (let i = 0; i < ch.pixels.length; i += 2) {
        ctx.fillRect(ch.pixels[i] + ch.x, ch.pixels[i + 1] + ch.y, 1, 1);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------ networking

  // Compact snapshot of the mask for resync. Run-length encoded then base64.
  serialize() {
    const { mask } = this;
    const runs = [];
    let cur = mask[0], len = 0;
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === cur && len < 0xffff) { len++; continue; }
      runs.push(cur, len);
      cur = mask[i]; len = 1;
    }
    runs.push(cur, len);
    const buf = new Uint8Array(runs.length / 2 * 3);
    for (let i = 0, o = 0; i < runs.length; i += 2) {
      buf[o++] = runs[i];
      buf[o++] = runs[i + 1] & 0xff;
      buf[o++] = (runs[i + 1] >> 8) & 0xff;
    }
    let s = '';
    const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) {
      s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    }
    return btoa(s);
  }

  deserialize(b64) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    const { mask } = this;
    let p = 0;
    for (let i = 0; i < buf.length; i += 3) {
      const val = buf[i];
      const len = buf[i + 1] | (buf[i + 2] << 8);
      mask.fill(val, p, Math.min(mask.length, p + len));
      p += len;
    }
    this.chunks.length = 0;
    this.rebuild(0, 0, this.w, this.h);
    this.version++;
  }

  // Cheap 32-bit checksum of the mask, sampled on a grid. Full-pixel hashing
  // of 900k bytes every turn is wasteful; a 4px lattice catches any real
  // divergence because craters are always far larger than 4px.
  checksum() {
    const { w, h, mask } = this;
    let a = 2166136261 >>> 0;
    for (let y = 0; y < h; y += 4) {
      const row = y * w;
      for (let x = 0; x < w; x += 4) {
        a ^= mask[row + x];
        a = Math.imul(a, 16777619) >>> 0;
      }
    }
    return a >>> 0;
  }
}
