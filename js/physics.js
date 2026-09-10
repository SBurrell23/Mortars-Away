// Deterministic projectile integration.
//
// Both peers run this with byte-identical inputs and must produce byte-identical
// outputs, so the inner loop uses only +, -, *, / and Math.sqrt. Those are
// exactly specified by IEEE-754 and agree across every JS engine. Anything
// transcendental (sin/cos for the launch angle) is evaluated ONCE by the
// shooting peer and transmitted as a raw velocity vector, never recomputed.

export const PHYS = {
  dt: 1 / 120,          // fixed simulation step, seconds
  gravity: 260,         // px/s^2 - low enough for long, readable mortar arcs
  dragK: 0.00011,       // quadratic drag; divided by mass, so heavy shells keep speed
  windAcc: 40,          // px/s^2 per unit of wind, before the shell's windDrift scaling
  maxFlightSeconds: 22, // after this the round is called a dud
  worldTop: -4000,      // shells may arc well above the screen
};

// Result codes returned in `outcome`.
export const HIT_TERRAIN = 'terrain';
export const HIT_UNIT = 'unit';
export const HIT_AIRBURST = 'airburst';
export const HIT_WATER = 'water';
export const OUT_OF_BOUNDS = 'oob';
export const TIMED_OUT = 'timeout';

/**
 * Integrate one shot to completion.
 *
 * shot: { x, y, vx, vy, mass, windDrift, fuseArm, fuseRadius }
 *   windDrift  multiplier on wind acceleration for this shell's mass
 *   fuseArm    seconds before proximity fuse becomes live; <=0 disables it
 *   fuseRadius proximity trigger distance in px
 * world: { width, height, wind, waterY, solidAt(x,y), targets: [{x,y,r,id}] }
 *
 * Returns { path: Float32Array of x,y pairs, steps, outcome, x, y, vx, vy,
 *           targetId, flightTime }
 */
