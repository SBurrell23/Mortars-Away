# MORTARS AWAY - Design Specification

> ## Read this first: what actually shipped
>
> This document is the **design rationale**, written before the game was built.
> It is worth reading for the reasoning, the risk analysis and the shape of the
> systems. **It is not the source of truth for numbers.**
>
> Almost every constant below was subsequently moved by `tools/playtest.mjs`,
> which plays thousands of complete matches against the real physics, terrain
> and balance code rather than against a standalone model. Where this document
> and `js/balance.js` disagree, **`js/balance.js` is correct**.
>
> The as-built values, and the measurements that produced them, are in the
> section immediately below. The rest of the document is preserved as written.

---

## AS BUILT - the shipped numbers

### Physics (`js/physics.js`)

| Constant | Spec proposed | Shipped | Why it moved |
|---|---|---|---|
| `gravity` | 300 | **260** | Longer, more readable arcs. Full-power standard round: 971 px in 2.82 s, apex ~255 px. |
| `dragK` | 0.00012 | **0.00011** | Retuned alongside the lower muzzle velocity. |
| `windAcc` | 22 | **40** | At 22 the wind was cosmetic. At 40 a full gale moves a Light Bomb roughly 285 px and a Siege Shell roughly 68 px, which is the whole point of the weight mechanic. |
| `BASE_MUZZLE` | 590 | **520** | Follows from the lower gravity. |
| `dt` | 1/120 | **1/120** | Unchanged. |
| `maxFlightSeconds` | 6.0 | **22** | 6 s cut off legitimate high-angle lobs. |

### Shells (`js/balance.js`)

Six classes, not seven. The critical correction: **peak damage falls as mass
rises while lethal radius grows.** The spec had both rising together, which the
harness showed made heavy shells strictly better and collapsed the entire
trade-off. A CI invariant in `tools/verify.mjs` now enforces the monotonic
curve so it cannot regress.

| Shell | Mass | Roll | velMult | windDrift | Crater | Peak dmg | Falloff |
|---|---|---|---|---|---|---|---|
| Feather Charge | 0.50 | 9% | 1.26 | 2.20 | 26 | 64 | 48 |
| Light Bomb | 0.70 | 18% | 1.14 | 1.65 | 32 | 56 | 66 |
| Standard HE | 1.00 | 32% | 1.00 | 1.15 | 42 | 46 | 92 |
| Heavy HE | 1.45 | 22% | 0.92 | 0.78 | 52 | 40 | 118 |
| Siege Shell | 2.10 | 14% | 0.84 | 0.50 | 62 | 36 | 148 |
| Bunker Buster | 2.80 | 5% | 0.82 | 0.36 | 78 | 32 | 186 |

Damage: `min(64, maxDmg * (1 - d/falloff)^1.15 * multipliers + bonuses)`, direct
hit `+14` flat. `DAMAGE_CAP_PER_SHELL = 64` against `HP_MAX = 130`, so two
landed rounds can never finish a full-health gun however the weight rolled.
Three is the mathematical minimum kill. Both facts are CI-enforced.

### Minigames (`js/balance.js`)

| Stage | Shipped tuning | Effect |
|---|---|---|
| RAM | 2.6 s, 22 presses for full marks | Power multiplier 0.88 to 1.02 |
| ELEVATION | 460 px bar, 540 px/s, perfect core +/-8 px, quality zero at 150 px error | Angle error up to 8 degrees |
| FUSE | Ring 12-96 px, target 58 px, 1.25 s cycle, perfect core +/-3 px | Proximity radius up to 34 px, damage 0.90-1.10 |

**The fuse fires at closest approach, not on threshold crossing.** This is the
single most important correction in the build. Firing on entry, as originally
specced, meant a round that would have landed 20 px from the gun instead
detonated 34 px out - so a *better* fuse made an *accurate* gunner worse, and
measured skill was non-monotonic above 0.7. `tools/verify.mjs` checks 210
trajectories to confirm no fused round ever bursts further out than it would
otherwise have landed.

### Pacing

| Property | Shipped |
|---|---|
| Starting HP | **130, both sides equal** |
| Turn timer | 45 s, then a rushed round rather than a skipped turn |
| Counter-battery attrition | From turn 24, 3 damage per turn to both, +1 every 4 turns |
| First-player correction | **An equalising final round**, not bonus HP |

The spec corrected first-player advantage by giving Player 2 extra HP. That
works at one skill level and fails at others: measured here, the opener's edge
was 50% at skill 0.3 but 68% at skill 0.85, because high-level matches are
short enough that one extra shot decides them. The shipped fix instead ends a
match only when both batteries have fired the same number of rounds - a gun
knocked out on an even turn still gets its reply in, and if that reply kills
too, the duel is a draw. Measured after the change: **50.6% / 49.5% / 52.4%**
at skills 0.30 / 0.60 / 0.85.

### Measured outcomes (160 matches per cell, ten maps)

| Gunner level | Median turns | On target | Direct hits | Off map | Stalls |
|---|---|---|---|---|---|
| Novice (0.25) | 25 | 39% | 6% | 6.6% | 0 |
| Club (0.60) | 10 | 66% | 20% | 1.3% | 0 |
| Expert (0.90) | 6 | 88% | 45% | 0.0% | 0 |

Skill against a fixed 0.55 opponent, win rate: **7.8% / 14.2% / 31.5% / 45.0% /
75.5% / 90.5% / 94.8%** at skills 0.15 / 0.30 / 0.45 / 0.55 / 0.70 / 0.85 /
0.97. Monotonic and steep - skill decides matches, the weight roll colours them.

### Maps

Ten as specced, but several gaps were pulled in after measurement. Kursk Saddle
went 1000 to 880 and Tobruk 900 to 860 with its wind bias cut from 1.55 to 1.25,
because at the original values novice matches stalled 15-25% of the time. Verdun
Ridge's central spine was lowered from 300 px to 195 px and Guadal Spires' pillars
were cut from seven tall columns to five short ones; both maps were running 20+
turns at expert level purely because rounds could not clear the terrain.

### Also not built as specced

- **Terrain does collapse.** The spec froze overhangs as a tactical feature.
  The shipped `terrain.js` runs a bounded connected-component search around each
  crater and drops any cluster that is no longer attached to the world, because
  undercutting a shelf and watching it come down is one of the best moments in
  the game. Overhangs still form; they just have to be structurally supported.
- **No kill plane.** Guns fall and take fall damage, capped at 52.
- **The wire payload is a velocity vector**, not the raw aim and minigame
  inputs. Sending inputs would force both peers to re-run `resolveShot` and
  reproduce a `sin`/`cos` call bit-for-bit; sending the resolved vector means the
  only shared maths is arithmetic that IEEE-754 pins down exactly.

---

## Original specification

Everything below is the design document as first written. Treat its numbers as
intent, not as fact.

---


Version 1.0. Every number in this document is a value an implementer can type straight into code.
All ballistics tables below were produced by numerically integrating the exact constants and
integrator specified in section 1 (fixed dt = 1/120 s, semi-implicit Euler). They are measured,
not estimated.

---

## 0. Conventions

| Item | Value |
|---|---|
| Logical playfield | 1280 x 720 px, origin top-left |
| Axis convention | +x right, +y DOWN (canvas space). Gravity is `ay = +300`. Launch is `vy = -v0 * sin(theta)` |
| Terrain storage | `Uint8Array(1280*720)`, 1 = solid, 0 = empty |
| Material lookup | `materialAt(x, y)` derived from `originalSurfaceY[x]` plus the map's layer thickness table. Stored once at generation and never mutated by craters |
| Terrain collapse | Terrain NEVER falls. Overhangs are legal and are a real tactical feature (roofs, lips). Only mortars fall |
| Mortar hull | Circle, radius `HULL_R = 14` px. Damage distance is measured burst-center to hull-center |
| Muzzle offset | Shell spawns at hull center + 26 px along the aim vector |
| Kill plane | Any mortar whose hull center passes `y >= 700` is instantly dead ("into the drink") |
| Determinism | Seeded `mulberry32`. Match seed exchanged on connect. Turn N's shell weight and wind derive from `(seed, turnIndex)` so both peers compute them independently. The only wire payload per turn is `{angleDeg, power, ramPresses, elevStopPx, fuseStopRadius}` |

Starting HP: **Player 1 = 100, Player 2 = 104** (see section 7 for the measurement that produced 104).

