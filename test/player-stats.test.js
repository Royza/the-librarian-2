import assert from 'node:assert/strict';
import test from 'node:test';

import { CHARACTERS } from '../src/data/characters.js';
import { BASE_PLAYER_STATS, derivePlayerStats } from '../src/entities/player.js';

test('permanent, in-run, and character bonuses compose without overwriting', () => {
  const stats = derivePlayerStats(
    { tenure: 2, goodShoes: 3, longReach: 2, espresso: 2, sturdySpine: 1, unionRep: 2, overtime: 2 },
    { backpack: 3, comfyShoes: 2, longArms: 2, shelfSense: 2, fitness: 1, zenFocus: 2 },
    CHARACTERS.wolfe.bonuses,
  );

  assert.equal(stats.carrySlots, BASE_PLAYER_STATS.carrySlots + 4 + 6 + 2);
  assert.equal(stats.pickupRadius, BASE_PLAYER_STATS.pickupRadius + 0.6 + 1.1);
  assert.equal(stats.returnRadius, BASE_PLAYER_STATS.returnRadius + 1.4 + 0.9);
  assert.equal(stats.maxHealth, BASE_PLAYER_STATS.maxHealth + 20);
  assert.equal(stats.maxStamina, BASE_PLAYER_STATS.maxStamina + 40 + 25);
  assert.equal(stats.chaosDampening, 8 + 10);
  assert.equal(stats.xpMultiplier, 1 + 0.16 + 0);
  assert.ok(Math.abs(stats.baseMoveSpeed - BASE_PLAYER_STATS.moveSpeed * 1.12 * 0.97) < 1e-9);
  assert.ok(Math.abs(stats.moveSpeed - stats.baseMoveSpeed * 1.16) < 1e-9);
});

test('Marion trades a carrying slot for both pickup and filing reach', () => {
  const marion = derivePlayerStats({}, {}, CHARACTERS.marion.bonuses);
  const wolfe = derivePlayerStats({}, {}, CHARACTERS.wolfe.bonuses);
  assert.equal(marion.carrySlots, 5);
  assert.equal(wolfe.carrySlots, 8);
  assert.equal(marion.pickupRadius, BASE_PLAYER_STATS.pickupRadius + 0.35);
  assert.equal(marion.returnRadius, BASE_PLAYER_STATS.returnRadius + 0.2);
  assert.ok(wolfe.baseMoveSpeed < marion.baseMoveSpeed);
});

test('derived stat reductions remain bounded at maximum investment', () => {
  const stats = derivePlayerStats(
    { insurance: 3 },
    { fireDrill: 4, sprintCoach: 4, dashTraining: 4 },
    {},
  );
  assert.ok(stats.disasterMitigation > 0 && stats.disasterMitigation < 1);
  assert.ok(stats.disasterDurationScale >= 0.25);
  assert.ok(stats.staminaDrain > 0);
  assert.ok(stats.dashCooldown > 0);
});
