import assert from 'node:assert/strict';
import test from 'node:test';

import { Progression, xpRequiredForLevel } from '../src/systems/progression.js';

function progressionHarness(xpMultiplier = 1) {
  const game = {
    seed: 'progression-balance',
    state: 'playing',
    run: { elapsed: 0, xpEarned: 0 },
    player: { stats: { xpMultiplier } },
  };
  const progression = new Progression(game);
  // These tests target the XP accounting model, not draft rendering.
  progression._openDraft = () => true;
  return { game, progression };
}

test('run XP thresholds start approachable and widen meaningfully each level', () => {
  assert.deepEqual(
    Array.from({ length: 6 }, (_, index) => xpRequiredForLevel(index + 1)),
    [180, 270, 405, 607, 911, 1366],
  );

  for (let level = 2; level <= 6; level++) {
    assert.ok(xpRequiredForLevel(level) >= xpRequiredForLevel(level - 1) * 1.49);
  }
});

test('the first draft takes eleven engaged opening returns, not passive chain levels', () => {
  const { progression } = progressionHarness();
  for (let combo = 1; combo <= 10; combo++) {
    progression.addXP(3);
    progression.addXP(Math.round(10 * (1 + combo * 0.06)));
  }
  assert.equal(progression.level, 1);
  assert.equal(progression.pendingLevels, 0);

  progression.addXP(3);
  progression.addXP(Math.round(10 * (1 + 11 * 0.06)));
  assert.equal(progression.level, 2);
  assert.equal(progression.pendingLevels, 1);
});

test('no early incident or branch reward queues multiple drafts with reachable bonuses', () => {
  // Overtime V is the largest pre-run XP multiplier (1.4). Each earned draft
  // can then add at most one early level of Overdue Fines; modeling that perk
  // every time is more aggressive than any mixed Reading Glasses build.
  const earlyLevels = [
    { level: 1, playerMultiplier: 1.4, comboBonus: 1 },
    { level: 2, playerMultiplier: 1.4, comboBonus: 1.2 },
    { level: 3, playerMultiplier: 1.4, comboBonus: 1.4 },
    { level: 4, playerMultiplier: 1.4, comboBonus: 1.6 },
  ];

  for (const setup of earlyLevels) {
    for (const reward of [120, 140, 180]) {
      const { progression } = progressionHarness(setup.playerMultiplier);
      progression.level = setup.level;
      progression.xpToNext = xpRequiredForLevel(setup.level);
      progression.comboBonus = setup.comboBonus;
      progression.xp = progression.xpToNext - 1;
      progression.addXP(reward);
      assert.equal(progression.level, setup.level + 1, `${reward} XP skipped from level ${setup.level}`);
      assert.equal(progression.pendingLevels, 1, `${reward} XP queued multiple drafts at level ${setup.level}`);
      assert.ok(progression.xp < progression.xpToNext);
    }
  }
});

test('tutorial can still force the first promotion against the slower curve', () => {
  const { progression } = progressionHarness();
  const needed = progression.xpToNext - progression.xp + 0.01;
  progression.addXP(needed);
  assert.equal(progression.level, 2);
  assert.equal(progression.pendingLevels, 1);
});
