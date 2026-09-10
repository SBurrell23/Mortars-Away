# Mortars Away

A two-player artillery duel in the browser. Vanilla JavaScript, no build step,
no server. Two people connect directly over WebRTC, pick a battlefield, and
shell each other until one gun stops answering.

**Play it: https://sburrell23.github.io/Mortars-Away/**

---

## The idea

Every artillery game asks you to guess an angle. This one takes that away from
you twice over.

**The shell is rolled for you.** You do not choose what comes out of the crate.
A Feather Charge will reach anywhere on the map and hits like a sledgehammer,
but its lethal radius is about the size of the gun itself and the wind treats it
like a paper aeroplane. A Bunker Buster barely crosses a wide field and its core
is soft, but the blast covers so much ground that close enough is genuinely good
enough. The five classes in between trade along that line. You do not get to
pick your tool; you get to decide what to do with the one you were handed.

**The wind never sits still.** It is re-rolled every turn and it acts on the
shell in inverse proportion to its mass, so the same gale that barely nudges a
Siege Shell will carry a Light Bomb three hundred pixels off line.

**And you have to actually load the thing.** Between deciding on a shot and
seeing it leave the tube there are three stages of hand skill. Two players who
read the wind identically will still not put their rounds in the same place.

The ground remembers everything. Craters stay, overhangs collapse when you
undercut them, and a gun whose footing is blown away falls and takes the fall
damage.

---

## Playing

### A turn

1. A shell is rolled and named in the panel at the bottom left, with pips for
   its reach, its wind sensitivity and its blast radius.
2. The wind is shown at the top of the screen: strength, direction, and a
   readout you learn to translate into elevation by feel.
3. Set elevation with `W` / `S` and charge with `A` / `D`. You can also drag on
   the battlefield to point the tube. The faint dotted arc is a hint, not a
   solution: it stops well short of where the round will actually land.
4. `SPACE` (or the LOAD button) starts the three loading stages.
5. Whatever your hands did in those three stages is what the round does.

After each round the panel reports how far off you were, `LONG` or `SHORT`, and
your own last arc stays on screen while you aim. That is how you range in.

### The three stages

| Stage | What you do | What it controls |
| --- | --- | --- |
| **RAM THE CHARGE** | Hammer `SPACE` for 2.6 seconds | How much of your chosen charge actually gets behind the shell. A fumbled ram costs about a fifth of your range. |
| **LAY THE TUBE** | Stop the sweeping marker on the centre mark | Elevation error, up to eight degrees off what you set |
| **SET THE FUSE** | Freeze the pulsing ring on the sight ring | Proximity fuse radius. A tight fuse bursts the shell as it passes the enemy instead of sailing on past. |

All three perfect is a **TEXTBOOK ROUND**: a wider crater and bonus damage.

### The angle is a real decision

Forty-five degrees squeezes the most range out of a charge, and it is also the
angle where a shaky elevation lock costs you almost nothing, because range is
stationary in angle there. It is also the slowest shot on the board, which hands
the wind the most time to work on your shell.

A flat, fast round beats the wind and punishes a bad elevation lock. A steep lob
clears a ridge and drifts halfway to the next county. Pick your poison.

### The ten battlefields

Ordered roughly by how hard they are to shoot on.

| Map | Gap | Wind | The catch |
| --- | --- | --- | --- |
| Flanders Fields | 660 | x0.55 | Forgiving ground and light airs. Learn here. |
| Hurtgen Basin | 640 | x0.65 | Short gap, tall outer walls. Overshoot and the round is simply gone. |
| Somme Mud | 700 | x0.90 | Pre-dug craters swallow rounds and hide low silhouettes. |
| Verdun Ridge | 760 | x0.80 | A central spine blocks flat shots. High-angle fire or nothing. |
| Ardennes Frost | 720 | x1.00 | Terraced firing steps: clean pads, sharp vertical walls. |
| Monte Cassino | 820 | x0.95 | Undercut a limestone shelf and the overhang comes down on the pad below. |
| Coral Atoll | 760 | x1.40 | Three spits of coral over open water. Every short round is wasted. |
| Guadal Spires | 780 | x1.20 | Volcanic pillars shatter fast. The map opens right up after four turns. |
| Tobruk Wastes | 860 | x1.25 | Wide, flat, and nothing breaks the wind for forty kilometres. |
| Kursk Saddle | 880 | x1.30 | The widest gap on the roster. A siege shell will not cross it unaided. |

