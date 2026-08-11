import assert from 'node:assert/strict';
import test from 'node:test';

import { EventBus } from '../src/core/events.js';
import { RunTelemetry, clearPlaytestHistory, getPlaytestHistory } from '../src/systems/telemetry.js';

function installStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function makeGame() {
  return {
    seed: 'telemetry-seed',
    theme: { id: 'library' },
    characterId: 'marion',
    player: { x: 0, z: 0, carried: [], stats: { carrySlots: 6 } },
    run: {
      elapsed: 0, pickedUp: 0, chaos: 0, peakChaos: 0, score: 123,
      shelved: 0, isDaily: false, bestCombo: 0, bossesBeaten: 0, disastersSurvived: 0,
    },
    items: { floorCount: 0 },
    kids: { count: 0 },
    bosses: { active: [] },
    disasters: { active: [] },
    progression: { level: 1 },
    events: new EventBus(),
  };
}

test('run telemetry records milestones, movement, samples, and a local summary', () => {
  installStorage();
  const game = makeGame();
  const telemetry = new RunTelemetry(game);

  game.run.elapsed = 4.2;
  game.run.pickedUp = 1;
  game.player.x = 3;
  game.player.z = 4;
  telemetry.update();
  game.run.elapsed = 7.5;
  game.run.shelved = 1;
  game.events.emit('shelved', {});
  game.events.emit('playerHurt', { amount: 12.5 });
  game.player.x = 6;
  game.player.z = 8;
  telemetry.update();
  const summary = telemetry.finish('survived', true);

  assert.equal(summary.distance, 10);
  assert.equal(summary.metresPerFile, 10);
  assert.equal(summary.first.pickup, 4.2);
  assert.equal(summary.first.shelved, 7.5);
  assert.equal(summary.damageTaken, 12.5);
  assert.equal(summary.won, true);
  assert.equal(getPlaytestHistory().length, 1);
  assert.deepEqual(game.run.telemetry, summary);

  telemetry.dispose();
  clearPlaytestHistory();
  assert.deepEqual(getPlaytestHistory(), []);
});

test('malformed non-array history is ignored and replaced by the next run', () => {
  installStorage();
  localStorage.setItem('librarian2.playtests.v1', '{"unexpected":true}');
  assert.deepEqual(getPlaytestHistory(), []);
  const game = makeGame();
  const telemetry = new RunTelemetry(game);
  telemetry.finish('quit', false);
  assert.equal(getPlaytestHistory().length, 1);
  telemetry.dispose();
});

test('training telemetry resets before scored service begins', () => {
  installStorage();
  const game = makeGame();
  game.pathfinder = { failureCount: 0 };
  const telemetry = new RunTelemetry(game);
  game.player.x = 3;
  game.player.z = 4;
  game.run.pickedUp = 1;
  game.events.emit('shelved', {});
  game.pathfinder.failureCount = 2;
  telemetry.update();

  telemetry.resetAfterTraining();
  assert.equal(telemetry.distance, 0);
  assert.deepEqual(telemetry.first, {});
  assert.deepEqual(telemetry.samples, []);

  game.run.elapsed = 5;
  game.run.pickedUp = 0;
  game.player.x = 6;
  game.pathfinder.failureCount = 3;
  telemetry.update();
  const summary = telemetry.finish('quit', false);
  assert.equal(summary.distance, 3);
  assert.equal(summary.pathFailures, 1);
  telemetry.dispose();
});
