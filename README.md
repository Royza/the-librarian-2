# Buffy: Cemetery Patrol

A procedural 3D action roguelite vertical slice built on the original *The
Librarian 2* engine. Play as Buffy Summers, patrol a generated moonlit cemetery,
stake rising vampires, and keep Hellmouth Activity under control until sunrise.

The cemetery is now the default experience. It uses an outdoor procedural
layout, simple generated geometry, the existing WebGL2 renderer and post stack,
the existing collision/pathfinding infrastructure, and a Slayer-specific draft
pool. The older library and retail branches remain in source while the new game
direction develops.

```bash
./start.sh       # installs dependencies when needed, then starts Vite
                 # http://localhost:5273
```

The equivalent manual commands and project checks are:

```bash
npm ci
npm run dev
npm test         # deterministic mechanics + lifecycle + reachability suite
npm run build    # production bundle in dist/
npm run preview  # production build at http://localhost:4173
```

Use a current Node.js LTS release (Node 22 is the tested path). For ordinary
play and development, `./start.sh` is the quickest route; arguments are passed
through to Vite (for example, `./start.sh --host 0.0.0.0`). Use `npm run build
&& npm run preview` when judging the optimized production bundle. Do not open
`index.html` directly from disk because ES modules and browser security rules
expect an HTTP server.

Runs in any WebGL2 browser, including Firefox. **There are no asset files** — every texture,
material, character, sound effect and piece of music in the game is generated in
code at boot.

---

## Cemetery patrol loop

1. Vampires rise from graves and crypt areas with varied health, speed, and appearance.
2. Use `Q` for a forgiving stake attack, `E` for a stronger sweeping kick, and `Space` to dodge.
3. Active vampires increase Hellmouth Activity; slaying them lowers it and awards XP.
4. Draft coherent Slayer upgrades such as stake damage, attack speed, healing, dodge distance, and critical staking.
5. Keep activity below 100% and survive until sunrise.

## Legacy library loop

1. **Kids arrive.** They pull items off shelves. Some drop them where they stand;
   some sprint off and dump them somewhere inconvenient.
2. **Items on the floor raise Chaos.** Pressure grows sub-linearly with the size
   of the mess, and faster the later it gets.
3. **You vacuum items up** just by getting near them, and **file them
   automatically** when you're beside a shelf bay of the matching color.
   The compass at the edge of the screen always points at the nearest one.
4. **Filing gives XP and combos.** Level up, draft one of three upgrades.
5. **Survive fifteen minutes.** Bosses and disasters arrive on a schedule
   designed to keep breaking your rhythm.

Lose at Chaos 100% or when health reaches zero. Chaos is the primary fail state;
health is recoverable attrition pressure and regenerates when you're left alone.

## Legacy characters

Pick your librarian at the start of every shift. Each has a small side-grade
that changes routing without making one a strict upgrade.

* **Marion**, Head Librarian — +0.35 m pickup reach and +0.2 m filing reach,
  but one fewer carrying slot.
* **Wolfe**, Weekend Shift — the broad-faced, blue-gray-eyed librarian in the
  black logo cap and charcoal plaid overshirt; two extra carrying slots, but
  moves 3% slower.

The select screen renders the actual in-game rig into each card, so the
portraits can never drift from the models.

## Controls