---

## 1. Physics Constants

| Constant | Value | Units | Notes |
|---|---|---|---|
| `GRAVITY` | **300** | px/s^2 | Deliberately low; produces mortar-like 2.4-2.9 s arcs |
| `DRAG_K` | **0.00012** | 1/px | Quadratic. `a_drag = (DRAG_K / mass) * speed * velocityVector` |
| `FIXED_DT` | **1/120** | s | 120 Hz physics, decoupled from render |
| `MAX_SHELL_TIME` | **6.0** | s | Exceeded -> shell is a DUD (no crater, no damage) |
| `SHELL_BOUNDS` | x < -300 or x > 1580 | px | Leaving these -> DUD. No ceiling: shells may fly above y = 0 |
| `V_BASE` | **590** | px/s | Muzzle velocity at power = 1.00, mass = 1.00, ram = 1.00 |
| `WIND_ACCEL` | **22** | px/s^2 per wind unit | At mass 1.00 |
| `SUBSTEP_SAMPLE` | **2** | px | Terrain collision samples the swept segment every 2 px |
| `ARM_TIME` / `ARM_DIST` | **0.20 s / 45 px** | | Shell is inert before this. Striking terrain while inert = DUD with a 0.4x crater |

### Integration loop (exact)

```
speed = hypot(vx, vy)
d     = (DRAG_K / mass) * speed
ax    = -d * vx + WIND_ACCEL * wind * windMult(mass)
ay    = -d * vy + GRAVITY
vx += ax * dt ;  vy += ay * dt          // semi-implicit Euler: velocity first
x  += vx * dt ;  y  += vy * dt
```

### Mass coupling formulas

```
velMult(m)  = (1 / m) ^ 0.15        // mass -> muzzle velocity
windMult(m) = (1 / m) ^ 0.55        // mass -> wind susceptibility

v0     = V_BASE * dialedPower * ramMult * velMult(mass)
a_wind = WIND_ACCEL * wind * windMult(mass)      // px/s^2, constant for the whole flight
```

Heavier shells lose muzzle velocity slowly (exponent 0.15) but lose wind susceptibility fast
(exponent 0.55), while quadratic drag scales as `1/mass` and therefore *helps* heavy shells.
The net effect, measured, is a 304 px range spread from lightest to heaviest and a 3.2x spread in
wind drift. That asymmetry is the core tradeoff.

### Worked example (verified by simulation)

**Standard HE, mass = 1.00, angle 45 deg, dialed power 1.00, ram 1.00, wind 0.0:**

| Quantity | Measured value |
|---|---|
| Muzzle velocity `v0` | **590.0 px/s** |
| Range (return to launch height) | **1046.4 px** |
| Flight time | **2.700 s** |
| Apex above launch height | **272.6 px** |
| Impact speed | **534 px/s** |

Hand check: the drag-free closed form is `R = v0^2 * sin(2*45) / g = 590^2 / 300 = 1160.3 px` in
`t = 2 * 590 * sin(45) / 300 = 2.781 s`. Drag removes **9.8%** of range and 2.9% of flight time.
That is a sane drag budget - visible, but not so strong that players cannot reason about arcs.

Longest possible flight over the entire parameter space (all 7 shells x 25-85 deg x 0.2-1.0 power x
wind -3..+3) is **4.01 s** (Feather Charge, 85 deg, full power, wind +3). `MAX_SHELL_TIME = 6.0 s`
gives 50% headroom, which is enough to cover map-specific wind bias up to 1.50x.

### Range verification: can a light shell cross 1000 px? Can a heavy one?

Maximum horizontal reach at full power, best angle in the 25-75 deg band, per wind value:

| Shell (mass) | w -3 | w -2 | w -1 | **w 0** | w +1 | w +2 | w +3 |
|---|---|---|---|---|---|---|---|
| Feather Charge (0.55) | 866 | 945 | 1033 | **1130** | 1238 | 1352 | 1475 |
| Light Bomb (0.75) | 867 | 936 | 1013 | **1096** | 1185 | 1281 | 1382 |
| Standard HE (1.00) | 853 | 912 | 977 | **1047** | 1122 | 1202 | 1285 |
| Fragmentation (1.30) | 830 | 882 | 936 | **995** | 1058 | 1124 | 1193 |
| Heavy HE (1.70) | 800 | 844 | 890 | **938** | 989 | 1043 | 1100 |
| Heavy Siege (2.20) | 766 | 803 | 841 | **880** | 922 | 966 | 1013 |
| Bunker Buster (2.80) | 732 | 763 | 794 | **827** | 863 | 898 | 936 |

**Minimum favourable wind to reach a 1000 px gap at full power:** Feather Charge, Light Bomb and
Standard HE need **0.0**, clearing by 130 / 96 / **47** px respectively; Fragmentation needs +0.1;
Heavy HE **+1.3**; Heavy Siege **+2.8**; the Bunker Buster **never** makes it, topping out at 936 px.

Requirement satisfied exactly. A light shell at full power just reaches across a 1000 px gap; the
Standard HE clears it by under 5%, so a mediocre ram (which costs 12% velocity, see section 4)
turns it into a splash short of the target. A Heavy Siege Shell cannot cross without a wind of
+2.8 or better, which occurs on roughly 6.5% of turns. The Bunker Buster on a 1000 px map is a
demolition turn, not a kill turn - see Balance Risk 5.

### Flat-arc dilemma (emergent, and deliberately preserved)

Range is stationary in angle at 45 deg, so elevation error is nearly free there. Measured landing
error for Standard HE aimed at 860 px, per launch angle:

| Launch angle | Power needed | 0.25 deg err | 0.50 deg | 1.00 deg | 2.00 deg | 3.00 deg |
|---|---|---|---|---|---|---|
| 45 deg | 0.898 | +/-1 px | +/-0 px | +/-2 px | +/-3 px | +/-5 px |
| 52 deg | 0.916 | +/-1 px | +/-3 px | +/-8 px | +/-15 px | +/-24 px |
| 60 deg | 0.975 | +/-4 px | +/-9 px | +/-17 px | +/-34 px | +/-52 px |
| 68 deg | out of reach at 860 px | - | - | - | - | - |

A feature, not a bug, and the HUD should not hide it: flat 45 deg arcs immunise you against the
elevation minigame but are blocked by terrain and are maximally power-sensitive, while 60 deg lobs
clear ridges and drop steeply into trenches at 10x the elevation penalty. Do not balance it away.

---

## 2. Shell Weight Table

Rolled fresh at the start of every one of your turns. Both players see the roll.

| # | Name | Mass | Roll p | velMult | windMult | v0 @ full | Crater r (px) | Max dmg | Falloff r (px) |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Feather Charge | 0.55 | 0.10 | 1.094 | 1.389 | 645 | 26 | 14 | 96 |
| 2 | Light Bomb | 0.75 | 0.16 | 1.044 | 1.171 | 616 | 32 | 18 | 112 |
| 3 | Standard HE | 1.00 | 0.26 | 1.000 | 1.000 | 590 | 40 | 23 | 132 |
| 4 | Fragmentation Shell | 1.30 | 0.18 | 0.961 | 0.866 | 567 | 34 | 20 | **190** |
| 5 | Heavy HE | 1.70 | 0.14 | 0.923 | 0.747 | 545 | 52 | 30 | 148 |
| 6 | Heavy Siege Shell | 2.20 | 0.11 | 0.888 | 0.648 | 524 | 64 | 36 | 160 |
| 7 | Bunker Buster | 2.80 | 0.05 | 0.857 | 0.568 | 506 | **78** | 42 | 134 |

Probabilities sum to 1.00. `velMult` and `windMult` are the exact formula outputs
`(1/m)^0.15` and `(1/m)^0.55`, rounded to 3 dp; ship the rounded table values so the tooltip and
the physics agree exactly.

Derived ballistics, all at power 1.00 / ram 1.00 / wind 0.0:

| Shell | Range @45 deg | Flight time @45 | Apex @45 | Best angle | Max range | Drift per 1.0 wind |
|---|---|---|---|---|---|---|
| Feather Charge | 1129 | 2.87 s | 307 | 43.5 | 1130 | **+/-108 px** |
| Light Bomb | 1093 | 2.78 s | 290 | 43.5 | 1096 | +/-89 px |
| Standard HE | 1046 | 2.70 s | 273 | 43.0 | 1047 | +/-74 px |
| Fragmentation Shell | 995 | 2.62 s | 256 | 45.5 | 995 | +/-62 px |
| Heavy HE | 936 | 2.52 s | 239 | 44.5 | 938 | +/-50 px |
| Heavy Siege Shell | 880 | 2.44 s | 223 | 44.0 | 880 | +/-41 px |
| Bunker Buster | 826 | 2.36 s | 208 | 45.5 | 827 | **+/-34 px** |

