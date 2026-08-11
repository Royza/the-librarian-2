import assert from 'node:assert/strict';
import test from 'node:test';

import { RNG } from '../src/core/rng.js';
import { THEMES } from '../src/data/themes.js';
import { draftUpgrades } from '../src/data/upgrades.js';
import { generateLayout } from '../src/world/generator.js';

function snapshot(layout) {
  return {
    seed: layout.seed,
    spawn: layout.spawn,
    crossing: layout.crossing,
    zones: layout.zones.map((zone) => ({
      id: zone.id, type: zone.type, dominant: zone.dominant, secondary: zone.secondary,
      rect: [zone.rect.x, zone.rect.z, zone.rect.w, zone.rect.d],
    })),
    shelfRuns: layout.shelfRuns.map((run) => ({
      id: run.id, zoneId: run.zoneId, x: run.x, z: run.z, angle: run.angle,
      length: run.length, style: run.style,
      bays: run.bays.map((bay) => [bay.side, bay.i, bay.color, bay.capacity, bay.filled]),
    })),
    props: layout.props,
    landmarks: layout.landmarks,
    nav: Buffer.from(layout.nav).toString('base64'),
  };
}

test('the same gameplay seed reproduces its full layout and upgrade offers', () => {
  const theme = THEMES.library;
  const a = snapshot(generateLayout('repeatable-shift', theme));
  const b = snapshot(generateLayout('repeatable-shift', theme));
  assert.deepEqual(a, b);

  const offerA = draftUpgrades(new RNG('repeatable-shift-draft'), {}, 4).map((upgrade) => upgrade.id);
  const offerB = draftUpgrades(new RNG('repeatable-shift-draft'), {}, 4).map((upgrade) => upgrade.id);
  assert.deepEqual(offerA, offerB);
});

test('different seeds produce a different generated shift', () => {
  const a = snapshot(generateLayout('shift-a', THEMES.library));
  const b = snapshot(generateLayout('shift-b', THEMES.library));
  assert.notEqual(a.nav, b.nav);
  assert.notDeepEqual(a.shelfRuns, b.shelfRuns);
});