| | |
|---|---|
| `WASD` / arrows | Move |
| `Shift` | Sprint (costs stamina) |
| `Space` | Dash (brief invulnerability) |
| `Q` | **Stake attack** — Buffy turns toward the nearest vampire in range and lunges |
| `E` | **Slayer kick** — slower, stronger, wider attack with heavy knockback |
| Left-mouse drag | Orbit the camera horizontally and vertically (inverted by default; change it in Settings) |
| Mouse move / wheel | Aim the beam / zoom the camera |
| `Esc` | Pause · `` ` `` Debug overlay · `M` Mute |

Full gamepad support: left stick moves, right stick aims, `A` dashes,
`Y`/`RB` kicks, `LB`/`LT` stakes, `RT` sprints, and Start pauses. Keyboard
controls can be remapped in Settings. The legacy branches retain their beam,
Bookerang, Chromatic Shush, and mop actions on the same configurable bindings.
The full Settings screen is also available from Pause, so camera, audio, display,
and accessibility preferences can be changed without abandoning a shift.

The first cemetery patrol presents a one-time quick brief without pausing the
run. Legacy branches retain their longer action-driven first-shift tutorial.
Tutorials can be disabled or reset from Settings.

## Branches

Each unlocks through either lifetime XP or wins and changes both the generated
venue and its active objective.

| | Branch | Objective | Unlocks at |
|---|---|---|---|
| 📚 | **The Grand Library** — circulation desk, coffered ceiling, arched windows, books | Chain 12-item Dewey streaks | default |
| 📼 | **Blockbuster Nite** — rental counter, movie marquees, black ceiling grid, VHS cases | Beat timed rewind requests | 12,000 XP or 1 win |
| 💿 | **Groove Merchant Records** — listening counter, album walls, exposed rafters, square vinyl sleeves | File three-color setlists in order | 34,000 XP or 3 wins |
| 🛒 | **MegaMart Superstore** — checkout lanes, freezer walls, grocery gondolas, recognizable food | Safely contain hazardous groceries | 68,000 XP or 6 wins |

The supermarket is where the items themselves fight back: banana peels make you
slip, a Super Mushroom makes you enormous, a ghost pepper makes you fast, a
watermelon slows you to a crawl, and a shaken soda does what shaken soda does.
Bananas, mushrooms, peppers, melons, egg cartons, and soda cans each use their
own top-down-readable geometry. Decorative book stacks are not placed on the
floor, so anything that looks like a loose objective can be picked up.

## Bosses

* **Braden the Bully** — permanently sprinting away from you, stripping every
  shelf he passes. The only way to wear him down is to stay in contact.
* **A Karen** — follows you at conversational distance, shouting, slowing you and
  driving Chaos up. She has a demand: file eight books of one specific color.
* **Poorly Percy** — rare. Wanders and is periodically sick on the floor. Every
  puddle must be mopped before its timer runs out.
* **Field Trip Chaperone** — blows a whistle; twenty-eight children do the rest.

Bosses run out of patience and storm off if you can't deal with them, so an
unbeaten one never becomes permanent, unwinnable pressure.

## Disasters

**Earthquake** now shakes dozens of books out of every shelf around you, and a
**Tornado** continuously tears six books loose each time it crosses a group of
shelves while dragging you off your feet. **Volcano** erupts through the floor
and lobs lava bombs. After any natural disaster ends, Chaos pauses for one full
minute so you can recover; filing still lowers the meter, and whatever remains
on the floor determines the pressure when time resumes. **Alien invasion**
parks a saucer over the stacks and abducts the sci-fi section with a tractor
beam.

## Meta progression

Runs pay out **Watcher Tokens** (retained internally as the original card
currency for save compatibility). Slayer Training buys permanent damage,
movement, health, stamina, starting-combat, draft, reroll, mitigation, and
Second Wind perks. Legacy branches present and apply the equivalent librarian
perks. Everything persists in `localStorage`.

The menu also offers a UTC **Daily Shift**: every player gets the same seeded
floor for a given branch and day, with local per-branch records. Any ordinary
seed can be copied and replayed. Results retain up to 20 local playtest records
with timing, build, movement, chaos, damage, and pathfinding diagnostics for
export or comparison; nothing is transmitted.

---

> **Working on this?** [`DESIGN.md`](DESIGN.md) is the complete technical and
> design reference: every formula, every tuning number, the balance history, the
> bugs already fixed, and console recipes for testing.

## How it's built

Vanilla ES modules, [three.js](https://threejs.org) r185 and
[postprocessing](https://github.com/pmndrs/postprocessing), bundled by Vite.
No framework, no game engine, no assets.

```
src/
  core/       loop-agnostic services: input, audio, camera rig, RNG, save, events
  render/     renderer + post stack, procedural textures, materials, env probe
  world/      floor-plan generator, mesh assembly, collision + pathfinding, props
  entities/   procedural humanoid rig, player, vampires, kids, bosses
  systems/    items, powers, disasters, director, progression, branch rules,
              tutorial, local telemetry, FX
  data/       themes, upgrades, meta upgrades, shelf styles
  ui/         HUD and menus (DOM), stylesheet
```

### Procedural generation

`world/generator.js` produces pure data — no three.js — and is testable from
Node. Cemetery runs generate an open navigable perimeter, paths, graves, crypts,
mausoleums, monuments, trees, vampire rise points, and the Sunnydale gates.
Legacy indoor runs use the district process below:

1. BSP-partitions the hall into districts, carving a corridor at every split.
2. Forces two grand boulevards through the middle so the space stays legible and
   you always have a long sight line.
3. Gives each district an archetype — stacks, rotunda, atrium, reading room,
   carrels, archive, gallery, children's wing — which furnishes itself.
4. Rasterizes the result into a nav grid and an OBB collider list.

Every district gets a dominant color family, so wings read differently while
still keeping a matching shelf near wherever you're standing. A typical run is
172 m square with ~3,500 shelf bays and ~200,000 shelvable items.

### Rendering

The building is drawn in a few hundred draw calls at ~2.5 M triangles:

* **Everything repeated is instanced**, and instanced meshes are grouped *by
  district* so the frustum can throw away whole wings at once.
* **A shelf tier is one box**, not twelve books. A shared spine texture and
  per-instance color, depth, height and lean make a run of shelving read as
  thousands of individual volumes. As items are taken the box scales down from
  one end, so gaps open in the shelf exactly where books were removed.
* **Characters are posed on the CPU** into a flat matrix list and written into
  instanced body-part meshes — thirty kids cost the same nine draw calls as one.
* **Lighting** is a baked PMREM environment probe plus a sun whose shadow
  frustum rides with the player, pooled fixture lights, and pooled directional
  window lights. Soft gradient panes and feathered volumetric shafts create a
  believable daylight spill on nearby floors, shelves, and furniture.
* **Post** is SSAO → depth of field (focus tracks the camera distance) → bloom →
  AgX tone mapping → grade → vignette → chromatic aberration → grain → SMAA.
  A shockwave and lens-distortion effect sit in the chain for disasters.
* **Columns dissolve** via a screen-space Bayer dither when they stand between
  the camera and the player.

Four quality presets, auto-detected and overridable in Settings.

### Audio

`core/audio.js` is a small synthesizer: every sound effect is an envelope over an
oscillator or a filtered noise burst, routed through a shared convolution reverb
and bus compressor. Cemetery mode has its own minor-key generative score plus
stake, kick, rising, and dusting cues. Pads, bass, arpeggios, and a heartbeat
layer in with pressure; important cues temporarily duck the music.

---

## Credits

Built on the gameplay of **The Librarian** by [@mreflow](https://github.com/mreflow).