Design read: the Fragmentation Shell is the outlier on purpose - a small 34 px crater that barely
reshapes the map, a below-average 20 peak damage, and a **190 px falloff radius**, by far the widest.
It is the forgiveness shell, turning a 100 px miss into 6.1 HP where a Standard HE deals 2.4. At 18%
it is the second most common roll and is what stops unlucky streaks from being total whiffs.

### Power required to hit a given gap (60 deg lob, wind 0)

`--` means the shell physically cannot reach that gap at 60 deg even at full power.

| Shell | 500 px | 650 px | 800 px | 900 px | 1000 px | 1100 px |
|---|---|---|---|---|---|---|
| Feather Charge | 0.681 | 0.791 | 0.893 | 0.958 | -- | -- |
| Light Bomb | 0.704 | 0.812 | 0.913 | 0.976 | -- | -- |
| Standard HE | 0.727 | 0.836 | 0.936 | -- | -- | -- |
| Fragmentation Shell | 0.751 | 0.862 | 0.964 | -- | -- | -- |
| Heavy HE | 0.778 | 0.891 | 0.994 | -- | -- | -- |
| Heavy Siege Shell | 0.805 | 0.922 | -- | -- | -- | -- |
| Bunker Buster | 0.833 | 0.953 | -- | -- | -- | -- |

Use this to seed the "suggested power" default on the aim sliders, interpolated for the actual gap
and wind. It removes the first-shot guessing tax without removing aiming skill, because it is only
correct for a perfect ram at exactly 60 deg with zero elevation error.

---

## 3. Wind Model

| Property | Value |
|---|---|
| Range | **-3.0 to +3.0**, quantised to 0.1 |
| Sign convention | Positive = blowing left-to-right (toward increasing x) |
| Roll formula | `r = uniform(-1, 1); wind = round(sign(r) * 3.0 * r * r * 10) / 10` |
| Map bias | Final wind = `clamp(wind * map.windBias, -4.5, +4.5)`. Bias ranges 0.50 to 1.50 across the 10 maps |
| Re-rolled | Every turn, at the same moment as the shell weight, before the aim phase |
| Changes mid-flight | **NO.** Constant for the entire trajectory |
| Acceleration | `a_wind = 22 * wind * (1 / mass) ^ 0.55` px/s^2, applied to `ax` every tick |

### Distribution (200,000 samples, before map bias)

| \|wind\| bucket | Frequency |
|---|---|
| 0.0 - 0.4 | 38.9% |
| 0.5 - 0.9 | 17.4% |
| 1.0 - 1.4 | 13.2% |
| 1.5 - 1.9 | 11.0% |
| 2.0 - 2.4 | 9.8% |
| 2.5 - 3.0 | 9.6% |
| **Mean \|wind\|** | **1.00** |

The `r^2` shaping means 56.3% of turns have wind under 1.0 (a sub-90 px correction on a light shell,
sub-40 px on a heavy one) while 9.6% of turns are genuinely brutal. That is the right shape: most
turns are about execution, and roughly one turn in ten is about adaptation.

### Why wind does not change mid-flight

1. **Determinism.** Constant wind makes the trajectory a pure function of five wire scalars plus
   the seed. A mid-flight change would need its own synchronised stream and be the likeliest source
   of desync.
2. **Learnability.** The HUD shows the exact drift in pixels before firing. A mid-flight change
   makes that readout a lie and the player stops trusting the HUD.
3. **The luck budget is already spent** at 71.3/28.7 (section 4.5). Mid-flight wind would push luck
   past 35% and make the minigames feel pointless.
4. **Reading the wind IS the strategy.** A flat arc into a headwind versus a high lob with a
   tailwind is only a decision if the wind is a known quantity.

### Display

- Top-center banner: a 7-notch-per-side gauge plus a numeric readout, e.g. `WIND 2.1 <<--`.
  Notch thresholds at \|w\| = 0.4 / 0.9 / 1.4 / 1.9 / 2.4 / 2.8 / 3.0.
- Directly under it, the **derived drift readout for the currently rolled shell**, recomputed
  whenever angle or power moves: `DRIFT -86 px`. This single number is the most important
  teaching device in the game.
- Animated dust/snow/ash particles drifting at `40 * wind` px/s so the wind is felt, not just read.
- Both players see the identical banner at the same time, including during the opponent's turn.

Measured drift for a shot aimed at 860 px on a 52 deg arc, per 1.0 of wind:

| Shell | Power | Drift per 1.0 wind | Lands at w = +3 | Lands at w = -3 |
|---|---|---|---|---|
| Feather Charge | 0.869 | +105 px | 1175 | 533 |
| Light Bomb | 0.890 | +90 px | 1132 | 584 |
| Standard HE | 0.916 | +77 px | 1093 | 624 |
| Fragmentation | 0.941 | +69 px | 1064 | 653 |
| Heavy HE | 0.972 | +58 px | 1039 | 682 |

---

## 4. Minigame Tuning

All three run back to back after FIRE is pressed. Total budget 2.5 s + up to 6.0 s + up to 6.0 s.
Input for all three: SPACE, ENTER, or left mouse button (all equivalent).

### 4.1 RAM - "pack the charge"

| Parameter | Value |
|---|---|
| Window | **2.50 s** exactly, fixed (no early exit) |
| Input | Any of SPACE / ENTER / A / D / left-click. Debounce **40 ms** per input device |
| Zero point | **15 presses** (6.0 presses/s) |
| Full point | **35 presses** (14.0 presses/s) |
| Quality | `ramQuality = clamp((presses - 15) / 20, 0, 1)` |
| PERFECT | **presses >= 31** (`ramQuality >= 0.80`) |

**Effect on gameplay:**

```
ramMult = min(1.00, 0.93 + 0.0875 * ramQuality)
deliveredPower = dialedPower * ramMult
```

Minimum **0.93**, maximum **1.00**, full at `ramQuality = 0.80` (31 presses). Ram can only cost
velocity, never overshoot - so "aim exactly at the target" is always correct and the player never
has to predict their own mashing. A 7% velocity shortfall is roughly a 12.5% range shortfall.

Measured shortfall, Standard HE aimed at 860 px on a 52 deg arc (solved power = 0.9158):

| ramQuality | presses | ramMult | Lands at | Short by |
|---|---|---|---|---|
| 0.00 | 15 | 0.9300 | 753 px | **107 px** |
| 0.20 | 19 | 0.9475 | 780 px | 80 px |
| 0.40 | 23 | 0.9650 | 806 px | 54 px |
| 0.60 | 27 | 0.9825 | 834 px | 26 px |
| 0.80+ | 31+ | 1.0000 | 860 px | **0 px** |

**PERFECT bonus:** final shell damage x **1.10**.

### 4.2 ELEVATION - "lay the tube"

| Parameter | Value |
|---|---|
| Bar width | **480 px** (240 px each side of center) |
| Marker speed | **640 px/s**, constant, no easing. 0.750 s per traverse, **1.500 s per full cycle** |
| Start | Random end of the bar, 50/50 |
| Target zone (drawn) | **72 px wide** (+/-36 px from center) |
| PERFECT core (drawn) | **28 px wide** (+/-14 px from center) |
| Timeout | **6.00 s** (4 full cycles) -> treated as `err = 240` |
| Error | `err = abs(markerX - centerX)`, 0 to 240 px |
| Quality | `elevQuality = clamp(1 - err / 240, 0, 1)` |
| PERFECT | **err <= 14 px** (`elevQuality >= 0.9417`) |

**Effect on gameplay:**

```
angleErrorDeg = err / 20                  // exactly 1 degree per 20 px of miss
sign          = (markerX < centerX) ? -1 : +1
launchAngle   = dialedAngle + sign * angleErrorDeg
```

Maximum error at quality 0 is **12.00 deg**. Error at quality 1 is **0.00 deg**. Linear in pixels,
which is the property that makes it teachable: the bar is a ruler, 20 px = 1 degree.

