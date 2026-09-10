// Ten battlefields. Every map is generated left-half-first and then mirrored,
// so neither side ever gets a terrain advantage. The seed comes from the host
// so both peers build byte-identical ground.

export const WORLD_W = 1280;
export const WORLD_H = 720;

// Width of the flat pad carved under each mortar so emplacements sit level.
export const PAD_HALF = 22;

function smoothNoise(rng, count, octaves, persistence) {
  const out = new Float32Array(count);
  let amp = 1, freq = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const pts = Math.max(2, Math.ceil(count * freq / 220));
    const ctrl = new Float32Array(pts + 1);
    for (let i = 0; i <= pts; i++) ctrl[i] = rng.float() * 2 - 1;
    for (let i = 0; i < count; i++) {
      const t = (i / count) * pts;
      const i0 = Math.floor(t);
      const f = t - i0;
      const s = f * f * (3 - 2 * f); // smoothstep between control points
      out[i] += (ctrl[i0] * (1 - s) + ctrl[i0 + 1] * s) * amp;
    }
    total += amp;
    amp *= persistence;
    freq *= 2;
  }
  for (let i = 0; i < count; i++) out[i] /= total;
  return out;
}

function mirror(h) {
  const n = h.length;
  for (let x = 0; x < n / 2; x++) h[n - 1 - x] = h[x];
  return h;
}

function clampHeights(h, minY, maxY) {
  for (let i = 0; i < h.length; i++) {
    h[i] = Math.max(minY, Math.min(maxY, h[i]));
  }
  return h;
}

// Flatten a landing pad so a mortar has level ground under it.
export function flattenPad(h, centerX, halfWidth) {
  const x0 = Math.max(0, centerX - halfWidth);
  const x1 = Math.min(h.length - 1, centerX + halfWidth);
  let sum = 0;
  for (let x = x0; x <= x1; x++) sum += h[x];
  const lvl = Math.round(sum / (x1 - x0 + 1));
  for (let x = x0; x <= x1; x++) h[x] = lvl;
  // Blend the pad edges back into the surrounding ground over 14px.
  for (let i = 1; i <= 14; i++) {
    const t = i / 15;
    const lx = x0 - i, rx = x1 + i;
    if (lx >= 0) h[lx] = h[lx] * t + lvl * (1 - t);
    if (rx < h.length) h[rx] = h[rx] * t + lvl * (1 - t);
  }
  return lvl;
}

// ------------------------------------------------------- generators

