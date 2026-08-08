# The Librarian 2 — Complete Project Reference

> **Purpose of this document.** This is the full technical and design specification
> for *The Librarian 2 — "Look, Ma, I Could Read Good"*. It is written so that a
> person or an LLM with no prior context can read it, open the repository, and
> continue development without needing to re-derive any decisions. It documents
> what exists, why it exists, the exact numbers, the architecture, the balance
> history, the bugs already fixed (do not reintroduce them), and the known gaps.
>
> **Status:** playable end-to-end. All systems implemented and verified. Balance
> is tuned against a scripted bot plus design maths; it has not had human
> playtesting at length.

---

## Table of contents

1. [What the game is](#1-what-the-game-is)
2. [Quick start](#2-quick-start)
3. [Provenance — relationship to The Librarian 1](#3-provenance--relationship-to-the-librarian-1)
4. [The game loop](#4-the-game-loop)
5. [Core mechanics and exact formulas](#5-core-mechanics-and-exact-formulas)
6. [Controls](#6-controls)
7. [Content catalogue](#7-content-catalogue)
8. [Technology stack](#8-technology-stack)
9. [Repository map](#9-repository-map)
10. [Runtime architecture](#10-runtime-architecture)
11. [Procedural level generation](#11-procedural-level-generation)
12. [Rendering pipeline](#12-rendering-pipeline)
13. [Procedural texture forge](#13-procedural-texture-forge)
14. [Character rig](#14-character-rig)
15. [Collision and pathfinding](#15-collision-and-pathfinding)
16. [Item system](#16-item-system)
17. [Audio synthesis](#17-audio-synthesis)
18. [UI layer](#18-ui-layer)
19. [Save data](#19-save-data)
20. [Performance](#20-performance)
21. [Balance history and rationale](#21-balance-history-and-rationale)
22. [Bugs found and fixed](#22-bugs-found-and-fixed)
23. [Testing recipes](#23-testing-recipes)
24. [Conventions and gotchas](#24-conventions-and-gotchas)
25. [Known gaps and next steps](#25-known-gaps-and-next-steps)

---

## 1. What the game is

A 3D, top-down-ish, single-player roguelite. You are a librarian. Children
arrive continuously and pull items off the shelves. Items on the floor drive a
**Chaos meter**. You collect and re-file them. Survive fifteen minutes without
Chaos reaching 100%.

It is *Vampire Survivors*' structure (survive a timer, level up mid-run, draft
upgrades, permanent meta progression between runs) applied to tidying rather
than combat. You never kill anything. The antagonist is entropy.

**Key characteristics:**

- Every run generates a brand-new library floor plan from a seed.
- Four unlockable "branches" (levels) that completely re-skin the generator.
- Two playable characters (cosmetic only).
- **Zero asset files.** Every texture, material, character mesh, sound effect
  and piece of music is generated in code at boot. The repository contains no
  images, models, or audio.

---

## 2. Quick start

```bash
npm install
npm run dev      # http://localhost:5273
npm run build    # production bundle -> dist/
npm run preview  # serve the built bundle on :4173
```

Requires a WebGL2 browser. Node 18+ to build.

There is a `.claude/launch.json` describing the dev server for tooling that
reads it (name `librarian2`, port 5273).

---

## 3. Provenance — relationship to The Librarian 1

The original is at <https://github.com/mreflow/the-librarian-game> — a 2D
canvas game ("Library Survivors") built with Vite and vanilla JS, roughly 5,300
lines, using 16-bit-style PNG sprites and MP3 audio.

**What was carried over conceptually:**

| Librarian 1 | Librarian 2 |
|---|---|
| Chaos meter, lose at 100% | Same, but a sub-linear pressure model |
| Auto-pickup within a radius | Same (`pickupRadius`, default 2.2 m) |
| Auto-shelve into colour-matched shelves | Same (`returnRadius`, default 2.4 m) |
| Kids grab books, drop near or carry away | Same, expanded into a 7-state FSM |
| XP → level → choose 1 of 3 upgrades | Same, with a 20-upgrade pool |
| Escalation events every few minutes | Director with bosses **and** disasters |
| Survive 30 minutes | Survive 15 minutes (tighter session) |
| Gold → permanent meta cards | Library Cards → 16 meta perks |

**What is entirely new:** 3D rendering, procedural level generation, the four
branches, the three signature powers, the four bosses, the four disasters, the
mop/mess system, character select, procedural audio, procedural textures.

**Nothing from the original repository is used as code or assets.** It was read
only to understand the loop.

---

## 4. The game loop

### Session loop

```
Main menu
  └─> Character select  ──> Run (15 min)  ──> Results
        ▲                                        │
        │                                        ├─> Another shift (re-select)
        └────────── Staff Development ◀──────────┘  (spend Library Cards)
```

### Moment-to-moment loop

1. **Kids spawn** in a ring 11–26 m from the player, preferring positions the
   player cannot currently see, so they feel like they *arrived*.
2. A kid walks to a shelf bay, spends 0.55 s **ransacking** it, and knocks 1–2
   items off (2–4 for the chaotic "Tornado Toddler" type).
3. With ~30% probability (rising ~1.1 points per elapsed minute) the kid grabs
   one item and **carries it away** to a dump spot 2–11 m off, then drops it.
   Otherwise the items simply fall where they are, in front of their home bay.
4. Every item on the floor adds to the **Chaos rate**.
5. The player walks near an item — it is **vacuumed** in automatically (flies to
   the player, no button press).
6. The player walks near a shelf bay whose colour matches something they carry —
   it is **filed** automatically. Filing awards XP, builds a combo, and cuts
   Chaos.
7. XP fills a bar; each level pauses the game (time crawls to 8%) and offers a
   draft of three upgrades.
8. The **Director** injects a boss or a disaster on a timer, alternating flavour
   and easing off when the player is already buried.
9. Run ends: Chaos hits 100% (loss), health hits 0 (loss), or the timer expires
   (win). Score and lifetime XP are banked; Library Cards are paid out.

### The core tension

Items knocked off a shelf land **in front of the bay they came from**, and that
bay now has space. So the trivial case is: walk over, pick up, it re-files
instantly — a very fast, satisfying rhythm (measured: 12 items cleared in ~2
seconds when clustered).

The difficulty comes from **orphaned items** — the ones kids carry away and dump
far from any matching shelf. Those require a trek, or a power. This is the
reason the carry-away probability is the single most sensitive balance dial in
the game.

---

## 5. Core mechanics and exact formulas

All of the following live in `src/game.js` unless noted.

### Chaos

```js
// per frame, in _updateChaos(dt)
const minute  = run.elapsed / 60;
const perItem = 0.011 + Math.min(0.030, minute * 0.0021);
const load    = Math.pow(floorCount, 0.8) + Math.pow(heldByKidsCount, 0.8) * 0.5;
let rate      = load * perItem + messCount * 0.18 + bosses.chaosPressure;

// Opening grace ramp: 35% -> 100% over the first 90 seconds
rate *= Math.min(1, 0.35 + run.elapsed / 90 * 0.65);

if (run.chaosFrozen) rate = 0;          // "QUIET PLEASE" upgrade
chaos += rate * dt * (1 - chaosDampening / 100);

// Recovery: rewards getting on top of the mess, not just perfection
if (messCount === 0 && floorCount < 8) {
  const clean = 1 - floorCount / 8;
  chaos -= (0.5 + 1.4 * clean) * dt;
}
```

The `^0.8` exponent is deliberate: a large pile still hurts but does not become
instantly unrecoverable after a tornado. Linear scaling was tried and produced
unwinnable death spirals (see [§21](#21-balance-history-and-rationale)).

`maxChaos` is 100. Reaching it ends the run unless **Second Wind** (meta) is
owned and unused, which resets Chaos to 60% once per run.

### XP and levelling

```js
XP_BASE   = 120
XP_GROWTH = 1.34
xpToNext(level) = floor(120 * 1.34^(level-1))
```

XP sources:

| Action | XP |
|---|---|
| Item picked up | 3 |
| Item filed | `round(10 * (1 + min(combo,25) * 0.06))` |
| Kid calmed | 28 |
| Mess mopped | 45 |
| Disaster survived | 320 |
| Boss defeated | 600 |

All XP is multiplied by `player.stats.xpMultiplier` (Reading Glasses, Overtime
Pay) and by `progression.comboBonus` (Overdue Fines).

### Combos

Filing an item sets `comboTimer = 3.2 s` (extended by Overdue Fines) and
increments `combo`. The timer expiring resets it to 0. Combo multiplies filing
XP up to ×2.5 at combo 25, and raises the pitch of the shelve sound.

### Chaos relief

| Action | Chaos change |
|---|---|
| Item picked up | −0.18 |
| Item filed | −0.55 − `min(combo,20) * 0.02` |
| Mess mopped | −2.2 |
| Boss defeated | −12 |
| Mess timer expires | **+8** |

### Score (end of run)

```js
score = shelved*12 + pickedUp*3 + kidsCalmed*25
      + bossesBeaten*400 + disastersSurvived*250
      + elapsedSeconds*2 + bestCombo*30
      + (won ? 3000 : 0)
```

### Payout

```js
lifetimeXP += round(run.xpEarned + (won ? 2500 : 0))
libraryCards += round(gainedXP / 40) + (won ? 25 : 0)
```

### Player base stats

```js
moveSpeed 5.0 m/s     sprintMul 1.5        pickupRadius 2.2 m
returnRadius 2.4 m    carrySlots 6         maxStamina 100
staminaRegen 14/s     staminaDrain 18/s    maxHealth 100
regen 1.6 HP/s        regenDelay 5 s       chaosDampening 0
dashCooldown 2.2 s    dashDistance 5.4 m   xpMultiplier 1
```

Health is **attrition pressure, not the fail state.** Kid bumps do 3 damage (5
from chaotic types) on a 2.2 s per-kid cooldown, only while the kid is not
fleeing or leaving. Health regenerates 1.6/s after 5 seconds without damage.
This is deliberate — an early build died to health far more often than to Chaos,
which is thematically wrong.

### Run duration

`RUN_DURATION = 15 * 60` seconds.

---

## 6. Controls

| Input | Action |
|---|---|
| `W` `A` `S` `D` / arrows | Move (camera-relative) |
| `Shift` | Sprint — 1.5× speed, drains stamina |
| `Space` | Dash — 5.4 m burst, 0.3 s i-frames, 2.2 s cooldown |
| `Q` | Dewey Decimal Beam |
| `E` | Bookerang |
| `F` | Chromatic Shush |
| `R` | Mop (hold, when standing in a mess) |
| Mouse | Aim the beam (ground-plane raycast) |
| Mouse wheel | Zoom camera (clamped so it never exits the ceiling) |
| `Esc` | Pause in-game; back out of a menu screen |
| `` ` `` | Debug overlay (fps, draw calls, triangles, entity counts, seed) |
| `M` | Mute |
| `1` `2` `3` `4` | Pick an upgrade on the level-up screen |
| `R` (level-up) | Reroll, if you own Second Opinions |

**Gamepad:** left stick moves, right stick aims. Button map in
`src/core/input.js`: `0`→dash, `1`→mop, `2`→colorPulse, `3`/`5`→bookerang,
`4`/`6`→gravityGun, `7`→sprint, `9`→pause.

---

## 7. Content catalogue

### 7.1 Branches (levels)

Defined in `src/data/themes.js`. Each re-skins the entire generator: floor and
wall materials, colour palette, lighting, ceiling height, item dimensions, prop
sets, lamp type, music mood, and hazard items.

| Branch | Unlocks at | Ceiling | Item size (w×h×d, m) | Notes |
|---|---|---|---|---|
| **The Grand Library** (`library`) | 0 XP | 16.0 m | 0.052 × 0.245 × 0.175 | Mahogany, marble, warm pendant lamps |
| **Blockbuster Nite** (`videostore`) | 12,000 XP | 8.2 m | 0.028 × 0.19 × 0.105 | VHS, patterned carpet, cool neon |
| **Groove Merchant Records** (`recordstore`) | 34,000 XP | 9.5 m | 0.014 × 0.31 × 0.31 | Vinyl, warm wood, orange light |
| **MegaMart Superstore** (`grocery`) | 68,000 XP | 9.8 m | 0.09 × 0.2 × 0.09 | Lino, fluorescent strips, hazard foods |

Unlocks are gated on **lifetime XP**, accumulated across all runs.

### 7.2 Item colours

Six or eight colour families per theme, from `ITEM_COLORS`:

`crimson 0x7e2229` · `cobalt 0x24406e` · `forest 0x27543a` · `amber 0x9a6f22` ·
`plum 0x4e2a5e` · `teal 0x1d5560` · `rust 0x7d4327` · `slate 0x3a4550`

These are deliberately deep and desaturated — an earlier brighter set made the
shelves read as plastic Lego. Each has a matching bright `ui` hex used for HUD
swatches, the compass and minimap dots.

### 7.3 Grocery hazard items

Only in the `grocery` branch. When a kid knocks an item off, each hazard rolls
independently:

| Item | Chance | Effect on pickup |
|---|---|---|
| Banana Peel | 9% | `slip` — 90% loss of steering authority |
| Super Mushroom | 5% | `grow` — 1.55× scale for 12 s, −14% speed |
| Ghost Pepper | 5% | `spicy` — +35% speed for 8 s |
| Watermelon | 4.5% | `heavy` — −42% speed for 6 s, no sprint |
| Egg Carton | 4% | `fragile` (flagged, no effect wired yet) |
| Shaken Soda | 4% | `fizz` — particle burst + camera shake |

The `videostore` also has a 5% Spilled Popcorn (`slip`).

### 7.4 Shelf styles

`src/data/shelfStyles.js`. Dimensions are **locked per style** — this is what
makes the whole building instanceable.

| Style | Tiers | Height | Depth | Double-sided |
|---|---|---|---|---|
| `tall` | 5 | 2.55 | 0.62 | yes |
| `archive` | 6 | 2.90 | 0.72 | yes |
| `wall` | 5 | 2.80 | 0.46 | no |
| `kids` | 3 | 1.22 | 0.55 | yes |
| `island` | 3 | 1.36 | 0.70 | yes |
| `curved` | 5 | 2.45 | 0.60 | yes |

Bay width is a global `BAY_WIDTH = 1.0 m`. Slots per tier are derived from item
width: `clamp(round(1.0 / (itemWidth * 1.55)), 6, 16)`.

**Bay capacity overflow:** a bay accepts up to `capacity + ceil(capacity * 0.25)`.
This exists to prevent a softlock — see [§22](#22-bugs-found-and-fixed).

### 7.5 Kid types

`src/entities/kid.js`. `grab` is the number of ransack actions before the kid
leaves. `weight` is the spawn-table weight.

| Type | Speed | Grabs | Weight | Height | Dump range | Unlocks |
|---|---|---|---|---|---|---|
| Curious Reader | 2.5 | 1 | 40 | 1.12 | 3–6 m | 0:00 |
| Chatty Pair | 2.8 | 2 | 26 | 1.20 | 4–8 m | 1:30 |
| Hide-and-Seeker | 4.4 | 1 | 18 | 1.08 | 6–11 m | 4:00 |
| Snack Smuggler | 2.2 | 4 | 12 | 1.28 | 3–7 m | 7:00 |
| Tornado Toddler | 3.4 | 3 | 10 | 0.92 | 2–5 m | 10:00 |

**Kid FSM:** `SEEK → RANSACK → (CARRY → dump) → IDLE (browse 2.5–5.5 s) → SEEK`,
with `FLEE` interrupting whenever the player comes within `repelRadius` (1.8 m
base, +0.8 m if holding an item), and `LEAVE` when grabs are exhausted or the
kid is calmed.

**Calming:** startling a kid three times while it holds nothing makes it leave
(+28 XP, counts toward `kidsCalmed`).

### 7.6 Bosses

`src/entities/bosses.js`. All bosses have a **patience timer**; if it expires
they leave with no reward. This exists so an undefeated boss can never become
permanent, unwinnable pressure.

| Boss | HP | From | Patience | Chaos pressure | How you beat it |
|---|---|---|---|---|---|
| **Braden the Bully** | 100 | 3:00 | 105 s | 0.14 | He permanently sprints away, stripping shelves he passes (2 items / 3.4 s). Stay within 2.1 m to deal 46 dps. |
| **A Karen** | 140 | 6:00 | 85 s | 0.16, 0.42 when within 6 m | Follows you at 2.6 m shouting, slowing you 18%. Demands 8 items of one specific colour; each one filed damages her. |
| **Poorly Percy** | 70 | 8:00 | 80 s | 0.12 + 0.3/puddle | Rare (×0.35 weight). Wanders and is sick every 7–12 s. Mop each puddle (26 s timer). Standing near him also calms him. |
| **Field Trip Chaperone** | 180 | 12:00 | 95 s | 0.34 | Marches between shelves; every 9 s the whistle strips 3 bays × 2 items and spawns a kid. Confront within 2.2 m for 30 dps. |

Defeat rewards: +600 XP, −12 Chaos, a banner, and a particle blowout. The Bully
additionally scatters 10 items on death.

### 7.7 Disasters

`src/systems/disasters.js`. Each runs **telegraph (2.6 s warning) → active →
recover**, scaled by the player's `mitigation` and `durationScale` (from Fire
Drill and Buildings Insurance).

| Disaster | From | Weight | Duration | Behaviour |
|---|---|---|---|---|
| **Earthquake** | 2:00 | 30 | 11 s | Camera trauma; every 0.7 s, 1–4 nearby bays lose an item; ceiling dust; occasional screen-space shockwave. ~45 items total. |
| **Tornado** | 5:00 | 24 | 20 s | A visible 5-layer funnel wanders (biased toward the player when far). Strips 2 bays/s within 6.5 m, swirls loose items tangentially, drags the player and can make them drop everything. |
| **Volcano** | 9:00 | 16 | 26 s | A rock cone grows through the floor with a lava pool and ember fountain. Every 2.4 s a telegraphed ring precedes a lava bomb that strips 2 bays and scorches the floor. Standing in the pool damages you. Adds lens distortion. |
| **Alien Invasion** | 12:00 | 14 | 30 s | A metal saucer with a glass dome and a visible pilot hovers over shelves and abducts items with a tractor beam (2 items / 1.25 s), which then rain down. |

Surviving a disaster: +320 XP.

### 7.8 In-run upgrades (draft pool)

`src/data/upgrades.js`. 20 upgrades. Draft weighting: an upgrade you already own
is 3.2× more likely to appear (so builds converge), and an unowned *power* is a
further 2× more likely (so the signature toys show up early).

**Signature powers**

| Upgrade | Key | Max | Scaling |
|---|---|---|---|
| **Dewey Decimal Beam** | Q | 6 | range `9+3L` m · cooldown `max(1.2, 6.5·0.82^(L-1))` s · targets `2+L` · beam width `2.0+0.35L` m |
| **Bookerang** | E | 6 | range `12+4.5L` m · cooldown `max(1.0, 5.0·0.85^(L-1))` s · files `1+L` items per throw |
| **Chromatic Shush** | F | 7 | radius `9+4L` m · cooldown `max(4, 16·0.86^(L-1))` s · colours `min(4, 1+floor(L/2))` |
| **Cavernous Backpack** | — | 5 | `+2L` carry slots; at L3+ `returnRadius = 2.4 + 0.9(L-2)` |

**Passives** — Comfy Shoes (speed ×1.08/L, max 6), Improbably Long Arms (pickup
+0.55/L, 6), Shelf Sense (return +0.7/L, 5), Zen Focus (chaos −5%/L, 6), Reading
Glasses (XP +10%/L, 5), Stair Workouts (stamina, 5), Track Coach (sprint, 4),
Emergency Scoot (dash, 4), Laminated Badge (+25 HP/L, 4), Tea Trolley (heal 6
every `12−2L` files, 4), "QUIET PLEASE" Sign (freeze chaos `3+L` s every `60−8L`
s, 4), Kid Whisperer (repel + slow aura, 4), Janitor's Keys (mop speed; L3
auto-cleans, 3), Overdue Fines (combo, 4), Cartographer's Eye (compass reach,
minimap intel, 3), Fire Drill Training (disaster mitigation, 4).

**How the beam interacts with kids:** the Dewey Decimal Beam and Chromatic Shush
both **rip items out of kids' hands** and startle them. This is the intended
counterplay to carry-away.

### 7.9 Meta upgrades (Staff Development)

`src/data/meta.js`. 16 perks bought with Library Cards. Costs scale per level.

`tenure` (+2 carry/L, 5) · `goodShoes` (+4% base speed/L, 5) · `sturdySpine`
(+20 HP/L, 5) · `espresso` (stamina, 4) · `longReach` (+0.3 m pickup/L, 4) ·
`beamLicence` / `boomerangLicence` / `colourTheory` (start with that power at
level L, 3 each) · `unionRep` (chaos −4%/L, 4) · `overtime` (+8% XP and cards/L,
5) · `rolodex` (4th draft choice, 1) · `rerolls` (L free rerolls/run, 3) ·
`secondWind` (survive one chaos death, 1) · `insurance` (disasters −15%/L, 3) ·
`headStart` (begin at level `1+L` with L upgrades drafted, 3) · `janitorial`
(mop speed +20%/L, 3).

Applied in `SaveData.applyMeta(player, progression)` at the start of every run.

### 7.10 Playable characters

`src/data/characters.js`. **Cosmetic only** — both handle identically.

- **Marion**, Head Librarian — 1.74 m, glasses, hair bun, purple cardigan.
- **Wolfe**, Weekend Shift — 1.80 m, chunk 1.05, maroon ball cap with a pale
  badge, full beard, red plaid flannel (long sleeves), blue jeans, brown boots.

Wolfe uses `matMap: { torso: 'flannel', armU: 'flannel', armL: 'flannel' }` and
`shirt: 0xffffff` so the procedural plaid texture supplies the colour rather
than a flat tint.

The character-select screen renders the **actual in-game rig** into each card via
`src/render/portrait.js`, so portraits cannot drift from the models. The choice
is remembered in `save.data.lastCharacter`.

---

## 8. Technology stack

| Layer | Choice | Version | Why |
|---|---|---|---|
| Language | Vanilla ES modules (JavaScript) | — | No build-step complexity, no types to maintain, directly debuggable in the browser console |
| Renderer | [three.js](https://threejs.org) | `0.185.1` | Mature WebGL2 abstraction with `InstancedMesh`, PMREM, and a shader-chunk system we patch in two places |
| Post-processing | [postprocessing](https://github.com/pmndrs/postprocessing) (pmndrs) | `6.39.4` | Merges multiple effects into single fragment shaders; far cheaper than three's own `EffectComposer` chain |
| Bundler / dev server | [Vite](https://vite.dev) | `8.2.1` | Instant HMR, near-zero config |
| Fonts | Google Fonts — Cinzel (display), Outfit (UI) | CDN | Only external dependency at runtime |
| Persistence | `localStorage` | — | No backend |

**Total dependency count: 2 runtime, 1 dev.** There is no game engine, no
physics library, no state-management library, no UI framework.

Build output: ~956 kB JS (288 kB gzipped), ~19 kB CSS, plus a 1.5 kB lazy chunk
for the portrait renderer.

---

## 9. Repository map

34 source files, ~10,850 lines.

```
.
├── index.html                 canvas + #ui root + font links
├── vite.config.js             base './', port 5273, target esnext
├── package.json               type: module
├── README.md                  player/contributor-facing overview
├── DESIGN.md                  this document
└── src/
    ├── main.js                bootstraps Game, restores settings, unlocks audio
    ├── game.js          397   orchestrator: state machine, run lifecycle, chaos,
    │                          scoring, the fixed update order, the rAF loop
    ├── core/
    │   ├── rng.js        99   mulberry32 seeded RNG, FNV-1a string hash,
    │   │                      value noise + fbm
    │   ├── input.js     129   keyboard/mouse/gamepad, edge detection
    │   ├── camera.js    137   chase rig, look-ahead, trauma shake, ceiling clamp,
    │   │                      screen↔world conversion
    │   ├── audio.js     378   WebAudio synthesiser: ~25 SFX + generative score
    │   ├── events.js     26   tiny pub/sub bus
    │   └── save.js      121   localStorage profile, meta application, unlocks
    ├── data/
    │   ├── themes.js    136   4 branches: materials, palettes, hazards, lighting
    │   ├── shelfStyles.js 14  6 locked carcass presets
    │   ├── upgrades.js  187   20 in-run upgrades + weighted draft
    │   ├── meta.js      119   16 permanent perks
    │   └── characters.js 53   2 playable librarians
    ├── world/
    │   ├── generator.js 817   BSP floor plan, 8 district archetypes, nav grid,
    │   │                      collider list, bay spatial index — pure data
    │   ├── level.js     992   layout → instanced meshes, lighting, atmosphere,
    │   │                      shelf fill state, occlusion dither
    │   ├── props.js     370   16 furniture builders + geometry merge helpers
    │   └── collision.js 252   circle-vs-OBB spatial hash + grid A* with
    │                          string-pulling
    ├── entities/
    │   ├── character.js 529   humanoid rig: skeleton, poser, geometry kit,
    │   │                      SoloCharacter (hero) + CrowdBatch (instanced kids)
    │   ├── player.js    350   movement, stamina, dash, vacuum, auto-file, effects
    │   ├── kid.js       549   7-state FSM, spawn ring, crowd rendering
    │   └── bosses.js    516   4 boss specs + shared Boss base + manager
    ├── systems/
    │   ├── items.js     366   600-item pool, 6-state machine, instanced render
    │   ├── powers.js    319   the three powers + QUIET PLEASE
    │   ├── disasters.js 584   4 disasters + the mess/mop system
    │   ├── director.js  147   difficulty beats, spawn cadence, adaptive events
    │   ├── progression.js 155 XP, levels, draft, rerolls, Second Wind
    │   └── fx.js        310   particles, rings, decals, beams — all pooled
    ├── render/
    │   ├── renderer.js  275   WebGLRenderer + post stack + quality presets
    │   ├── materials.js 212   ~30 shared PBR materials per theme
    │   ├── textures.js  674   procedural texture forge (canvas 2D → GPU)
    │   ├── environment.js 81  PMREM probe built from emissive panels
    │   └── portrait.js   97   offscreen character-select portraits
    └── ui/
        ├── hud.js       506   meters, minimap, compass, popups, banners
        ├── menus.js     419   all overlays; pinned back button; Esc handling
        └── style.css    508   full stylesheet
```

---

## 10. Runtime architecture

### State machine

`Game.state` ∈ `boot | menu | loading | playing | levelup | paused | gameover |
victory`.

### The frame

`Game._loop(now)` runs on `requestAnimationFrame`:

1. Clamp `dt` to 0.25 s (prevents tunnelling after a tab switch).
2. Update the FPS counter (0.5 s window).
3. `input.pollGamepad()`.
4. If `playing` → `_step(dt)`. If `levelup` → `_step(dt * 0.08)` (time crawls;
   reads as a beat, not a freeze). Otherwise just update the level and FX so the
   world stays alive behind menus.
5. Update the camera, DoF focus distance, and the chaos colour grade.
6. `hud.update(dt)`.
7. `renderer.info.reset()` then `composer.render(dt)`.
8. `input.endFrame()` (clears edge-triggered presses).

### Fixed update order inside `_step(dt)`

This order matters and should be preserved:

```
player.update      → movement, vacuum, auto-file
powers.update      → aim, fire, beam visuals, QUIET PLEASE
items.update       → physics, homing, returning
kids.update        → FSM, steering, crowd render
bosses.update      → boss behaviour, patience
disasters.update   → messes, active disasters
director.update    → beats, spawns, events
progression.update → Second Wind check
fx.update          → particles, rings, decals
level.update       → lights, motes, shelf glow, occlusion fade
items.render       → write instance matrices
_updateChaos       → accumulate/relieve, then check end conditions
```

### Ownership and teardown

`Game.disposeRun()` tears down every per-run system in order and then disposes
the material set. Textures are **cached and shared across runs** (in
`textures.js`), so they are deliberately *not* disposed; the materials wrapping
them are. Verified clean across 5 back-to-back level cycles with no growth in
geometry/texture/program counts.

---

## 11. Procedural level generation

`src/world/generator.js` — `generateLayout(seed, theme, options)`.

**It is pure data.** It imports no three.js. This means it runs in Node for
testing and completes in ~10 ms.

### Pipeline

1. **World bounds.** Default 172 × 172 m, 6 m margin for the perimeter wall.

2. **Grand boulevards.** A cross of two corridors, width 7–9.5 m, positioned
   near (but jittered from) the centre. These exist purely for legibility: they
   guarantee long sight lines and a memorable landmark, and they stop the
   building reading as an undifferentiated maze.

3. **BSP partition.** Each of the four quadrants recursively splits until zones
   are between 19 m and 40 m. A corridor 3.4–5.4 m wide is carved at every split
   line. Recursion stops at depth 3 or on a 28% random chance, whichever first,
   unless a zone still exceeds 40 m.

4. **Archetype assignment.** The two largest districts are forced to `ATRIUM`
   and `ROTUNDA` (showpieces). One mid-sized district is forced to `CHILDREN`.
   The rest are weighted: stacks 40, reading 12, carrels 9, archive 9, gallery
   8, rotunda 7, children 6.

5. **Furnishing.** Each archetype has its own furnisher:

   - `furnishStacks` — parallel rows, aisle 3.0–4.0 m (2.2–2.7 dense), occasional
     mid-row breaks, aisle lighting, carts/stools/book stacks.
   - `furnishRotunda` — 2–3 concentric rings approximated by long straight arc
     segments (~5.5 m each), a centrepiece (globe/statue/fountain/card catalog),
     a ring of columns, a grand chandelier, a round rug.
   - `furnishAtrium` — wall shelving only, open middle, island displays, a
     centrepiece, a seating ring of armchairs, a **skylight** and light shaft.
   - `furnishReading` — perimeter shelving, a grid of tables with chairs, rugs,
     pendant lamps.
   - `furnishCarrels` — a grid of study carrels with chairs, one low shelf run.
   - `furnishChildren` — short low shelf runs at scattered angles, a story
     circle with a playful rug and beanbags, a puppet theatre, coloured globes.
   - `furnishGallery` — display vitrines down the centre, partition shelf walls,
     spot lighting.

6. **Colour regionalisation.** Each district picks a `dominant` and `secondary`
   colour. Bays roll 55% dominant / 20% secondary / 25% any. This makes wings
   visually distinct while guaranteeing a matching shelf is rarely far away.

7. **Perimeter.** Four walls, tall arched windows every 11 m (skipping corners),
   occasional window seats, plus a colonnade down both boulevards (every 13 m,
   kept clear within 13 m of the crossing so the landmark reads), boulevard
   chandeliers, and the **circulation desk** at the crossing.

8. **Rasterisation.** Every collider is an oriented bounding box, rasterised
   into a 1 m nav grid with a 0.42 m pad so agents don't clip corners. Borders
   are sealed.

9. **Spawn point.** Just off the crossing (so the player doesn't start inside
   the desk) with the landmark in frame.

10. **Bay spatial index.** Every bay's world position and outward normal is
    computed and bucketed into an 8 m grid for `queryBays()` / `nearestBay()`.

### Output shape

```js
{
  seed, theme, width, depth, ceilingHeight,
  zones[]      { id, type, rect, dominant, secondary, name, skylight?, playful? },
  shelfRuns[]  { id, zoneId, x, z, angle, length, height, depth, tiers, style,
                 doubleSided, bays[] },
  bays (via allBays / bayIndex)
               { runId, index, side, i, color, capacity, filled, tiers, slots,
                 wx, wz, nx, nz, run, globalIndex },
  props[], lamps[], chandeliers[], pillars[], rugs[], windows[],
  colliders[]  { x, z, angle, hw, hd, height, kind },
  landmarks[], corridors[], walls[],
  nav (Uint8Array), navCell, navW, navD,
  spawn, crossing,
  stats { runs, bays, capacity, zones }
}
```

### Typical scale

~135–205 shelf runs, ~2,800–4,300 bays, ~14,000–21,000 tier rows,
~200,000 shelvable items, ~31 districts, ~250–490 props, ~47–82 columns.

---

## 12. Rendering pipeline

`src/render/renderer.js`.

### Renderer configuration

- `antialias: false` (SMAA and optional MSAA handle it in post)
- `outputColorSpace: SRGBColorSpace`
- `toneMapping: NoToneMapping` — tone mapping happens **in post**, so bloom
  operates on linear HDR values
- `shadowMap: PCFSoftShadowMap`
- `info.autoReset = false` — reset manually per frame so the debug overlay can
  report totals across every pass

### Quality presets

| Preset | Pixel ratio | Shadow map | SSAO | DoF | MSAA | Dust motes |
|---|---|---|---|---|---|---|
| `low` | 0.75 | 1024 | ✗ | ✗ | 0 | 300 |
| `medium` | 1.0 | 2048 | ✓ | ✗ | 0 | 700 |
| `high` | 1.0 | 3072 | ✓ | ✓ | 2 | 1400 |
| `ultra` | 1.35 | 4096 | ✓ | ✓ | 4 | 2400 |

Auto-detected from `hardwareConcurrency`, `deviceMemory`, `devicePixelRatio`
and a mobile UA check; overridable in Settings and persisted.

### Post-processing chain

```
RenderPass
NormalPass + DepthDownsamplingPass       (only when SSAO is on)
EffectPass(SSAO)                          multiply blend, distance-scaled
EffectPass(DepthOfField)                  own pass — convolution effect
EffectPass(ShockWave, LensDistortion, Bloom, ToneMapping(AgX),
           HueSaturation, BrightnessContrast, Vignette, Noise)
EffectPass(ChromaticAberration)           own pass — convolution effect
EffectPass(SMAA)                          own pass — convolution effect
```

> **Critical constraint:** the `postprocessing` library throws
> `"Convolution effects cannot be merged"` if two convolution effects share an
> `EffectPass`. DoF, chromatic aberration and SMAA are each convolution effects
> and **must** stay in their own passes. This was the first crash of the project.

**Dynamic post parameters:**

- `setFocusDistance(m)` drives the DoF `cocMaterial.focusDistance` from the
  live camera distance each frame, with `focusRange = max(16, m*1.6)`. Without
  this the whole scene blurred.
- `setChaosGrade(0..1)` pushes vignette darkness 0.62→1.37, desaturates,
  shifts hue, widens chromatic aberration and raises contrast as Chaos climbs.
- `shockwave(worldPos, opts)` for quakes, boss slams and Chromatic Shush.
- `setLensDistortion(x, y)` for the volcano.

### Instancing strategy

This is the core of the performance story.

- **Everything repeated is an `InstancedMesh`**, and instanced meshes are
  grouped **by district** (`zoneId`), so frustum culling can discard whole wings
  of the building in one test. A single global instanced mesh would never cull.

- **A shelf tier is one box, not twelve books.** Each `(bay, tier)` is a single
  instance of a box whose ±Z faces sample a shared 12-spine texture and whose
  other faces sample a page-edge band baked into the top 15% of the same
  texture. Per-instance colour, a deterministic depth recess (0.035–0.11 m),
  height jitter (0.94–1.04×) and a lean on partly-empty rows make a run of
  shelving read as thousands of individual volumes.

- **Fill state is the instance X scale.** As items are taken the box scales down
  from one end, so a gap opens in the shelf exactly where books were removed,
  and a partly-emptied row tips over. `Level.refreshBay(bay)` recomputes this.

- **Two geometry variants** per style (`VARIANTS = 2`) with different baked UV
  offsets, so adjacent rows never show identical spines.

- **Carcasses** (divider, plinth, boards, back, crown) are one instance per bay,
  per district, per style.

- **Empty-slot glow** is one additive quad per bay whose instance colour encodes
  both the bay's hue and its emptiness — invisible when full, bright when
  stripped.

- **Characters** are posed on the CPU into a flat matrix list and written into
  instanced body-part meshes. Thirty kids cost the same nine draw calls as one.

### Lighting

- A baked **PMREM environment probe** built from a scratch scene of emissive
  panels (`environment.js`): cool clerestory slabs, warm pendant ring, floor
  bounce, ceiling wash. This does most of the ambient work.
- One **directional sun** whose 26 × 26 m orthographic shadow frustum rides with
  the player.
- A **pool of 3–8 point lights** that re-latch every 0.25 s onto whichever
  fixtures are nearest the player, with distance fade.
- A dedicated warm **key light** on the player so the hero always reads.
- Everything else is emissive geometry plus the probe.

### Atmosphere

- `FogExp2` with density `1.6 / theme.fog.far`.
- Additive **light shafts**: two crossed, splayed, tilted sheets per window;
  a soft cone under each skylight.
- **Dust motes** — a `Points` cloud that drifts upward and wraps into a 44 m box
  centred on the player.

### Occlusion fade

Columns are the only geometry tall enough to hide the player. `Level._updateOcclusion`
computes each column's distance from the camera→player segment in plan and
lerps an `aFade` instanced attribute toward 0.12 when it blocks. A custom
material clone (`makeFadeMaterial`) patches the shader with a screen-space 4×4
**Bayer dither** and discards fragments below the threshold — so the column
stipples away instead of blinking out, with no transparency, no sorting and no
extra draw call.

---

## 13. Procedural texture forge

`src/render/textures.js`. Every generator paints into a 2D canvas and uploads a
`CanvasTexture`. Results are memoised by parameter key and shared across runs.

| Generator | Produces | Technique |
|---|---|---|
| `woodFloor` | map, roughness, normal | Staggered planks, per-plank tone, wavering grain strokes, elliptical knots, seam grooves, varnish sheen, wear patches |
| `marble` | map, roughness | Three passes of random-walk vein networks, cloudy mineral blotches |
| `rug` | map | Persian layout: field, border bands, repeating diamonds, central medallion, floral knots |
| `shelfWood` | map, normal | Cathedral grain arches (quarter-sawn oak signature) plus fine straight grain |
| `bookSpines` | map, roughness, normal | 12 tiles: cylindrical shading, head/tail caps, gold foil rules, title panels, cloth-vs-gloss roughness, shelf wear; **plus a page-edge band baked into the top 15%** |
| `plaid` | map | Translucent bands laid in both axes so crossings darken naturally, cream over-check, brushed-cotton fuzz |
| `pageEdge` | map | Ruled page lines with age foxing |
| `plaster` | map, normal | Layered soft blotches |
| `radialAlpha` | alpha | Analytic radial falloff — contact shadows, item markers, decals |
| `moteSprite` | sprite | Radial gradient |
| `grime` | overlay | Soft dirt blotches |

`heightToNormal(canvas, strength)` Sobel-differences a grayscale height canvas
into a tangent-space normal map; used by the wood, shelf and plaster generators.

---

## 14. Character rig

`src/entities/character.js`. No skinning, no animation clips, no assets.

### Skeleton

16 bones: `HIPS, TORSO, HEAD, HAIR, ARM_U_L/R, ARM_L_L/R, HAND_L/R,
LEG_U_L/R, LEG_L_L/R, SHOE_L/R`, defined as a parent list and flattened by
matrix multiplication.

### Proportions

All expressed as fractions of total height, so one rig covers a 0.92 m toddler
and a 1.82 m adult. Kids automatically get proportionally larger heads
(`headR` scales up as height drops below 1.75 m).

Two proportion decisions that mattered:
- `shoulderW = torsoW * 0.5 + limbR * 0.82` — arms must sit *outside* the
  ribcage or limbs merge with the torso into one blob.
- Idle elbow bend is only −0.09 rad; the original −0.35 made everyone stand
  like a zombie.

### Poser

`poseSkeleton(out, proportions, anim, rootMatrix)` takes an animation state and
writes 16 world matrices. Channels:

`phase` (advances with distance travelled, so feet never skate) · `speed` ·
`lean` · `armMode` (`swing | carry | overhead | reach | panic`) · `headYaw` ·
`headPitch` · `flail` · `crouch` · `hurt` · `celebrate` · `reach` · `sit`

### Geometry kit

`buildBodyGeometry(p, style)` assembles body parts from primitives. Style
options: `hair` (`short | bun | long | spiky | pigtails | bald`), `glasses`,
`apron`, `cardigan`, `antenna`, `hat: 'cap'`, `beard: 'full'`,
`sleeves: 'short' | 'long'`.

The cap and beard are **separate geometries** from the hair so they can take
their own colours and materials.

### Two consumers

- **`SoloCharacter`** — a real `Object3D` hierarchy (~20 meshes), used for the
  player and bosses, where per-character material overrides matter. Supports
  `matMap` to swap the material of any slot (this is how Wolfe's flannel works).
- **`CrowdBatch`** — `InstancedMesh` per body part, plus parallel instanced
  meshes per hairstyle. `begin() / push(...) / end()` each frame. Capacity 40
  (small kids) and 24 (larger kids).

---

## 15. Collision and pathfinding

`src/world/collision.js`.

### `CollisionWorld`

A uniform 4 m spatial hash over the layout's OBB collider list.
`resolve(x, z, r, out)` pushes a circle out of every overlapping box, up to 3
iterations, ejecting along the shallowest axis when deeply penetrating.
`lineOfSight(x0,z0,x1,z1)` samples the nav grid.

### `PathFinder`

Grid A* over the 1 m nav grid with:
- Octile heuristic weighted ×1.08 (faster, near-optimal)
- No diagonal corner-cutting through shelf ends
- Epoch stamping instead of clearing arrays between searches
- Linear-scan open set (fine at this scale)
- Goal/start **snapping** to the nearest walkable cell within radius 4
- **String-pulling** simplification so agents cut corners naturally

**Throttling:** `KidManager` grants a budget of 3 path computations per frame
across the whole crowd. Agents use straight-line steering whenever line of sight
is clear and only pay for A* otherwise.

---

## 16. Item system

`src/systems/items.js`. A fixed pool of **600** items; nothing allocates during
gameplay.

### State machine

| State | Meaning |
|---|---|
| `FREE` | On the floor (or falling). Fair game. Drives Chaos. |
| `KID` | In a kid's hands, held overhead. Drives Chaos at 50% weight. |
| `CARRIED` | In the player's arms. |
| `FLYING` | Homing toward the player (vacuum or beam). |
| `RETURNING` | Homing into a shelf bay. |
| `DEAD` | In the free list. |

### Physics

Gravity −22 m/s², bounce with 0.32 restitution and spin damping, shelf-collision
pushback, then settling flat at rest height with a random yaw. Grounded items
get a pulsing radial floor marker in their own colour so they're findable on a
dark floor.

`knockOff(bay, count, opts)` checks the free list **before** decrementing
`bay.filled` — otherwise a saturated pool silently destroys items.

### Rendering

One `InstancedMesh` for the items themselves, one for the floor markers. The
loose-item geometry is a box whose ±Y faces sample one decorated spine tile
(reads as a hardcover) and whose edges sample the page band, plus a raised spine
strip along one long edge.

---

## 17. Audio synthesis

`src/core/audio.js`. No audio files.

### Graph

```
oscillators / noise bursts
   └─> optional biquad filter ─> ADSR gain ─> stereo panner ─┐
                                                             ├─> compressor ─> master ─> destination
   convolution reverb (2.6 s impulse, generated) ◀───────────┘
```

The reverb exists because a library is a big stone room and should sound like
one. The bus compressor stops a tornado clipping the mix. A hard voice cap of 42
prevents disaster spam from choking WebAudio.

### Sound effects (~25)

`step, pickup, shelve, combo, dash, thud, bookfall, laugh, zap, beam, whoosh,
boom, quake, alarm, splat, mop, powerup, levelup, ui, uiBig, error, bossHorn,
karen, alien, win, lose`.

Each is a short envelope over an oscillator or filtered noise. Panning is
derived from the sound's on-screen X position via `Game._panFor(x, z)`.

**Every numeric parameter is clamped** by `num(v, fallback, min, max)` before
reaching WebAudio — gameplay maths feeds this system directly and one NaN
permanently poisons an audio node.

### Generative score

A 250 ms tick scheduler over a 4-bar chord progression, per-theme scale and
root (`warm` aeolian, `synth`, `funk`, `muzak`). Layers enter with intensity,
which tracks the Chaos meter:

- Pad — always, opens up its filter as intensity rises
- Bass pulse — every 4 steps
- Arpeggio — above 0.18 intensity
- High sparkle — above 0.5
- Heartbeat — above 0.72

---

## 18. UI layer

DOM overlays, not canvas. `src/ui/`.

### HUD (`hud.js`)

Chaos meter with gradient fill, tick marks, a written caption
(`ORDERLY → A FEW STRAYS → GETTING MESSY → LOSING CONTROL → BEDLAM → TOTAL
ANARCHY`) and a critical pulse above 78%. Timer. Level/XP bar, health, stamina,
carry slots coloured by held item. Power buttons with radial cooldown wipes and
level pips. Combo counter. Boss health bars with objective hints. Effect chips.
Mop prompt with progress. Toasts, banners, and world-space XP popups projected
each frame.

**Minimap** — a static canvas of the whole floor plan (districts tinted by
dominant colour, shelf runs as strokes) drawn once, then rotated and translated
under a circular clip each frame, with live actors overlaid in screen space and
the current district named beneath.

**Compass** — an arrow at screen edge pointing to the nearest bay that will
accept something you're carrying, coloured to match. **On by default at
cartography level 1**, because without it the colour-matching rule is
undiscoverable.

### Menus (`menus.js`)

Main menu, level select, character select, Staff Development shop, settings,
loading, level-up draft, pause, results.

The overlay has a **pinned back button** that lives outside the scrolling sheet
plus Escape handling, so a long page can never strand the player.

---

## 19. Save data

`localStorage` key `librarian2.save.v1`.

```js
{
  lifetimeXP, cards, runs, wins, bestScore,
  bestByTheme: { [themeId]: score },
  meta: { [metaId]: level },
  settings: { quality, music, sfx, master },
  lastCharacter,
  seen: {}
}
```

Corrupt JSON is caught and the profile resets rather than hard-failing. Writes
are wrapped in try/catch for private-browsing mode.

---

## 20. Performance

Measured on the `ultra` preset in a desktop Chromium at 1280×720, mid-run with
11 kids, a boss and loose items:

| Metric | Value |
|---|---|
| Frame rate | 60 fps (vsync-locked) |
| Draw calls | ~390–545 |
| Triangles | ~2.1–2.6 M |
| Layout generation | ~10 ms |
| Headless simulation step | ~1.6 ms |
| Shelf bays | ~3,300 |
| Item pool | 600 |

> **Note when profiling in an automated browser:** `requestAnimationFrame` is
> throttled when the tab is backgrounded, which reports ~5–15 fps regardless of
> actual cost. Check `document.hidden` before believing an fps number. To measure
> real cost, time N back-to-back `render()` calls instead.

---

## 21. Balance history and rationale

The numbers in this game were not guessed. They were derived by running a
scripted bot through hundreds of simulated minutes and fixing what broke.
Recording the reasoning so it isn't undone by accident:

**Item production was ~10× too high at first.** The original earthquake dumped
~330 items per event, the tornado ~660, the volcano ~255, the aliens ~143, and
the Bully stripped 80 items *per minute*. A single disaster ended any run.
Targets now: kids produce ~16 items/min rising to ~36; each disaster ~45; each
boss ~50–70 across its entire visit.

**Kids never stopped ransacking.** The `CARRY → drop` transition didn't check
the remaining grab budget, so kids looped forever. Each kid now spends its
`grab` allowance, browses between raids (2.5–5.5 s), and leaves.

**Chaos was linear and lethal.** An idle player died in 76 seconds. Now it's
`load^0.8`, with a 90-second opening grace ramp and an active recovery term.

**Health was the fail state.** Kid bumps at 5–8 damage on a 1.2 s cooldown with
no regeneration killed the bot at minute 6 with Chaos at 3%. Bumps are now 3–5
on a 2.2 s cooldown, only from non-fleeing kids, with 1.6 HP/s regeneration
after 5 s. Chaos is the intended way to lose.

**Bosses were permanent pressure.** An unbeaten Karen added 1.5 %/s of Chaos
forever — 100% in 66 seconds. Pressures were cut ~4× and every boss now has a
patience timer.

**The director was blind.** It fired disasters into an already-buried player.
It now reads `items.floorCount`: above 55 it slows kid spawning by 70%,
suppresses ambient shelf-tipping, and postpones headline events (up to 3 times,
25 s each) waiting for a lull.

**Carry-away was too common.** At 55% base, most items ended up orphaned far
from a matching shelf. Now 30% + 1.1 points per elapsed minute, with tighter
dump ranges.

**Colours were too many and too bright.** Eight saturated families read as Lego
and gave you eight destinations to hold in your head. Now six deep, desaturated
families per theme.

**Where it currently sits:** a mechanical bot with pathfinding, powers and
greedy upgrade picks survives roughly 7–13 of the 15 minutes depending on seed.
A competent human should finish. This still needs human validation.

---

## 22. Bugs found and fixed

Documented so they are not reintroduced.

1. **`Convolution effects cannot be merged`** — DoF, chromatic aberration and
   SMAA each need their own `EffectPass`.

2. **Softlock: unfilable items.** Bays only accepted items when
   `filled < capacity`. You could end up carrying an armful of one colour with
   every matching shelf nominally full and no legal destination — the run simply
   stopped progressing. Fixed with `bayHeadroom()`: a bay accepts up to
   `capacity + 25%`. `nearestBay` search radius also raised to 140 m.

3. **Level-up screen could lock.** If every upgrade was maxed, `_openDraft`
   returned early leaving `state === 'levelup'` with no cards on screen.
   `_openDraft` now loops, converting surplus levels into health, and always
   resolves via `_resume()`.

4. **Level-up number keys stayed live.** The draft's `keydown` listener was
   never removed when the screen closed, so pressing `1` during gameplay could
   re-trigger a stale offer. Now detached in `hideAll()` and guarded on
   `currentOffer`.

5. **NaN poisoning the audio graph.** `_panFor` could return NaN (stale camera
   matrices), and one NaN permanently breaks a WebAudio node. Fixed at both
   ends: `_panFor` refreshes the camera matrices and guards, and every audio
   parameter is clamped by `num()`.

6. **CSS class collision.** The level-up draft's `.card.power` modifier matched
   the HUD's `.power` button rules and collapsed the cards to 62 px squares.
   HUD rules are now scoped to `.powers .power`.

7. **Menu overlay could not scroll.** `#ui > * { pointer-events: none }` had ID
   specificity and beat `.overlay.on { pointer-events: auto }`, so the scroll
   container never received wheel events — the wheel went through to the canvas
   and zoomed the camera instead. On a long page (Staff Development) this
   trapped the player with the back button below the fold. Fixed the specificity
   and added a pinned back button plus Escape.

8. **Inverted vertical movement.** `camera.inputToWorld` mapped screen-up to the
   camera's *own* offset direction rather than its negation, so W moved toward
   the camera. Left/right were unaffected, which is why only W/S felt wrong.
   Now derived from explicit forward/right basis vectors.

9. **Per-run leaks.** ~30 materials and the PMREM environment render target were
   never released between runs. `buildEnvironment` now returns the render target
   (caller owns disposal) and `disposeRun` disposes the material set.

10. **Item loss on a saturated pool.** `knockOff` decremented `bay.filled`
    before confirming a free pool slot, destroying items.

11. **Wall shelving faced backwards.** Runs on the far edge of a district used
    angle 0, pointing their open face into the wall. Angles are now chosen so
    each run's outward normal points into the room.

12. **`instanceColor` requires `vertexColors: true` AND a `color` attribute.**
    three's fragment `color_fragment` chunk is gated on `USE_COLOR`, and a
    missing `color` attribute makes WebGL feed the shader black. Hence
    `ensureColorAttr()`.

13. **Backgrounded-tab `rAF` stalls loading.** `startRun` awaited
    `requestAnimationFrame`, which never fires in a hidden tab. The yield is now
    raced against a 60 ms timer.

---

## 23. Testing recipes

The game exposes `window.__game`. These were used throughout development and
are the fastest way to validate a change.

### Headless simulation

`Game._step(dt)` advances the whole simulation without rendering. ~1.6 ms/step.

```js
const g = window.__game;
for (let i = 0; i < 30 * 60 * 5; i++) {   // 5 simulated minutes at 30 Hz
  if (g.state !== 'playing') break;
  g._step(1 / 30);
}
console.log(g.run.chaos, g.run.shelved, g.progression.level);
```

### Scripted balance bot

Drives the real input layer, uses the real pathfinder, fires powers and drafts
upgrades. Paste into the console after a run has started.

```js
window.__setup = function () {
  const g = window.__game;
  const st = { path: null, i: 0, t: 0, goal: null, keys: new Set() };
  g.input.wasPressed = (a) => st.keys.has(a);
  g.input.isDown = (a) => a === 'sprint' || st.keys.has(a);
  g.input.moveVector = function () {
    const p = g.player; let gx = null, gz = null;
    if (p.carried.length >= Math.max(2, p.stats.carrySlots * 0.5)) {
      const b = p.guidanceTarget(); if (b) { gx = b.wx + b.nx; gz = b.wz + b.nz; }
    }
    if (gx === null) { const it = g.items.nearestFree(p.x, p.z, 120); if (it) { gx = it.x; gz = it.z; } }
    if (gx === null) { const b = p.guidanceTarget(); if (b) { gx = b.wx + b.nx; gz = b.wz + b.nz; } }
    if (gx === null) { gx = g.layout.crossing.x; gz = g.layout.crossing.z; }
    st.t -= 1 / 30;
    if (!st.goal || Math.hypot(st.goal.x - gx, st.goal.z - gz) > 2.5 || st.t <= 0 || !st.path) {
      st.goal = { x: gx, z: gz }; st.t = 0.5;
      st.path = g.pathfinder.find(p.x, p.z, gx, gz) || [{ x: gx, z: gz }]; st.i = 0;
    }
    while (st.i < st.path.length - 1 && Math.hypot(st.path[st.i].x - p.x, st.path[st.i].z - p.z) < 1.0) st.i++;
    const wp = st.path[Math.min(st.i, st.path.length - 1)];
    const dx = wp.x - p.x, dz = wp.z - p.z, len = Math.hypot(dx, dz) || 1;
    // Inverse of camera.inputToWorld: turn a desired world direction back into
    // screen-space stick input. Keep this in sync if inputToWorld ever changes.
    const c = Math.cos(g.camera.yaw), s = Math.sin(g.camera.yaw);
    const wx = dx / len, wz = dz / len;
    return { x: wx * c - wz * s, y: wx * s + wz * c };
  };
  window.__botTick = function () {
    st.keys.clear(); const p = g.player;
    if (g.disasters.currentMess) st.keys.add('mop');
    if (g.powers.ready('colorPulse') && g.items.floorCount > 8) st.keys.add('colorPulse');
    else if (g.powers.ready('bookerang') && p.carried.length >= 2) st.keys.add('bookerang');
    else if (g.powers.ready('gravityGun') && !p.isFull && g.items.floorCount > 0) {
      const it = g.items.nearestFree(p.x, p.z, 20);
      if (it) { g.powers.aimPoint.set(it.x, 0.9, it.z); st.keys.add('gravityGun'); }
    }
    let guard = 0;
    while (g.progression.currentOffer && guard++ < 12) {
      const o = g.progression.currentOffer;
      g.progression.choose((o.find((u) => u.kind === 'power') || o[0]).id);
    }
  };
};

window.__sim = function (seconds) {
  const g = window.__game; const errs = [];
  for (let i = 0; i < 30 * seconds; i++) {
    try { window.__botTick(); if (g.state !== 'playing') break; g._step(1 / 30); }
    catch (e) { errs.push(String(e.stack || e).slice(0, 240)); if (errs.length > 2) break; }
  }
  return { errs, state: g.state, min: +(g.run.elapsed / 60).toFixed(1),
           peak: g.run.peakChaos | 0, lvl: g.progression.level,
           filed: g.run.shelved, floor: g.items.floorCount,
           bosses: g.run.bossesBeaten, dis: g.run.disastersSurvived };
};

// usage:
// window.__game.audio.mute(true);
// window.__game.startRun({themeId:'library', seed:'x'}).then(()=>{ window.__setup(); console.log(window.__sim(60*8)); });
```

> **Caveat — read before drawing balance conclusions.** The bot is a weak proxy
> with very high variance. On a cooperative layout it keeps the floor at zero and
> files ~12 items/min indefinitely; on others it oscillates between two goals,
> re-pathing every 0.5 s and resetting its waypoint index, and files almost
> nothing for minutes at a time. Observed spread on comparable six-minute
> windows: 4 to 100+ items filed.
>
> A stalled bot run is **not** evidence that the game is unbalanced. Always check
> whether the player is actually moving (log per-interval displacement, as in the
> `__diag3` recipe used during development) before changing any tuning numbers.
> Use the bot to catch crashes, runaway item production, softlocks and leaks —
> not to set difficulty.

### Verifying movement direction

Movement must be checked in *screen* space, not world space:

```js
const g = window.__game, cam = g.render.camera;
const toScreen = () => { const v = new (g.camera.smoothed.constructor)(g.player.x, 1, g.player.z);
  cam.updateMatrixWorld(); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  v.project(cam); return { x: v.x, y: v.y }; };
const test = (code) => { g.player.vx = 0; g.player.vz = 0; const a = toScreen();
  window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  for (let i = 0; i < 25; i++) g._step(1 / 60);
  window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  const b = toScreen(); return { dx: +(b.x - a.x).toFixed(3), dy: +(b.y - a.y).toFixed(3) }; };
// Expected: W dy>0, S dy<0, A dx<0, D dx>0
```

### Generator validation from Node

```bash
node --input-type=module -e "
import { generateLayout } from './src/world/generator.js';
import { THEMES } from './src/data/themes.js';
for (const id of Object.keys(THEMES)) {
  const L = generateLayout('seed-' + id, THEMES[id]);
  console.log(id, L.stats, 'spawnClear',
    !L.nav[Math.floor(L.spawn.z / L.navCell) * L.navW + Math.floor(L.spawn.x / L.navCell)]);
}"
```

### Teardown / leak check

```js
(async () => { const g = window.__game;
  for (const t of ['library','videostore','recordstore','grocery','library']) {
    await g.startRun({ themeId: t, seed: 'cycle-' + t });
    for (let i = 0; i < 60; i++) g._step(1/30);
  }
  console.log(g.render.renderer.info.memory, g.render.renderer.info.programs.length);
})();
```

---

## 24. Conventions and gotchas

- **`src/world/generator.js` must never import three.js.** Keeping it pure data
  is what makes it testable from Node and fast.
- **Shelf dimensions are locked per style.** Never let a caller pass arbitrary
  height/depth/tiers — instancing depends on the presets.
- **Any material with `vertexColors: true` needs a `color` attribute** on its
  geometry. Use `ensureColorAttr()` or `mergeParts()` (which adds one).
- **`instanceColor` only works if the material also sets `vertexColors: true`.**
- **Class names are global.** The HUD and the menus share one stylesheet; scope
  new HUD rules under their container (`.powers .power`, not `.power`).
- **Avoid ID-specificity rules in `#ui`.** They beat class-based state rules and
  caused the un-scrollable overlay.
- **`Math.random()` is fine for cosmetics; use the seeded `RNG` for anything
  that must be reproducible from a seed.** Systems fork their own stream:
  `game.rng.fork(1337)` for kids, `.fork(99)` bosses, `.fork(4242)` disasters,
  `.fork(7)` director, `seed + '-draft'` for the upgrade draft.
- **Pools never allocate mid-frame.** Items, particles, rings and decals are all
  fixed-size.
- **`Level.refreshBay(bay)` must be called** after any change to `bay.filled`,
  or the shelf visuals desync from the simulation.
- **Textures are cached and shared across runs; materials are not.** Dispose
  materials in `disposeRun`, never the cached textures.

---

## 25. Known gaps and next steps

Ordered roughly by value.

1. **Human playtesting.** The single biggest gap. All balance is bot-derived.
2. **The Bookerang is not a physical projectile.** It currently files carried
   items at range instantly rather than arcing out and back. This read better in
   practice, but a real arcing projectile with a return path would be more
   satisfying and truer to the name.
3. **`fragile` (Egg Carton) hazard is flagged but has no effect wired.**
4. **The grocery `shelfWood` material** reuses the oak grain texture tinted
   grey; a dedicated brushed-metal generator would suit the supermarket better.
5. **No tutorial.** The compass and toasts carry the teaching load.
6. **No audio mix ducking** — music does not duck under big SFX.
7. **Characters are cosmetic.** Per-character passives (e.g. Marion +pickup
   radius, Wolfe +carry slots) would deepen the choice, at the cost of needing
   re-balancing.
8. **Boss variety within a run.** Only one instance of each boss type can be
   alive at once, and the roster is four.
9. **No leaderboard / daily seed**, though the RNG is fully seeded and
   `startRun({ seed })` accepts one, so a daily challenge is a small addition.
10. **Mobile.** The `low` preset exists and touch input does not. Would need an
    on-screen stick and button layer.
11. **Bundle size** is ~956 kB (288 kB gzipped), essentially all three.js. Could
    be trimmed with a custom three build if it ever matters.