| Where you stopped | err | elevQuality | Tube error | Landing error at 860 px, 60 deg arc |
|---|---|---|---|---|
| Dead center | 0 | 1.000 | 0.00 deg | 0 px |
| Edge of PERFECT core | 14 | 0.942 | 0.70 deg | +/-11 px |
| Edge of target zone | 36 | 0.850 | 1.80 deg | +/-31 px |
| Halfway out | 120 | 0.500 | 6.00 deg | +/-103 px |
| Bar end / timeout | 240 | 0.000 | 12.00 deg | +/-203 px |

The sign is deterministic: LEFT of center settles the tube low, RIGHT settles it high, and the
banner says so plainly (`ELEV +1.80 deg HIGH`). Whether high means long or short depends on your
launch angle - the flat-arc dilemma again. The same 12 deg costs +/-72 px on a 45 deg arc and
+/-203 px on a 60 deg lob.

**PERFECT bonus:** crater radius x **1.08** (a cleanly laid tube plants the shell squarely and digs
better). Deliberately a terrain bonus, not a damage bonus, so the three PERFECTs do not all stack
into the same number.

### 4.3 FUSE - "set the fuse"

| Parameter | Value |
|---|---|
| Ring radius sweep | **12 px -> 132 px -> 12 px**, linear |
| Ring speed | **150 px/s**. 0.800 s per direction, **1.600 s per cycle** |
| Target radius (drawn as a fixed ring) | **84 px** |
| Tolerance band (drawn) | **+/-12 px** |
| PERFECT band (drawn) | **+/-8 px** |
| Timeout | **6.00 s** (3.75 cycles) -> treated as `err = 72` |
| Error | `err = abs(stopRadius - 84)`, clamped to 72 |
| Quality | `fuseQuality = clamp(1 - err / 72, 0, 1)` |
| PERFECT | **err <= 8 px** (`fuseQuality >= 0.889`) |

**Effect: PROXIMITY AIRBURST.** (Chosen over damage-multiplier and extra-crater; justification below.)

```
if (fuseQuality < 0.20)  proxRadius = 0          // impact fuse only
else                     proxRadius = 66 * (fuseQuality - 0.20) / 0.80
if (PERFECT)             proxRadius = 78

airburstDamageMult = PERFECT ? 1.35 : 1.20
```

After arming, if the shell's center comes within `proxRadius` of any mortar's hull center, it
detonates **immediately at that point in the air**.

| fuseQuality | err | proxRadius | Airburst damage mult |
|---|---|---|---|
| 0.00 - 0.19 | >= 58 px | 0 (impact only) | n/a |
| 0.40 | 43 px | 17 px | x1.20 |
| 0.60 | 29 px | 33 px | x1.20 |
| 0.833 (band edge) | 12 px | 52 px | x1.20 |
| 0.889+ (PERFECT) | <= 8 px | **78 px** | **x1.35** |

An airburst is **more** lethal than a ground burst, not less - which is why proximity fuzes were
invented. It also computes `terrainShield = 1.00` by construction (no terrain lies in the segment
to the target) where a ground burst beside a crater lip is typically 0.78. Together these make the
fuse minigame worth **+17.7%** mean damage; with an 0.85 airburst penalty instead it measured
+2.2%, i.e. worthless.

Airburst crater radius is **0.55x** normal and is carved at the burst point, which may be in mid-air
(this legitimately produces overhangs and is the fastest way to shave a ridge crest).

**Why airburst and not a damage multiplier or a bigger crater:**

1. It changes the **geometry** of the outcome instead of adding another invisible scalar. Ram
   already multiplies power and PERFECT ram already multiplies damage; a fuse damage multiplier
   would double-dip into the same feeling.
2. It has a **distinct on-screen read**: the shell visibly pops in the air over the target instead
   of thudding into dirt. Players learn what fuse quality bought them with no number on screen.
3. It is a **pressure valve on the damage curve.** A shell that lands 45 px past the enemy buries
   itself and is shielded toward 0.55; with a 52 px prox radius the same shot bursts in clear air
   at full shielding with the 1.20 bonus.
4. It is **bounded and cannot substitute for aim.** 78 px is the ceiling and only on a PERFECT;
   novice miss distances measure 150-400 px. Extra crater size would be worse than useless - bigger
   craters mostly build the *opponent* a deeper trench.

**PERFECT bonus:** proxRadius **78 px** AND the airburst damage multiplier rises from 1.20 to **1.35**.

### 4.4 TEXTBOOK SHOT

All three PERFECT in one turn: an additional **x1.15** on final damage plus a full-screen banner.

Measured PERFECT rates (400,000 samples per profile) using the skill profiles from section 4.5:

| Profile | PERFECT ram | PERFECT elev | PERFECT fuse | TEXTBOOK (all 3) |
|---|---|---|---|---|
| Novice | 2.1% | 1.3% | 0.9% | 0.00% |
| Average | 15.9% | 8.2% | 7.4% | 0.10% |
| Expert | 72.6% | 28.2% | 32.5% | **6.7%** |

An expert lands a TEXTBOOK about once every 15 shots - frequent enough to chase, rare enough to
celebrate. An average player sees at least one individual PERFECT on roughly 29% of turns.

### 4.5 Skill versus luck: the measurement

**The core argument: the shell weight and the wind are revealed BEFORE the aim phase.** They are
not noise added to the player's solution - they change the problem being solved. A heavy shell with
a headwind is not a worse roll of the same dice; it is a different puzzle whose answer is "do not
attempt a kill this turn, collapse his floor instead".

To put a number on it, a Monte Carlo was run over **the ten actual map gaps** (620 to 980 px),
1,300 independent rolls per gap, 50 executions per roll (65,000 shots per gap, 650,000 total).
The player model:

| Channel | Novice | Average | Expert |
|---|---|---|---|
| ramQuality | N(0.35, 0.22) | N(0.62, 0.18) | N(0.86, 0.10) |
| elevQuality | N(0.45, 0.22) | N(0.72, 0.16) | N(0.89, 0.09) |
| fuseQuality | N(0.32, 0.24) | N(0.60, 0.20) | N(0.83, 0.13) |
| Aim: power slider error (sd, relative) | 5.5% | 2.0% | 1.2% |
| Aim: angle slider error (sd, deg) | 1.60 | 0.65 | 0.35 |

All clamped to [0, 1]. The aim solver targets the exact enemy position, preferring a 60 deg arc and
stepping down through 57/54/51/48/45/43 deg until the shot is physically reachable.

Applying the law of total variance to damage-per-turn for the **average** player,
`Var(total) = Var_roll(E[dmg | roll]) + E_roll(Var[dmg | execution])`:

| Map | Gap | Mean dmg/turn | Execution variance (skill) | Roll variance (luck) | Split |
|---|---|---|---|---|---|
| 1 Parade Ground | 620 px | 13.30 | 69.6 | 27.0 | 72% / 28% |
| 2 Sunken Lane | 680 px | 12.45 | 70.4 | 24.3 | 74% / 26% |
| 3 Poppy Field | 740 px | 12.35 | 73.6 | 26.5 | 74% / 26% |
| 4 Ration Dump | 790 px | 12.11 | 72.1 | 24.7 | 75% / 25% |
| 5 Somme Craterfield | 840 px | 11.54 | 64.8 | 21.3 | 75% / 25% |
| 6 Ridge 212 | 880 px | 10.46 | 57.2 | 20.8 | 73% / 27% |
| 7 Frozen Marsh | 920 px | 9.09 | 47.2 | 20.1 | 70% / 30% |
| 8 Chalk Cliffs | 940 px | 8.34 | 42.3 | 22.3 | 65% / 35% |
| 9 Ash Ridge | 960 px | 7.64 | 38.6 | 21.0 | 65% / 35% |
| 10 Verdun Gap | 980 px | 7.11 | 35.2 | 21.5 | 62% / 38% |
| **Pooled over the map pool** | | | **571.0** | **229.5** | **71.3% / 28.7%** |

**Target 70/30. Achieved 71.3/28.7.** No further tuning required. The trend is itself a design
statement: narrow maps are skill expression (75/25), wide maps are adaptation under pressure
(62/38), and the pool averages out to the target.

Within the 71.3% skill share, the split between the two skill channels at Ridge 212 (880 px) is:

| Skill channel | Variance contribution |
|---|---|
| Minigames (ram + elev + fuse) | 55.4 |
| Aim sliders alone (minigames held at profile mean) | 47.5 |