const GEN = {
  // Gentle undulating farmland. The tutorial map.
  rolling(rng, w) {
    const n = smoothNoise(rng, w, 3, 0.45);
    const h = new Float32Array(w);
    for (let x = 0; x < w; x++) h[x] = 520 + n[x] * 62;
    return mirror(clampHeights(h, 300, 660));
  },

  // Two flat-topped shelves with a hard gulf between them.
  plateaus(rng, w) {
    const h = new Float32Array(w);
    const n = smoothNoise(rng, w, 2, 0.4);
    const shelf = 400 + rng.range(-20, 20);
    const floor = 665;
    for (let x = 0; x < w; x++) {
      const t = x / w;
      let base;
      if (t < 0.32) base = shelf + n[x] * 14;
      else if (t < 0.46) {
        const k = (t - 0.32) / 0.14;
        base = shelf + (floor - shelf) * (k * k * (3 - 2 * k));
      } else base = floor + n[x] * 8;
      h[x] = base;
    }
    return mirror(clampHeights(h, 300, 700));
  },

  // A single dominating ridge dead centre. You must shoot over it.
  ridge(rng, w) {
    const h = new Float32Array(w);
    const n = smoothNoise(rng, w, 3, 0.4);
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x - w / 2) / (w / 2);
      const peak = Math.exp(-(d * d) / 0.062) * 195;
      h[x] = 600 - peak + n[x] * 34;
    }
    return mirror(clampHeights(h, 150, 690));
  },

  // Already-shelled ground: shallow bowls everywhere, unpredictable bounces.
  cratered(rng, w) {
    const h = new Float32Array(w);
    const n = smoothNoise(rng, w, 4, 0.5);
    for (let x = 0; x < w; x++) h[x] = 545 + n[x] * 40;
    const count = 9;
    for (let i = 0; i < count; i++) {
      const cx = rng.int(30, w / 2 - 10);
      const r = rng.int(26, 62);
      const depth = rng.range(16, 40);
      for (let x = Math.max(0, cx - r); x < Math.min(w / 2, cx + r); x++) {
        const t = (x - cx) / r;
        h[x] += depth * (1 - t * t);
      }
    }
    return mirror(clampHeights(h, 320, 690));
  },

  // Terraced trench works. Flat firing steps at several elevations.
  trenches(rng, w) {
    const h = new Float32Array(w);
    const n = smoothNoise(rng, w, 2, 0.35);
    const steps = [470, 520, 575, 620, 575, 520];
    for (let x = 0; x < w; x++) {
      const idx = Math.min(steps.length - 1, Math.floor((x / (w / 2)) * steps.length));
      h[x] = steps[idx] + n[x] * 9;
    }
    // Cut narrow trench slots into the terraces.
    for (let i = 0; i < 5; i++) {
      const cx = rng.int(60, w / 2 - 40);
      const half = rng.int(6, 13);
      const d = rng.range(30, 55);
      for (let x = cx - half; x <= cx + half; x++) {
        if (x >= 0 && x < w / 2) h[x] += d;
      }
    }
    return mirror(clampHeights(h, 330, 690));
  },

  // Karst pillars. Tiny targets, lots of terrain to chew through.
  spires(rng, w) {
    const h = new Float32Array(w);
    // The ash flat sits high enough that the whole map reads inside the frame;
    // at a lower floor the pillars were stumps crowded into the bottom fifth.
    const floor = 600;
    for (let x = 0; x < w; x++) h[x] = floor;
    const cols = 5;
    for (let i = 0; i < cols; i++) {
      const cx = 46 + i * (w / 2 / cols) + rng.range(-10, 10);
      const half = rng.range(14, 26);
      const top = rng.range(452, 522);
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        if (x < 0 || x >= w / 2) continue;
        const t = Math.abs(x - cx) / half;
        const shoulder = 1 - t * t * t;
        h[x] = Math.min(h[x], floor - (floor - top) * shoulder);
      }
    }
    return mirror(clampHeights(h, 250, 690));
  },

  // Both emplacements down in a basin with high walls on the outside.
  basin(rng, w) {
    const h = new Float32Array(w);
    const n = smoothNoise(rng, w, 3, 0.42);
    for (let x = 0; x < w; x++) {
      const t = x / (w / 2);
      const wall = Math.pow(Math.max(0, 1 - t * 1.55), 2) * 300;
      h[x] = 600 - wall + n[x] * 26;
    }
    return mirror(clampHeights(h, 240, 690));
  },

  // Long shallow saddle: high shoulders, low middle, very open.
  saddle(rng, w) {
    const h = new Float32Array(w);
    const n = smoothNoise(rng, w, 3, 0.4);
    for (let x = 0; x < w; x++) {
      const t = x / (w / 2);
      h[x] = 430 + 170 * Math.sin(Math.min(1, t) * Math.PI * 0.5) + n[x] * 30;
    }
    return mirror(clampHeights(h, 300, 690));
  },

  // Disconnected islands over a void. Miss and the shell simply vanishes.
  islands(rng, w) {
    const h = new Float32Array(w);
    for (let x = 0; x < w; x++) h[x] = WORLD_H + 40; // void
    const spans = [
      [16, 292, 520],
      [330, 452, 470],
      [486, 632, 556],
    ];
    for (const [a, b, top] of spans) {
      const mid = (a + b) / 2, half = (b - a) / 2;
      for (let x = a; x <= b && x < w / 2; x++) {
        const t = (x - mid) / half;
        h[x] = top + 30 * t * t;
      }
    }
    return mirror(h);
  },

  // Almost featureless. Nowhere to hide, pure ballistics.
  plain(rng, w) {
    const h = new Float32Array(w);
    const n = smoothNoise(rng, w, 2, 0.3);
    for (let x = 0; x < w; x++) h[x] = 588 + n[x] * 14;
    return mirror(clampHeights(h, 480, 660));
  },
};

// ----------------------------------------------------------- maps

