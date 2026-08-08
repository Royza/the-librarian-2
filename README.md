# The Librarian 2 — *“Look, Ma, I Could Read Good”*

A 3D reimagining of [The Librarian](https://github.com/mreflow/the-librarian-game).
You are the last line of defence between a very large library and the children
inside it. Shelve faster than they can unshelve. Keep the Chaos meter under 100%
until closing time.

```bash
npm install
npm run dev      # http://localhost:5273
npm run build    # production bundle in dist/
```

Runs in any WebGL2 browser. **There are no asset files** — every texture,
material, character, sound effect and piece of music in the game is generated in
code at boot.

---

## The loop

1. **Kids arrive.** They pull items off shelves. Some drop them where they stand;
   some sprint off and dump them somewhere inconvenient.
2. **Items on the floor raise Chaos.** Pressure grows sub-linearly with the size
   of the mess, and faster the later it gets.
3. **You vacuum items up** just by getting near them, and **file them
   automatically** when you're beside a shelf bay of the matching colour.
   The compass at the edge of the screen always points at the nearest one.
4. **Filing gives XP and combos.** Level up, draft one of three upgrades.
5. **Survive fifteen minutes.** Bosses and disasters arrive on a schedule
   designed to keep breaking your rhythm.

Lose at Chaos 100%. Health is attrition pressure, not the fail state — it
regenerates when you're left alone.

## Characters

Pick your librarian at the start of every shift. Both handle identically — it's
a wardrobe choice, not a build choice.

* **Marion**, Head Librarian — glasses, bun, cardigan.
* **Wolfe**, Weekend Shift — ball cap, full beard, red plaid flannel.

The select screen renders the actual in-game rig into each card, so the
portraits can never drift from the models.

## Controls

| | |
|---|---|
| `WASD` / arrows | Move |
| `Shift` | Sprint (costs stamina) |
| `Space` | Dash (brief invulnerability) |
| `Q` | **Dewey Decimal Beam** — tractor beam that drags loose books to you, and rips them out of small hands |
| `E` | **Bookerang** — throw what you're carrying at its shelf from across the room |
| `F` | **Chromatic Shush** — shockwave that sends every book of a colour flying home |
| `R` | Mop up a spill |
| Mouse | Aim the beam |
| `Esc` | Pause · `` ` `` Debug overlay · `M` Mute |

Full gamepad support: left stick moves, right stick aims, face and shoulder
buttons map to the powers.

## Branches

Each unlocks at a lifetime-XP milestone and re-skins the entire generator —
materials, palettes, lighting, prop sets, item shapes and hazards.

| | Branch | Unlocks at |
|---|---|---|
| 📚 | **The Grand Library** — mahogany, marble, forty thousand books | default |
| 📼 | **Blockbuster Nite** — VHS, neon, patterned carpet | 12,000 XP |
| 💿 | **Groove Merchant Records** — vinyl crates, warm wood | 34,000 XP |
| 🛒 | **MegaMart Superstore** — fluorescent lino, and *food* | 68,000 XP |

The supermarket is where the items themselves fight back: banana peels make you
slip, a Super Mushroom makes you enormous, a ghost pepper makes you fast, a
watermelon slows you to a crawl, and a shaken soda does what shaken soda does.

## Bosses

* **Braden the Bully** — permanently sprinting away from you, stripping every
  shelf he passes. The only way to wear him down is to stay in contact.
* **A Karen** — follows you at conversational distance, shouting, slowing you and
  driving Chaos up. She has a demand: file eight books of one specific colour.
* **Poorly Percy** — rare. Wanders and is periodically sick on the floor. Every
  puddle must be mopped before its timer runs out.
* **Field Trip Chaperone** — blows a whistle; twenty-eight children do the rest.

Bosses run out of patience and storm off if you can't deal with them, so an
unbeaten one never becomes permanent, unwinnable pressure.

## Disasters

**Earthquake** shakes books out of every shelf around you. **Tornado** wanders
the building tearing shelves apart and dragging you off your feet. **Volcano**
erupts through the floor and lobs lava bombs. **Alien invasion** parks a saucer
over the stacks and abducts the sci-fi section with a tractor beam.

## Meta progression

Runs pay out **Library Cards**. Those buy permanent perks in Staff Development —
extra carry slots, faster shoes, starting with a power already unlocked, extra
draft choices, rerolls, a Second Wind that catches one run-ending chaos spike.
Everything persists in `localStorage`.

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
  entities/   procedural humanoid rig, player, kids, bosses
  systems/    items, powers, disasters, director, progression, FX
  data/       themes, upgrades, meta upgrades, shelf styles
  ui/         HUD and menus (DOM), stylesheet
```

### Procedural generation

`world/generator.js` produces pure data — no three.js — so it's fast (~10 ms) and
testable from Node. Each run:

1. BSP-partitions the hall into districts, carving a corridor at every split.
2. Forces two grand boulevards through the middle so the space stays legible and
   you always have a long sight line.
3. Gives each district an archetype — stacks, rotunda, atrium, reading room,
   carrels, archive, gallery, children's wing — which furnishes itself.
4. Rasterises the result into a nav grid and an OBB collider list.

Every district gets a dominant colour family, so wings read differently while
still keeping a matching shelf near wherever you're standing. A typical run is
172 m square with ~3,500 shelf bays and ~200,000 shelvable items.

### Rendering

The building is drawn in a few hundred draw calls at ~2.5 M triangles:

* **Everything repeated is instanced**, and instanced meshes are grouped *by
  district* so the frustum can throw away whole wings at once.
* **A shelf tier is one box**, not twelve books. A shared spine texture and
  per-instance colour, depth, height and lean make a run of shelving read as
  thousands of individual volumes. As items are taken the box scales down from
  one end, so gaps open in the shelf exactly where books were removed.
* **Characters are posed on the CPU** into a flat matrix list and written into
  instanced body-part meshes — thirty kids cost the same nine draw calls as one.
* **Lighting** is a baked PMREM environment probe plus a sun whose shadow frustum
  rides with the player, plus a pool of point lights that latch onto whichever
  fixtures are nearest.
* **Post** is SSAO → depth of field (focus tracks the camera distance) → bloom →
  AgX tone mapping → grade → vignette → chromatic aberration → grain → SMAA.
  A shockwave and lens-distortion effect sit in the chain for disasters.
* **Columns dissolve** via a screen-space Bayer dither when they stand between
  the camera and the player.

Four quality presets, auto-detected and overridable in Settings.

### Audio

`core/audio.js` is a small synthesiser: every sound effect is an envelope over an
oscillator or a filtered noise burst, routed through a shared convolution reverb
(a library is a big stone room and should sound like one) and a bus compressor.
The score is generative — a pad, a bass pulse, an arpeggio and a heartbeat that
layer in as the Chaos meter climbs.

---

## Credits

Built on the gameplay of **The Librarian** by [@mreflow](https://github.com/mreflow).