So of the total outcome, roughly **39% is minigame execution, 34% is aiming judgement, 27% is the
roll** - close to an even split between the two skill channels, and both lose to a player who does
both.

### Channel balance: how much is each minigame worth?

Measured mean damage per turn for an average player with one channel's quality forced to 0 versus
forced to 1.0, everything else sampled normally:

| Gap | RAM (q=0 -> q=1) | ELEVATION (q=0 -> q=1) | FUSE (q=0 -> q=1) |
|---|---|---|---|
| 700 px | 5.7 -> 14.5 (**x2.56**) | 5.3 -> 16.3 (**x3.08**) | 10.5 -> 15.8 (**x1.50**) |
| 860 px | 2.7 -> 14.4 (**x5.25**) | 5.6 -> 13.6 (**x2.44**) | 9.4 -> 14.0 (**x1.49**) |
| 940 px | 1.3 -> 11.9 (**x8.86**) | 4.3 -> 10.1 (**x2.35**) | 7.2 -> 10.7 (**x1.47**) |

Ram and elevation are close to equal on short maps and ram takes over on long ones, which is
correct: on a map you can barely reach, muzzle velocity is the binding constraint. The fuse is
deliberately the smallest at a flat +50% swing - it is the shortest minigame, it comes last when the
player is already committed, and it should reward rather than decide.

The second, independent proof that this is a skill game: mean damage per turn scales
**3.3x from novice to expert on the narrowest map and 5.3x on the widest** (see section 7). A game
where luck dominated would compress that ratio toward 1.

---

## 5. Damage Model

### 5.1 Distance falloff

```
d = distance(burstCenter, targetHullCenter)
baseDamage = (d >= falloffR) ? 0 : maxDamage * (1 - d / falloffR) ^ 1.6
```

Exponent 1.6 makes the curve convex: damage decays slowly then collapses, so closing from a 60 px
miss to 25 px is worth roughly twice as much as closing from 100 px to 60 px. That shape rewards the
final increment of precision.

| Distance | Feather | Light Bomb | Standard HE | Fragmentation | Heavy HE | Heavy Siege | Bunker Buster |
|---|---|---|---|---|---|---|---|
| 0 px (direct) | 17.5 | 22.5 | 28.8 | 25.0 | 37.5 | 44.0* | 44.0* |
| 14 px (hull edge, direct) | 13.6 | 18.2 | 24.0 | 22.1 | 32.0 | 38.9 | 44.0* |
| 25 px | 8.6 | 12.0 | 16.4 | 16.0 | 22.3 | 27.4 | 30.2 |
| 40 px | 5.9 | 8.9 | 12.9 | 13.7 | 18.1 | 22.7 | 23.8 |
| 60 px | 2.9 | 5.3 | 8.7 | 10.9 | 13.1 | 17.0 | 16.2 |
| 80 px | 0.8 | 2.4 | 5.2 | 8.3 | 8.6 | 11.9 | 9.8 |
| 100 px | 0.0 | 0.5 | 2.4 | 6.1 | 5.0 | 7.5 | 4.7 |
| 130 px | 0.0 | 0.0 | 0.0 | 3.2 | 1.0 | 2.5 | 0.2 |
| 160 px | 0.0 | 0.0 | 0.0 | 1.0 | 0.0 | 0.0 | 0.0 |

`*` clipped by the per-shell cap. Values include the direct-hit bonus where `d <= 14`, and exclude
the terrain shield and the airburst bonus.

### 5.2 Multiplier stack (apply in this exact order)

```
dmg = maxDamage * (1 - d/falloffR)^1.6
if (d <= 14)              dmg *= 1.25      // DIRECT HIT
if (airburst)             dmg *= (fusePerfect ? 1.35 : 1.20)
if (ramPerfect)           dmg *= 1.10
if (textbook)             dmg *= 1.15
dmg *= terrainShield                       // see 5.3; an airburst in clear air computes 1.00
if (selfInflicted)        dmg *= 0.60
dmg = min(dmg, 44)                         // DAMAGE_CAP_PER_SHELL
```

**`DAMAGE_CAP_PER_SHELL = 44`** is a hard guarantee, not a tuning value:
`44 + 44 = 88 < 100`, so **no two shells can ever kill a full-HP mortar.** A minimum of three landed
shells is required, always, regardless of rolls, PERFECTs and crits. Raw uncapped maximums:

| Shell | Raw max (direct + PERFECT ram + TEXTBOOK) | After cap |
|---|---|---|
| Feather Charge | 22.1 | 22.1 |
| Light Bomb | 28.5 | 28.5 |
| Standard HE | 36.4 | 36.4 |
| Fragmentation Shell | 31.6 | 31.6 |
| Heavy HE | 47.4 | **44.0** |
| Heavy Siege Shell | 56.9 | **44.0** |
| Bunker Buster | 66.4 | **44.0** |

### 5.3 Terrain shielding

Sample the straight segment from burst center to hull center every 4 px.

```
solidFrac     = solidSamples / totalSamples
terrainShield = clamp(1 - 1.10 * solidFrac, 0.55, 1.00)
```

A mortar in a deep hole never takes less than **55%** of the calculated damage. That floor is what
stops burrowing from being a winning strategy (Balance Risk 2). A typical ground burst next to a
crater lip measures around **0.78**; an airburst in clear air measures **1.00** by construction,
because there is no terrain in the segment. This is the mechanical reason the proximity fuse pays.

### 5.4 Direct hit

`d <= HULL_R (14 px)` -> x1.25 and a distinct hit sound plus a red screen flash on the victim's
client. Nothing else changes.

### 5.5 Fall damage

A mortar becomes airborne if the terrain pixel column under its hull is cleared, or if knockback
launches it. It falls under the same `GRAVITY = 300` with no drag and lands on the highest solid
pixel in its (locked) x column.

```
fallDamage = clamp((fallPx - 70) * 0.16, 0, 30)
```
where `fallPx` is the total drop from the apex of the fall to the landing point.

| Fall distance | Damage | Impact speed |
|---|---|---|
| 0 - 70 px | 0.0 | up to 205 px/s |
| 100 px | 4.8 | 245 px/s |
| 150 px | 12.8 | 300 px/s |
| 200 px | 20.8 | 346 px/s |
| 257 px | 29.9 | 393 px/s |
| 400 px+ | 30.0 (capped) | 490 px/s |

Fall damage is capped at **30** so a single lucky terrain collapse can never account for more than
30% of an opponent's health. Falling past `y = 700` is an instant loss regardless.

### 5.6 Knockback

Mortars have a **locked horizontal position** by design, so knockback is purely vertical.

```
vUp = clamp(4.0 * finalDamage, 0, 240)     // px/s, upward
```

| Final damage | vUp | Rise height |
|---|---|---|
| 10 | 40 px/s | 3 px |
| 25 | 100 px/s | 17 px |
| 44 (capped) | 176 px/s | 52 px |

On its own this is a cosmetic hop. It turns lethal only in combination: a 44-damage Bunker Buster
hit that also removes 100 px of floor gives a 52 px rise plus a 152 px drop, adding 13.1 fall damage
on top of the 44 - the "blown into your own crater" play, and the intended reward for using the
heaviest shell well.

### 5.7 Self-damage and duds

| Situation | Rule |
|---|---|
| Your own burst reaches your own hull | Damage x **0.60**, all other multipliers apply normally |
| Shell strikes terrain while inert (< 0.20 s or < 45 px travelled) | **DUD**: crater at 0.4x radius, **zero damage to anyone** |
| Overhang blocks the muzzle | If the swept segment hits solid terrain within 45 px of the muzzle, that is the inert case above. Digging a roof over yourself will cost you your turn |
| Shell exceeds 6.0 s or leaves x in [-300, 1580] | **DUD**: no crater, no damage |
| Shell enters a map-designated void (Chalk Cliffs chasm) | **DUD** per that map's gimmick |

---

## 6. The Ten Maps

Ordered easy to hard to shoot on. "Gap" is the horizontal distance in pixels between the two mortar
hull centers. Layers are listed top to bottom with thickness in px; the last layer fills to y = 720.

