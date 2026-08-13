# Codex development guide

## Product and platform

- This repository is a browser game built with vanilla ES modules, Vite, Three.js, and `postprocessing`.
- Preserve Firefox compatibility. WebGL2 is the required rendering baseline; do not make the game Chromium-only or WebGPU-only.
- Preserve the existing Vite + Three.js architecture unless there is a strong technical reason to change it.
- Do not add a frontend framework merely for convenience. Gameplay renders through Three.js and interface overlays are ordinary DOM/CSS.
- The project intentionally creates its visuals and audio procedurally. Do not add downloaded 3D, image, or audio dependencies without an explicit product decision.

## Architecture

- Keep modules focused. Prefer the existing `core/`, `render/`, `world/`, `entities/`, `systems/`, `data/`, and `ui/` boundaries over large monolithic files.
- `src/world/generator.js` is pure data and must not import Three.js. Seeded gameplay generation uses `RNG`; reserve `Math.random()` for non-deterministic cosmetic presentation.
- Keep procedural generation wherever practical and preserve the generator's reachability contract. New solid props must be represented in both collision/nav data and rendered geometry.
- Preserve useful generic infrastructure when replacing gameplay: input, cameras, renderer/post stack, collision/pathfinding, pooling, saves, drafts, director timing, telemetry, and lifecycle cleanup should remain reusable.
- Separate generic engine behavior from Buffy/cemetery-specific gameplay where practical. Theme- or mode-specific branches are preferable to corrupting generic names and contracts that still support legacy secondary themes.
- Pools and instancing exist for frame-time stability. Avoid per-frame allocations or unbounded scene-object creation in active gameplay.
- Textures are cached and shared across runs; per-run materials and scene resources must be disposed by their owner. Every manager added during `startRun()` needs a matching `disposeRun()` path.
- Any material using vertex colors needs compatible geometry color attributes. Use the existing geometry helpers.
- HUD and menu CSS share global scope. Scope selectors under their owning component and avoid ID-specificity that defeats overlay state classes.

## Gameplay conversion rules

- The default playable experience is a Buffy-style cemetery action roguelite. Do not preserve librarian semantics when they create nonsensical cemetery gameplay.
- Do not silently remove working gameplay systems because they are inconvenient to retheme. Keep legacy secondary themes available when removal would add risk, and preserve reusable infrastructure when replacing a system.
- The first vertical slice prioritizes one polished cemetery, Buffy as the playable Slayer, responsive melee combat, vampires, Hellmouth pressure, a sunrise survival objective, and a small coherent Slayer upgrade pool.
- Combat targeting and collision should be forgiving and readable from the elevated camera. Player and enemy navigation must remain reliable on generated layouts.

## Verification and workflow

- Inspect the working tree before editing and preserve unrelated user changes.
- Add deterministic unit tests for pure gameplay math and generator contracts. Lifecycle additions should be tested for cleanup where practical.
- Run the existing test suite after meaningful changes: `npm test`.
- Run `npm run build` before considering a task complete.
- Fix test or build failures caused by our changes. Do not weaken unrelated regression tests merely to make a conversion pass.
- Useful manual diagnostics are exposed through `window.__game`; `_step(dt)` can advance simulation without rendering.