---

## Multiplayer

One player hosts and gets a five-character room code; the other joins with it.
The connection is peer to peer over WebRTC. A public PeerJS broker is used only
to introduce the two browsers to each other, and nothing about the match is
stored anywhere.

**How it stays in step.** The map, the wind and the shell weight for turn N are
all derived from `(matchSeed, N)` independently on both machines, so none of it
is ever transmitted. A shot goes over the wire as a raw velocity vector plus the
shell modifiers; both peers then run the same integrator and get the same
trajectory to the last decimal place. The physics loop uses only addition,
subtraction, multiplication, division and `sqrt`, all of which IEEE-754 pins
down exactly, and the one transcendental step (turning the launch angle into a
vector) happens once on the shooter and is never recomputed.

The host publishes a terrain checksum at the start of every turn. If a guest
disagrees it asks for and receives a full run-length-encoded terrain snapshot,
so a match recovers rather than quietly drifting apart.

There is one failure mode a checksum cannot fix, and the game refuses to start
rather than walk into it. Because the game ships as plain ES modules with no
build step and GitHub Pages caches them for a few minutes, a returning player
can end up with a fresh `index.html` running against a stale `physics.js`. Both
sides would believe they agree while their trajectories differed in the third
decimal place. So the handshake exchanges a fingerprint hashed from the actual
loaded *source text* of the functions and tables that decide a shot - not a
hand-maintained version constant, which would be useless precisely when the
module holding it is the stale one. Mismatched builds get told to reload.

There is also a **LOCAL DUEL** mode for two people at one keyboard.

---

## Running it locally

There is no build step. Any static file server will do:

```bash
node tools/serve.js
```

Then open `http://localhost:8123`. Add `?local=verdun&seed=42` to drop straight
into a hot-seat match on a chosen map with a fixed seed.

## Development

| Command | What it does |
| --- | --- |
| `node tools/verify.mjs` | Everything CI runs: module syntax, sprite data against what the renderer asks for by name, balance invariants, and all ten maps seating both guns on solid ground across several seeds. |
| `node tools/playtest.mjs` | Headless balance harness. Plays thousands of full matches against the real physics, terrain and balance code with scripted gunners, and reports match length, accuracy, per-shell damage, the skill curve and first-player advantage. |
| `node tools/playtest.mjs --map kursk --verbose` | The same, restricted to one map, with the per-shell damage breakdown. |

The playtest harness is not decoration. It is what caught the proximity fuse
making accurate gunners *worse* (it fired on threshold crossing rather than at
closest approach), the shell table being strictly better as it got heavier
instead of trading along a curve, and the opening gunner winning 68 per cent of
high-level matches before the equalising final round was added.

`docs/DESIGN.md` is the design document. Where its numbers and the shipped ones
disagree, `js/balance.js` is the truth: the harness moved a lot of them.

## Layout

```
index.html          markup and screens
css/style.css       field-manual styling
js/
  main.js           boot, menus, lobby, frame loop
  game.js           match state machine, turn flow, network handling
  net.js            PeerJS transport, host and join
  physics.js        deterministic projectile integration
  terrain.js        destructible per-pixel terrain and collapse
  balance.js        every tunable number in the game
  maps.js           the ten battlefields and their generators
  minigames.js      the three loading stages
  effects.js        particles, shake, floating text
  render.js         all world and HUD drawing
  audio.js          synthesised sound and music, no sample files
  art-units.js      pixel art: guns, crew, shells, explosions
  art-env.js        pixel art: scenery, sky, HUD icons, terrain tiles
  pixelart.js       turns sprite data into canvases
  rng.js            seeded PRNG shared by both peers
  fingerprint.js    build fingerprint, so mismatched peers refuse to start
tools/
  verify.mjs        pre-deploy checks
  playtest.mjs      headless balance harness
  serve.js          local static server
  domshim.mjs       minimal DOM so terrain.js runs under Node
```

Every sound and every piece of music is generated at runtime with the Web Audio
API. Every sprite is a grid of characters indexed into a small palette, built
into a canvas on load. Nothing binary ships with this game.

## Browser support

Needs WebRTC and Web Audio: current Chrome, Edge, Firefox or Safari. Some
restrictive corporate networks and VPNs block the direct peer connection; the
game reports that clearly rather than hanging.