export const MAPS = [
  {
    id: 'flanders',
    name: 'Flanders Fields',
    desc: 'Soft farmland churned by a season of shelling. Forgiving ground, light airs.',
    gen: 'rolling',
    gap: 660,
    windBias: 0.55,
    layers: ['grass', 'dirt', 'clay', 'rock'],
    sky: ['#7d8a94', '#a9b0ae', '#c8c4b4'],
    fog: 'rgba(190,192,180,0.30)',
    props: ['tree_dead_a', 'tree_dead_b', 'barbwire', 'sandbags', 'helmet_gnd', 'crate'],
    propDensity: 1.0,
    gimmick: 'Steady, weak wind. The map where a beginner can actually range in.',
    difficulty: 1,
  },
  {
    id: 'somme',
    name: 'Somme Mud',
    desc: 'A drowned moonscape of overlapping craters. Nothing here is level.',
    gen: 'cratered',
    gap: 700,
    windBias: 0.9,
    layers: ['mud', 'dirt', 'clay', 'rock'],
    sky: ['#5d6165', '#787a76', '#9a9384'],
    fog: 'rgba(150,148,136,0.38)',
    props: ['barbwire', 'helmet_gnd', 'wreck_tank', 'barrel', 'tree_dead_b'],
    propDensity: 1.2,
    gimmick: 'Pre-dug craters swallow shells and hide the low silhouettes.',
    difficulty: 2,
  },
  {
    id: 'verdun',
    name: 'Verdun Ridge',
    desc: 'One fortified spine between two batteries. Everything must go over the top.',
    gen: 'ridge',
    gap: 760,
    windBias: 0.8,
    layers: ['grass', 'dirt', 'rock', 'rock'],
    sky: ['#6b7480', '#8d939a', '#b2b0a6'],
    fog: 'rgba(160,166,170,0.30)',
    props: ['bunker', 'barbwire', 'tree_pine', 'sandbags', 'telegraph'],
    propDensity: 1.0,
    gimmick: 'A central ridge blocks flat shots. High-angle fire or nothing.',
    difficulty: 3,
  },
  {
    id: 'ardennes',
    name: 'Ardennes Frost',
    desc: 'Frozen pine country. The snow crust hides how deep the rock sits.',
    gen: 'trenches',
    gap: 720,
    windBias: 1.0,
    layers: ['snow', 'dirt', 'clay', 'rock'],
    sky: ['#8f9dab', '#b6c2cc', '#dfe4e6'],
    fog: 'rgba(220,228,234,0.34)',
    props: ['tree_pine', 'crate', 'wreck_tank', 'barrel', 'sandbags'],
    propDensity: 1.1,
    gimmick: 'Terraced firing steps give clean pads but sharp vertical walls.',
    difficulty: 3,
  },
  {
    id: 'tobruk',
    name: 'Tobruk Wastes',
    desc: 'Open desert with nothing to break the wind for forty kilometres.',
    gen: 'plain',
    gap: 860,
    windBias: 1.25,
    layers: ['sand', 'sand', 'clay', 'rock'],
    sky: ['#c9a367', '#e0c088', '#f0dcae'],
    fog: 'rgba(230,205,150,0.34)',
    props: ['wreck_tank', 'barrel', 'crate', 'barbwire'],
    propDensity: 0.7,
    gimmick: 'Wide gap and the strongest wind in the rotation. Light shells suffer.',
    difficulty: 4,
  },
  {
    id: 'hurtgen',
    name: 'Hurtgen Basin',
    desc: 'Both batteries dug into a bowl, walled in by ground they cannot see past.',
    gen: 'basin',
    gap: 640,
    windBias: 0.65,
    layers: ['grass', 'mud', 'clay', 'rock'],
    sky: ['#4f5a54', '#6d7669', '#909683'],
    fog: 'rgba(140,150,135,0.36)',
    props: ['tree_pine', 'tree_dead_a', 'bunker', 'barbwire', 'telegraph'],
    propDensity: 1.3,
    gimmick: 'Short gap, tall outer walls. Overshoot and the shell is simply gone.',
    difficulty: 2,
  },
  {
    id: 'monte',
    name: 'Monte Cassino',
    desc: 'Broken limestone shelves. Whole slabs come away when you hit them.',
    gen: 'plateaus',
    gap: 820,
    windBias: 0.95,
    layers: ['ash', 'clay', 'rock', 'rock'],
    sky: ['#8a7f74', '#a99a8a', '#c7b8a4'],
    fog: 'rgba(190,175,155,0.30)',
    props: ['ruin_wall', 'bunker', 'crate', 'sandbags', 'telegraph'],
    propDensity: 1.1,
    gimmick: 'Undercut a shelf and the whole overhang collapses onto the pad below.',
    difficulty: 4,
  },
  {
    id: 'guadal',
    name: 'Guadal Spires',
    desc: 'Volcanic pillars over ash flats. Almost no ground worth calling cover.',
    gen: 'spires',
    gap: 780,
    windBias: 1.2,
    layers: ['ash', 'ash', 'rock', 'rock'],
    sky: ['#6d5a52', '#93756a', '#c09b82'],
    fog: 'rgba(178,140,112,0.32)',
    props: ['tree_dead_a', 'barrel', 'wreck_tank', 'helmet_gnd'],
    propDensity: 0.9,
    gimmick: 'Thin spires shatter fast. The map opens right up after four turns.',
    difficulty: 5,
  },
  {
    id: 'kursk',
    name: 'Kursk Saddle',
    desc: 'A vast tilted steppe. Long sightlines, longer shots.',
    gen: 'saddle',
    gap: 880,
    windBias: 1.3,
    layers: ['grass', 'dirt', 'clay', 'rock'],
    sky: ['#6e7c86', '#94a0a2', '#bcbdb0'],
    fog: 'rgba(175,180,175,0.28)',
    props: ['wreck_tank', 'telegraph', 'barbwire', 'tree_dead_b', 'flag_pole'],
    propDensity: 0.9,
    gimmick: 'The widest gap on the roster. A siege shell will not cross it unaided.',
    difficulty: 5,
  },
  {
    id: 'atoll',
    name: 'Coral Atoll',
    desc: 'Three shattered spits of coral over open water. Miss and it is gone.',
    gen: 'islands',
    gap: 760,
    windBias: 1.4,
    layers: ['sand', 'sand', 'clay', 'rock'],
    water: 624,
    waterColor: ['rgba(38,104,128,0.62)', 'rgba(20,62,84,0.86)'],
    sky: ['#4d7f97', '#77a8b6', '#aecfd4'],
    fog: 'rgba(150,195,205,0.30)',
    props: ['bunker', 'crate', 'barrel', 'flag_pole', 'sandbags'],
    propDensity: 0.8,
    gimmick: 'No forgiving ground between the islands. Every short round is wasted.',
    difficulty: 5,
  },
];