| # | Name | Description | Archetype | Gap | Layers (top to bottom) | Wind bias | Gimmick |
|---|---|---|---|---|---|---|---|
| 1 | **Parade Ground** | A flattened drill square behind the lines, requisitioned for gunnery practice. | Flat plain at y = 560, +/-30 px value noise | **620** | grass 12 / dirt 90 / clay rest | **0.50** | No cover exists at spawn. The first three craters anyone digs become the only trenches on the map, for both players. |
| 2 | **Sunken Lane** | A farm track worn a metre below the fields either side of it. | Two 70 px banks flanking a 90 px-deep road at x = 520-760 | **680** | grass 10 / mud 70 / clay 80 / rock rest | **0.70** | Mud takes 1.35x crater radius. By turn 8 the lane has widened into a canyon and both mortars sit on isolated spurs. |
| 3 | **Poppy Field** | Rolling ground nobody has shelled yet. Give it an hour. | Sine, amplitude 45 px, wavelength 640 px, plus one 120 px hummock at x = 640 | **740** | grass 14 / dirt 110 / clay rest | **0.85** | The central hummock blocks every trajectory launched below **34 deg** from either side. Flat sniping is off the table until someone levels it. |
| 4 | **Ration Dump** | Crates, tins and a great deal of bully beef, stacked where a road once was. | Twin plateaus at equal height, 60 px step down to a flat centre | **790** | sand 16 / dirt 80 / clay 70 / rock rest | **0.90** | Two 96 x 64 px crate stacks at x = 520 and x = 760, hardness of rock (0.50x crater). Fully destructible mid-map cover that both players must decide whether to spend shells removing. |
| 5 | **Somme Craterfield** | Ground that has been argued over for eleven months. | Flat plain at y = 545, pre-damaged with 14 seeded craters, radius 30-70 px | **840** | mud 18 / dirt 100 / clay rest | **1.00** | Starts pre-cratered, so both players have free cover from turn 1. Turtling gains you nothing you did not already have; the map removes the incentive rather than the option. |
| 6 | **Ridge 212** | An unremarkable contour line that four thousand men have died for. | Asymmetric: left pad at y = 430, right pad at y = 560 | **880** | grass 12 / dirt 90 / rock rest | **1.10** | 130 px of genuine height advantage. Measured: to cover the 880 px gap at 45 deg with a Standard HE, the high battery needs power **0.849** and the low battery needs **0.910** - a **7.2% power premium** for the low side - and the high battery's maximum reach improves about 11% (1047 -> 1162 px). The player who loses the coin toss chooses which side to take. |
| 7 | **Frozen Marsh** | The bog froze in November. The ice is thinner than the map suggests. | Flat at y = 570 with a 200 px frozen pond spanning x = 540-740 | **920** | snow 24 / VOID 40 / mud 60 / clay rest | **1.25** | Snow takes **2.00x** crater radius. Any burst inside the pond collapses the entire 200 px crust at once, dropping anything standing on it 64 px. |
| 8 | **Chalk Cliffs** | Two white shoulders of downland with a dry valley between. | Twin plateaus at y = 400, central chasm 260 px wide and 300 px deep | **940** | grass 10 / dirt 60 / clay 140 / rock rest | **1.15** | A shell whose x enters the chasm and passes below **y = 520** without touching a wall is a **DUD** - no crater, no damage. Flat arcs are actively punished; you must lob. |
| 9 | **Ash Ridge** | A spine of volcanic grit, and two batteries dug into the shelves below it. | Central spine 220 px tall spanning x = 560-720, mortars on low shelves at y = 590 | **960** | ash 40 / dirt 70 / rock rest | **1.35** | Ash takes **1.60x** crater radius. Three heavy shells will tunnel a lane straight through the spine, converting the map from a lobbing duel into a flat shooting gallery. Whoever opens the lane pays for it in turns. |
| 10 | **Verdun Gap** | Two forts on rock plinths and three hundred metres of nothing between them. | 120 px rock plinths at each end, 400 px gully between, floor at y = 660 | **980** | rock 30 / clay 100 / dirt rest | **1.50** | Rock takes **0.50x** crater radius: you cannot dig your opponent out of his plinth. At zero wind only shells of mass <= 1.30 reach at all (see the reach table in section 1); everything else is a demolition turn. |

### Material hardness table

Crater radius applied = `shell.craterR * material.mult * (elevPerfect ? 1.08 : 1.00) * (airburst ? 0.55 : 1.00)`.
The material is looked up once, at the impact pixel. No blending across layers - it is deterministic
and it is what the P2P peers agree on.

| Material | Crater radius multiplier | Notes |
|---|---|---|
| snow | **2.00** | Also flagged `collapsible` for map gimmicks |
| ash | 1.60 | |
| sand | 1.45 | |
| mud | 1.35 | |
| dirt | **1.00** | Reference material |
| grass | 0.90 | Only ever used as a 10-24 px cap layer |
| clay | 0.75 | |
| rock | **0.50** | |

### Wide-map rule: the single heavy re-roll

On any map with `gap > 900` (maps 8, 9 and 10), if the rolled mass is `>= 1.70` the shell is
re-rolled **exactly once** from the same table, using the next value of the seeded stream. Both
peers compute this identically. Measured effect on the fraction of turns where the rolled shell
cannot physically reach the enemy at full power under that turn's wind:

| Map | Gap | Wind bias | Unreachable turns, no re-roll | **With re-roll** |
|---|---|---|---|---|
| Chalk Cliffs | 940 | 1.15 | 33.7% | **22.0%** |
| Ash Ridge | 960 | 1.35 | 39.2% | **27.4%** |
| Verdun Gap | 980 | 1.50 | 43.8% | **32.6%** |

Effective shell distribution on those three maps after the re-roll:

| Shell | Base p | Effective p on wide maps |
|---|---|---|
| Feather Charge | 10% | 13.0% |
| Light Bomb | 16% | 20.8% |
| Standard HE | 26% | 33.8% |
| Fragmentation Shell | 18% | 23.4% |
| Heavy HE | 14% | 4.2% |
| Heavy Siege Shell | 11% | 3.3% |
| Bunker Buster | 5% | 1.5% |

Heavy shells still appear on wide maps (9.0% of turns combined), so the "here comes the big one"
moment survives; it just stops being the dominant experience of the map.

### Difficulty progression rationale

Gap widens monotonically from 620 to 980 px while wind bias climbs from 0.50 to 1.50. On map 1
every shell reaches with power to spare and the wind is a rounding error; on map 10 three of the
seven cannot reach at zero wind and the effective wind range is +/-4.5. Measured turns-to-kill for
an average player scales from 8.7 (620 px) to 15.8 (980 px). New accounts should be seeded onto
maps 1-3 for their first five matches.

---

## 7. Match Pacing

### Turn structure and time budget

| Phase | Budget | On timeout |
|---|---|---|
| Roll reveal (shell weight card + wind banner) | 2.0 s forced, both clients | - |
| **AIM** (angle slider, power slider, ghost arc) | **30 s timer** | Fires with the currently dialed values and all three minigames force-resolved at quality **0.20** |
| RAM | 2.50 s fixed | - |
| ELEVATION | up to 6.00 s | `elevQuality = 0` (12.00 deg error) |
| FUSE | up to 6.00 s | `fuseQuality = 0` (impact fuse) |
| Flight | 0.9 - 4.0 s measured | DUD at 6.0 s sim time |
| Resolution (crater, damage numbers, fall, camera) | 2.0 s | - |
| **Typical turn** | **24 s** | |
| **Worst-case turn** | **48.5 s** | |

Forcing a timeout to still fire rather than skipping keeps the shell count moving and never
produces a turn where nothing happened. Quality 0.20 on all three is a bad but non-zero shot:
0.9475 ram multiplier, 9.60 deg tube error, no proximity fuse.

**Three consecutive AIM timeouts = forfeit.** This is also the disconnect handler.

### Expected turns to a kill (verified, 2,500 full matches per cell)

Values are the winner's own turn count; total match turns = roughly 2x minus 1.

| Map | Gap | Novice | Average | Expert |
|---|---|---|---|---|
| 1 Parade Ground | 620 px | 16.5 (p10 11, p90 23) | **8.7** (p10 6, p90 11) | 5.2 (p10 4, p90 6) |
| 4 Ration Dump | 790 px | 18.4 (p10 12, p90 26) | **9.2** (p10 6, p90 12) | 5.4 (p10 4, p90 7) |
| 6 Ridge 212 | 880 px | 23.5 (p10 15, p90 33) | **10.7** (p10 7, p90 14) | 5.9 (p10 5, p90 7) |
| 10 Verdun Gap | 980 px | 39.7 (p10 25, p90 56) | **15.8** (p10 11, p90 21) | 8.2 (p10 6, p90 11) |

