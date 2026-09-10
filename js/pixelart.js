// Turns the string-grid sprite definitions from art-*.js into canvases.
// Sprite format: { w, h, palette: 'name', pixels: ["ab.ab", ...] }
// '.' means transparent. Every other char indexes the named palette.

const cache = new Map();

export function buildSprite(def, palettes, key) {
  if (key && cache.has(key)) return cache.get(key);
  const pal = palettes[def.palette];
  if (!pal) throw new Error('missing palette ' + def.palette);
  const cv = document.createElement('canvas');
  cv.width = def.w;
  cv.height = def.h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(def.w, def.h);
  const data = img.data;
  // Pre-resolve palette entries to RGB triples once per sprite.
  const lut = {};
  for (const k in pal) {
    const hex = pal[k];
    lut[k] = [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ];
  }
  for (let y = 0; y < def.h; y++) {
    const row = def.pixels[y] || '';
    for (let x = 0; x < def.w; x++) {
      const c = row[x];
      if (!c || c === '.') continue;
      const rgb = lut[c];
      if (!rgb) continue;
      const i = (y * def.w + x) * 4;
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (key) cache.set(key, cv);
  return cv;
}

export function buildSet(spriteDefs, palettes, prefix = '') {
  const out = {};
  for (const name in spriteDefs) {
    try {
      out[name] = buildSprite(spriteDefs[name], palettes, prefix + name);
    } catch (e) {
      console.warn('sprite build failed:', name, e.message);
    }
  }
  return out;
}

// Horizontally mirrored copy, cached separately.
export function mirror(cv) {
  if (!cv) return cv;
  if (cv.__mirror) return cv.__mirror;
  const m = document.createElement('canvas');
  m.width = cv.width;
  m.height = cv.height;
  const c = m.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.translate(cv.width, 0);
  c.scale(-1, 1);
  c.drawImage(cv, 0, 0);
  cv.__mirror = m;
  return m;
}

// Recolour a sprite canvas by hue-shifting toward a tint. Used for team variants
// and for flashing a unit white when it takes a hit.
export function tinted(cv, color, amount) {
  const t = document.createElement('canvas');
  t.width = cv.width;
  t.height = cv.height;
  const c = t.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.drawImage(cv, 0, 0);
  c.globalCompositeOperation = 'source-atop';
  c.globalAlpha = amount;
  c.fillStyle = color;
  c.fillRect(0, 0, t.width, t.height);
  return t;
}

// Solid silhouette in one colour (used for distant scenery and shadows).
export function silhouette(cv, color) {
  return tinted(cv, color, 1);
}

// A repeating 16x16 tile turned into a CanvasPattern-ready canvas.
export function tileCanvas(def, palettes) {
  return buildSprite(def, palettes, null);
}

export function clearCache() { cache.clear(); }