export function mapById(id) {
  return MAPS.find((m) => m.id === id) || MAPS[0];
}

// Build the height profile plus the two mortar anchor points.
export function generateMap(mapDef, rng) {
  const w = WORLD_W;
  const heights = GEN[mapDef.gen](rng, w);

  const leftX = Math.round((w - mapDef.gap) / 2);
  const rightX = Math.round((w + mapDef.gap) / 2);

  // Islands map can leave a mortar over the void; nudge onto solid coral.
  const anchors = [leftX, rightX].map((x) => {
    let ax = x;
    if (heights[ax] >= WORLD_H) {
      for (let d = 1; d < 220; d++) {
        if (heights[Math.max(0, ax - d)] < WORLD_H - 30) { ax = ax - d; break; }
        if (heights[Math.min(w - 1, ax + d)] < WORLD_H - 30) { ax = ax + d; break; }
      }
    }
    return Math.max(PAD_HALF + 4, Math.min(w - PAD_HALF - 5, ax));
  });

  const padY = anchors.map((ax) => flattenPad(heights, ax, PAD_HALF));

  return {
    heights,
    anchors,
    padY,
    heightFn: (x) => heights[Math.max(0, Math.min(w - 1, x | 0))],
  };
}

// Scenery placement. Purely cosmetic, so it may use the shared rng freely as
// long as both peers call it the same number of times.
export function placeProps(mapDef, heights, rng, anchors) {
  const out = [];
  const count = Math.round(14 * (mapDef.propDensity || 1));
  const names = mapDef.props || [];
  if (!names.length) return out;
  for (let i = 0; i < count; i++) {
    const x = rng.int(24, WORLD_W - 24);
    // Keep scenery clear of the emplacements so it never hides a target.
    if (anchors.some((a) => Math.abs(a - x) < 70)) continue;
    const gy = heights[x];
    if (gy >= WORLD_H - 8) continue;
    const slope = Math.abs(heights[Math.max(0, x - 6)] - heights[Math.min(WORLD_W - 1, x + 6)]);
    if (slope > 16) continue;
    out.push({ name: rng.pick(names), x, y: Math.round(gy), flip: rng.bool() });
  }
  return out;
}

// Distant parallax layers: far hills, clouds, birds, smoke columns.
export function buildBackdrop(mapDef, rng) {
  const hills = [];
  for (let i = 0; i < 7; i++) {
    hills.push({
      name: rng.bool() ? 'hill_far_a' : 'hill_far_b',
      x: rng.int(-80, WORLD_W + 40),
      // Seated low enough that the flat bottom edge stays behind the terrain.
      y: rng.int(398, 468),
      depth: rng.range(0.12, 0.3),
    });
  }
  const clouds = [];
  for (let i = 0; i < 8; i++) {
    clouds.push({
      name: rng.pick(['cloud_a', 'cloud_b', 'cloud_c']),
      x: rng.int(-100, WORLD_W + 100),
      y: rng.int(30, 250),
      depth: rng.range(0.04, 0.16),
      speed: rng.range(3, 11),
      scale: rng.range(1.4, 3.2),
      alpha: rng.range(0.25, 0.6),
    });
  }
  const smoke = [];
  for (let i = 0; i < 4; i++) {
    smoke.push({
      x: rng.int(40, WORLD_W - 40),
      y: rng.int(330, 440),
      depth: rng.range(0.14, 0.26),
      scale: rng.range(1.0, 1.9),
    });
  }
  const birds = [];
  for (let i = 0; i < 5; i++) {
    birds.push({
      x: rng.int(0, WORLD_W),
      y: rng.int(60, 220),
      speed: rng.range(6, 18) * (rng.bool() ? 1 : -1),
      phase: rng.float() * 6.28,
    });
  }
  return { hills, clouds, smoke, birds };
}