Mean damage per turn, steady state, with terrain shielding applied:

| Gap | Novice | Average | Expert | Expert/Novice |
|---|---|---|---|---|
| 620 px | 6.7 (whiff 38%) | 13.2 (whiff 9%) | 22.3 (whiff 0%) | 3.3x |
| 780 px | 6.0 (whiff 44%) | 12.3 (whiff 12%) | 22.0 (whiff 0%) | 3.7x |
| 880 px | 4.7 (whiff 51%) | 10.6 (whiff 15%) | 19.9 (whiff 1%) | 4.2x |
| 980 px | 2.6 (whiff 66%) | 6.9 (whiff 32%) | 13.9 (whiff 14%) | 5.3x |

**Headline pacing target: an average-versus-average match on a mid-sized map runs 9 to 11 turns
each, 18 to 22 turns total, at 24 s per turn = about 8 to 9 minutes.** Expert mirror matches run
5 to 6 turns each, about 4.5 minutes. This is the intended length for a duel.

The novice column is the weak point: on Verdun Gap two novices produce a 40-turn slog with a p90 of
56. That is what COUNTER-BATTERY (below) exists to cut off, and it is why new accounts are seeded
onto maps 1-3, where two novices finish in 16 to 17 turns each.

### First-player advantage, measured and corrected

Running 30,000 full head-to-head matches on Ridge 212 (880 px), average versus average, using the
complete shot model:

| P2 starting HP bonus | P1 win rate |
|---|---|
| 0 | **55.19%** |
| +2 | 53.60% |
| **+4** | **50.40%** |
| +6 | 49.13% |

**Player 2 starts with 104 HP.** Player 1 starts with 100. Residual P1 advantage 0.4%, which is well
inside the noise of a real player-skill difference. Displayed honestly on the HUD as `100` and
`104` - hiding it would only confuse players who notice the bars are different lengths.

### Sudden death: COUNTER-BATTERY

Novice-versus-novice matches on wide maps have a p90 of 56 turns, which is unacceptable. From each
player's **turn 16** onward, at the end of every turn an off-map shell lands:

| Trigger | Effect |
|---|---|
| Turns 16-19 | One **Heavy HE** (crater 52, max damage 30, falloff 148) lands at a uniformly random x within +/-160 px of a randomly chosen (50/50) mortar |
| Turn 20+ | Two such shells per turn, one aimed at each side |
| Turn 26+ | Two shells per turn, radius band tightened to +/-90 px |

The side is chosen at random, not by who is ahead - this is a clock, not a rubber band. It ends
games by removing terrain and eventually by direct damage, under identical pressure for both.
Announced at turn 15 with a two-second warning banner.

---

## 8. Balance Risks and Mitigations

### Risk 1: Stalemate - neither player can reach the other

Both dig in, the wind turns against everyone, and turns pass with no damage. Worst case is
Verdun Gap (980 px) where three of the seven shells never reach at zero wind.

**Mitigation.** COUNTER-BATTERY from turn 16 (section 7) is the hard backstop: it deals damage that
neither player controls and it removes the terrain both players are hiding behind. Second,
`DAMAGE_CAP_PER_SHELL = 44` means matches cannot end early, so the clock is the only thing that needs
to be guaranteed, not the damage. Third, **no map exceeds 980 px**, and at 980 px the Standard HE
(33.8% of rolls on that map after the heavy re-roll) clears by 67 px at wind 0 and by 142 px at
wind +1. Measured probability that a turn on Verdun Gap produces a shell that cannot reach at all,
averaged over the wind distribution with the map's 1.50 bias: **43.8%** raw, **32.6%** after the
heavy re-roll rule. That is the hardest map in the pool by design; every other map is below 27.4%.

### Risk 2: Burrowing - digging a hole and hiding in it

The obvious degenerate strategy in any destructible-terrain game.

**Mitigation, four independent brakes.**
1. `terrainShield` has a hard floor of **0.55**. The deepest possible hole still lets 55% of damage
   through. Digging is worth at most a 45% damage reduction, which is less than one shell class.
2. You cannot shoot out of a deep hole on a flat arc. A hole deep enough to shield you forces launch
   angles above roughly 60 deg, where elevation error costs **17 px per 1.0 deg** instead of 2 px
   (section 1 table) - a 1.80 deg miss (the edge of the elevation target zone) costs +/-31 px at
   60 deg but only +/-3 px at 45 deg - and flight time rises, increasing wind exposure.
3. An overhang within 45 px of the muzzle triggers the inert-shell rule: **your shell is a dud and
   your turn is gone.** Roofing yourself over is a self-inflicted skipped turn.
4. Every crater you dig under yourself is fall-damage potential. A 44-damage hit gives 52 px of
   knockback rise; if you have hollowed 100 px of floor out from under yourself, that is
   13.1 additional HP on landing.

### Risk 3: One-shot and two-shot kills

A Bunker Buster direct hit with a TEXTBOOK bonus computes to 66.4 raw damage. Two of those would end
a match in four turns and feel arbitrary.