export function simulate(shot, world) {
  const dt = PHYS.dt;
  const g = PHYS.gravity;
  const k = PHYS.dragK;
  const windA = world.wind * PHYS.windAcc * shot.windDrift;

  let x = shot.x, y = shot.y;
  let vx = shot.vx, vy = shot.vy;

  const maxSteps = Math.ceil(PHYS.maxFlightSeconds / dt);
  // Record every 2nd step; plenty for a smooth trail and keeps the array small.
  const path = new Float32Array(Math.ceil(maxSteps / 2) * 2 + 2);
  let pn = 0;
  path[pn++] = x; path[pn++] = y;

  let outcome = TIMED_OUT;
  let targetId = -1;
  let step = 0;
  const targets = world.targets || [];
  const fuseArm = shot.fuseArm || 0;
  const fuseR2 = (shot.fuseRadius || 0) * (shot.fuseRadius || 0);
  // Distance to the nearest target on the previous sample, so the fuse can
  // wait for the point of closest approach instead of firing the instant the
  // shell crosses the threshold.
  let prevTargetD2 = Infinity;
  let armedNear = false;

  for (; step < maxSteps; step++) {
    // Quadratic drag opposes velocity. Heavier shells shrug it off, which is
    // folded into windDrift's sibling term below via mass.
    const speed = Math.sqrt(vx * vx + vy * vy);
    const dragScale = k * speed / shot.mass;
    const ax = windA - vx * dragScale;
    const ay = g - vy * dragScale;

    // Semi-implicit Euler: velocity first, then position. Stable and cheap.
    vx += ax * dt;
    vy += ay * dt;
    const nx = x + vx * dt;
    const ny = y + vy * dt;

    // March the segment a pixel at a time so fast shells cannot tunnel
    // through thin ridges.
    const sx = nx - x, sy = ny - y;
    const segLen = Math.sqrt(sx * sx + sy * sy);
    const samples = segLen < 1 ? 1 : Math.ceil(segLen);
    const inv = 1 / samples;
    let hit = false;

    for (let s = 1; s <= samples; s++) {
      const px = x + sx * s * inv;
      const py = y + sy * s * inv;

      if (px < -60 || px > world.width + 60) {
        x = px; y = py; outcome = OUT_OF_BOUNDS; hit = true; break;
      }
      if (py > world.height + 40) {
        x = px; y = py; outcome = OUT_OF_BOUNDS; hit = true; break;
      }
      if (py < PHYS.worldTop) {
        x = px; y = py; outcome = OUT_OF_BOUNDS; hit = true; break;
      }

      // Direct impact on an emplacement.
      for (let ti = 0; ti < targets.length; ti++) {
        const t = targets[ti];
        const ddx = px - t.x, ddy = py - t.y;
        if (ddx * ddx + ddy * ddy <= t.r * t.r) {
          x = px; y = py; outcome = HIT_UNIT; targetId = t.id; hit = true; break;
        }
      }
      if (hit) break;

      // Proximity fuse. It fires at the point of CLOSEST APPROACH, not the
      // moment the shell first crosses the threshold. Firing on entry would
      // punish an accurate gunner: a round that was going to land twenty
      // pixels away would detonate sixty pixels out instead. Waiting for the
      // distance to start growing again means a good fuse can only ever help.
      if (fuseR2 > 0 && step * dt > fuseArm) {
        let nearest = Infinity, nearestId = -1;
        for (let ti = 0; ti < targets.length; ti++) {
          const t = targets[ti];
          const ddx = px - t.x, ddy = py - t.y;
          const d2 = ddx * ddx + ddy * ddy;
          if (d2 < nearest) { nearest = d2; nearestId = t.id; }
        }
        if (nearest <= fuseR2) {
          if (armedNear && nearest > prevTargetD2) {
            x = px; y = py; outcome = HIT_AIRBURST; targetId = nearestId; hit = true;
          }
          armedNear = true;
        }
        prevTargetD2 = nearest;
        if (hit) break;
      }

      if (py >= 0 && world.solidAt(px, py)) {
        x = px; y = py; outcome = HIT_TERRAIN; hit = true; break;
      }

      // On maps with open water the sea stops the round where it meets it,
      // rather than letting it sail on down off the bottom of the world.
      if (world.waterY && py >= world.waterY) {
        x = px; y = world.waterY; outcome = HIT_WATER; hit = true; break;
      }
    }

    if (hit) { step++; break; }

    x = nx; y = ny;
    if ((step & 1) === 0 && pn + 1 < path.length) {
      path[pn++] = x; path[pn++] = y;
    }
  }

  if (pn + 1 < path.length) { path[pn++] = x; path[pn++] = y; }

  return {
    path: path.subarray(0, pn),
    steps: step,
    flightTime: step * dt,
    outcome,
    targetId,
    x, y, vx, vy,
  };
}

// Launch vector from angle (degrees above horizontal) and speed. Evaluated
// once by the shooter; the result is what travels over the wire.
export function launchVector(angleDeg, speed, facing) {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    vx: Math.cos(rad) * speed * facing,
    vy: -Math.sin(rad) * speed,
  };
}

// Ghost trajectory for the aiming preview. Ignores terrain, stops at ground
// level, and is capped short so it never gives away the exact landing spot.
export function previewPath(shot, world, maxSeconds) {
  const dt = PHYS.dt * 3;
  const g = PHYS.gravity;
  const k = PHYS.dragK;
  const windA = world.wind * PHYS.windAcc * shot.windDrift;
  let x = shot.x, y = shot.y, vx = shot.vx, vy = shot.vy;
  const pts = [];
  const steps = Math.ceil((maxSeconds || 1.1) / dt);
  for (let i = 0; i < steps; i++) {
    const speed = Math.sqrt(vx * vx + vy * vy);
    const dragScale = k * speed / shot.mass;
    vx += (windA - vx * dragScale) * dt;
    vy += (g - vy * dragScale) * dt;
    x += vx * dt;
    y += vy * dt;
    pts.push(x, y);
    if (world.waterY && y >= world.waterY) break;
    if (x < -40 || x > world.width + 40 || y > world.height + 20) break;
  }
  return pts;
}
