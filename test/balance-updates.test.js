import assert from 'node:assert/strict';
import test from 'node:test';

import { draftUpgrades, UPGRADES } from '../src/data/upgrades.js';
import { bullyRunSpeed } from '../src/entities/bosses.js';

const preferChromatic = {
  weighted(entries) {
    return entries.find((entry) => entry.v.id === 'colorPulse') || entries[0];
  },
};

test('the Bully remains catchable by an unupgraded librarian', () => {
  assert.equal(bullyRunSpeed(0), 4.4);
  assert.ok(bullyRunSpeed(3 * 60) < 5);
  assert.ok(bullyRunSpeed(6 * 60) < 5);
  assert.equal(bullyRunSpeed(15 * 60), 5);
  assert.equal(bullyRunSpeed(60 * 60), 5, 'late runs remain capped at base walk speed');
});

test('Chromatic Shush first enters ordinary drafts at run level four', () => {
  assert.equal(UPGRADES.colorPulse.minDraftLevel, 4);
  assert.ok(!draftUpgrades(preferChromatic, {}, 3, new Set(), 3)
    .some((upgrade) => upgrade.id === 'colorPulse'));
  assert.equal(draftUpgrades(preferChromatic, {}, 1, new Set(), 4)[0].id, 'colorPulse');
});

test('a permanent Chromatic Shush starting grant can still be leveled early', () => {
  const offer = draftUpgrades(preferChromatic, { colorPulse: 1 }, 1, new Set(), 1);
  assert.equal(offer[0].id, 'colorPulse');
});