**Mitigation.** `DAMAGE_CAP_PER_SHELL = 44`, applied last, after every multiplier. `44 + 44 = 88`,
which is strictly less than 100 (and less than P2's 104). **Three landed shells is the mathematical
minimum kill, always.** The cap binds on only three of the seven shells and only on near-direct hits,
so it does not flatten the weight table - mean damage per turn for an average player is 10.5, less
than a quarter of the cap.

### Risk 4: Wind making skill irrelevant

At +/-3.0, a Feather Charge drifts +/-324 px. If that felt random, the minigames would be pointless.

**Mitigation, three parts.**
1. **Wind is revealed before the aim phase and never changes in flight** (section 3). It is
   information, not noise.
2. The **DRIFT readout** shows the exact pixel compensation for the currently rolled shell at the
   current angle and power, recomputed live. The compensation is a number the player reads, not a
   feel they develop.
3. The `r^2` distribution puts **56.3% of turns under \|wind\| 1.0**, which is a 74 px correction on
   a Standard HE and a 41 px correction on a Heavy Siege - both inside a single slider nudge.
Measured result: wind and weight together account for **28.7%** of outcome variance across the map
pool, against a target of 30% (section 4.5).

### Risk 5: Dead-turn rolls - the shell that cannot reach

The Bunker Buster (5% of rolls) tops out at 936 px even at wind +3. On the three widest maps that is
a turn where a kill is impossible.

**Mitigation.**
1. **Free single re-roll rule:** on any map with `gap > 900`, if the rolled mass is `>= 1.70`, the
   shell is re-rolled exactly once from the same table using the next value of the seeded stream.
   Deterministic on both peers. It triggers on 30% of rolls on 3 of the 10 maps, i.e. **9.0% of all
   turns across the map pool**, and it cuts unreachable turns on those maps by roughly a third
   (33.7% -> 22.0%, 39.2% -> 27.4%, 43.8% -> 32.6%). Heavy shells are not removed - they still
   appear on 9.0% of wide-map turns.
2. The heaviest shells have the largest craters (64 and 78 px, up to 135 px on ash at 1.60x with a
   PERFECT elevation). A Bunker Buster fired at the near lip of the enemy's plinth is a legitimate,
   powerful turn: it collapses floor at range 827 px even when the enemy sits at 980 px.
3. The Fragmentation Shell (18% of rolls, 190 px falloff radius) exists specifically to prevent long
   whiff streaks; it deals 6.4 damage at a 100 px miss, roughly 2.5x what a Standard HE manages.

### Risk 6: RAM mashing - macros, spam advantage, and accessibility

A key-repeat macro or a gaming mouse with a 1 kHz turbo button would trivially max the ram, and
2.5 s of maximum-rate mashing three times a minute is an RSI and accessibility problem.

**Mitigation.**
1. **40 ms input debounce per device**, and quality saturates at 35 presses. A 200 Hz macro is
   debounced down to 25 presses/second, registers 62 presses in the 2.5 s window, and is then
   clamped by the quality formula to exactly **1.0** - which is the same result a human gets at
   14 presses/second. **The macro's advantage is mathematically zero**, because the ceiling is
   reachable by hand and there is no reward above it.
2. **The ceiling is low on purpose.** Full quality needs 35 presses in 2.5 s. Zero quality needs 15.
   The entire skill range is 6.0 to 14.0 presses/second - a 20-press window, not an endurance test.
3. **A/D alternating counts**, as does the mouse, as does SPACE and ENTER. Two-finger alternation
   reaches 14/s comfortably.
4. **Accessibility mode (settings toggle, on by request, no competitive restriction):** replaces the
   mash with a single hold-and-release timing bar of the same 2.5 s duration; quality is
   `clamp(1 - abs(heldMs - 1800) / 900, 0, 1)`. Same 0-to-1 output range, one actuation instead of
   35.
5. The ram's worst case costs 107 px of range, not the match. That figure was deliberately reduced
   from an earlier 181 px precisely so that a bad ram cannot zero out a turn on its own.

---

## 9. The First 60 Seconds

New player, first match ever, map 1 (Parade Ground, gap 620, wind bias 0.50). Beat by beat.

| Time | What the player sees | What the player does |
|---|---|---|
| 0:00 | Two mortars on a flat brown field, 620 px apart. Two HP bars reading 100 and 104. A single button: **FIRE MISSION**. | Clicks it. |
| 0:02 | A coin flips. `YOU ARE THE LEFT BATTERY. YOU FIRE FIRST.` | Watches. |
| 0:04 | A shell card slams down: **STANDARD HE - 1.00 kg**. Under the name, three plain lines: `CRATER 40 px`, `DAMAGE 23`, `REACH 1046 px`. | Reads it. Learns that shells vary. |
| 0:06 | Wind banner: `WIND 0.3 -->`, one notch lit, and beneath it `DRIFT +22 px`. Dust drifts slowly right. | Notices 22 is a small number. |
| 0:08 | Two sliders appear: **ANGLE 52.0 deg**, **POWER 0.78**, pre-set from the suggested-power table. A dotted ghost arc springs from the muzzle and ends in a bright pip on the ground, 40 px short of the enemy. A readout says `PREDICTED 580 px / TARGET 620 px`. | Sees the pip. Understands the whole game in one glance. |
| 0:14 | Drags POWER right. The ghost arc and the pip move with it in real time. At 0.82 the readout reads `PREDICTED 620 px / TARGET 620 px` and the pip turns green. | Stops. Presses FIRE. |
| 0:20 | The screen fills with one word: **RAM**. A 2.5-second bar drains. `MASH SPACE`. | Mashes. Gets 24 presses. Bar shows `RAM 45%`. |
| 0:22.5 | **ELEVATION**. A 480 px bar with a marker sweeping left and right, a wide highlighted zone in the middle and a narrow bright core inside it. `PRESS TO SET`. | Presses. Stops 44 px right of centre. Banner: `ELEV +2.20 deg HIGH`. |
| 0:25 | **FUSE**. A ring pulses out and in from the muzzle. A fixed target ring is drawn at 84 px with a visible tolerance band. `PRESS TO SET`. | Presses at radius 103. Banner: `FUSE 74% - PROXIMITY 44 px`. |
| 0:28 | The mortar coughs. The camera pans with the shell for 2.4 seconds against the sky. | Holds breath. |
| 0:31 | Nothing was within 44 px, so the shell buries itself 61 px short of the enemy. A 40 px crater blooms. A red `-6` floats off the enemy mortar. The enemy HP bar ticks 104 to 98. | Sees exactly what happened and why. |
| 0:33 | A translucent ghost marker stays on the terrain where the shell landed, labelled `LAST SHOT: 61 px SHORT`. | Files that away. |
| 0:34 | `ENEMY BATTERY FIRING`. Their shell card and wind banner appear. The player watches their entire turn, including all three minigames, with no input. | Learns the loop a second time by watching. |
| 0:52 | Their shell lands 130 px past. `0 damage.` A crater appears behind the player's mortar. | Relaxes. |
| 0:54 | Turn 2. New card: **HEAVY SIEGE SHELL - 2.20 kg**, `CRATER 64`, `DAMAGE 36`, `REACH 880`. Wind re-rolls: `WIND 2.1 <--`, four notches, `DRIFT -86 px`. | Sees that both the shell AND the wind changed. |
| 0:58 | The suggested power auto-adjusts to 0.94 and the ghost pip lands 86 px short of the target because of the headwind. | Nudges POWER to 0.99 and watches the pip walk onto the enemy. |
| 1:00 | The pip turns green. FIRE. This time the player already knows all three minigames and mashes harder. | Playing. |

**Teach load, total: two sliders, three identical button presses, one number to read.** Everything
else - shell weight, wind, craters, falloff, fall damage - is demonstrated on screen and never
explained in text. There is no tutorial: the ghost arc and the last-shot marker are the tutorial.

---

## 10. Implementation Checklist of Every Tunable

```js
export const PHYSICS = {
  GRAVITY: 300, DRAG_K: 0.00012, FIXED_DT: 1/120,
  MAX_SHELL_TIME: 6.0, WIND_ACCEL: 22, V_BASE: 590,
  VEL_MASS_EXP: 0.15, WIND_MASS_EXP: 0.55,
  ARM_TIME: 0.20, ARM_DIST: 45, SUBSTEP_SAMPLE: 2,
  BOUNDS_X: [-300, 1580], KILL_PLANE_Y: 700,
};
export const COMBAT = {
  HULL_R: 14, START_HP_P1: 100, START_HP_P2: 104,
  FALLOFF_EXP: 1.6, DIRECT_HIT_MULT: 1.25, DIRECT_HIT_DIST: 14,
  DAMAGE_CAP_PER_SHELL: 44, SELF_DAMAGE_MULT: 0.60,
  AIRBURST_DMG_MULT: 1.20, AIRBURST_PERFECT_MULT: 1.35, AIRBURST_CRATER_MULT: 0.55,
  SHIELD_COEF: 1.10, SHIELD_FLOOR: 0.55, SHIELD_SAMPLE_PX: 4,
  FALL_FREE_PX: 70, FALL_DMG_PER_PX: 0.16, FALL_DMG_CAP: 30,
  KNOCKBACK_PER_DMG: 4.0, KNOCKBACK_CAP: 240,
  DUD_CRATER_MULT: 0.4,
};
// ramMult  = min(1.00, MULT_MIN + MULT_SPAN * ramQuality)   -> 0.93 .. 1.00, full at q = 0.80
export const RAM  = { WINDOW_S: 2.50, ZERO_N: 15, FULL_N: 35, DEBOUNCE_MS: 40,
                      MULT_MIN: 0.93, MULT_SPAN: 0.0875, PERFECT_N: 31, PERFECT_DMG: 1.10,
                      ACCESSIBLE_TARGET_MS: 1800, ACCESSIBLE_TOLERANCE_MS: 900 };
// angleErrorDeg = errPx / PX_PER_DEG, signed by which side of centre the marker stopped
export const ELEV = { BAR_W: 480, HALF_W: 240, SPEED: 640, ZONE_HALF: 36,
                      PERFECT_HALF: 14, TIMEOUT_S: 6.0, PX_PER_DEG: 20,
                      MAX_ERR_DEG: 12.0, PERFECT_CRATER: 1.08 };
// proxRadius = q < PROX_GATE_Q ? 0 : PROX_SPAN * (q - PROX_GATE_Q) / (1 - PROX_GATE_Q)
export const FUSE = { R_MIN: 12, R_MAX: 132, SPEED: 150, TARGET_R: 84,
                      BAND: 12, PERFECT_BAND: 8, TIMEOUT_S: 6.0, ERR_MAX: 72,
                      PROX_GATE_Q: 0.20, PROX_SPAN: 66, PERFECT_PROX: 78 };
export const TURN = { AIM_TIMER_S: 30, TIMEOUT_QUALITY: 0.20, REVEAL_S: 2.0,
                      RESOLVE_S: 2.0, FORFEIT_TIMEOUTS: 3,
                      SUDDEN_DEATH_TURN: 16, SD_DOUBLE_TURN: 20, SD_TIGHTEN_TURN: 26,
                      SD_SPREAD_PX: 160, SD_TIGHT_PX: 90 };
export const TEXTBOOK_DMG = 1.15;
export const HEAVY_REROLL = { GAP_OVER: 900, MASS_AT_OR_ABOVE: 1.70, MAX_REROLLS: 1 };
```

Shell table, material table and map table are given in full in sections 2 and 6 and should be
transcribed verbatim.
