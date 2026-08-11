import assert from 'node:assert/strict';
import test from 'node:test';

import { RNG } from '../src/core/rng.js';
import { Director } from '../src/systems/director.js';

function makeGame() {
  const calls = { begin: 0, kids: 0, disasters: [], bosses: [], banners: [] };
  const game = {
    rng: new RNG('director-test'),
    run: { elapsed: 0, tutorialActive: false },
    progression: { begin: () => { calls.begin++; } },
    kids: {
      maxKids: 0, spawnInterval: 0, ransackRadius: 0,
      get count() { return calls.kids; },
      spawnOne: () => { calls.kids++; },
    },
    items: { floorCount: 0 },
    bosses: {
      active: [],
      spawn: (id) => { calls.bosses.push(id); },
    },
    disasters: {
      active: [],
      trigger: (id) => { calls.disasters.push(id); },
    },
    hud: {
      toast: () => {},
      banner: (...args) => calls.banners.push(args),
    },
  };
  return { game, calls };
}

test('director creates a lightweight 1:15 arrival before a guaranteed first earthquake', () => {
  const { game, calls } = makeGame();
  const director = new Director(game);
  director.spawnTimer = 999;
  assert.equal(calls.begin, 1);

  game.run.elapsed = 74.9;
  director.update(0);
  assert.equal(calls.kids, 0);
  game.run.elapsed = 75;
  director.update(0);
  assert.equal(calls.kids, 2);
  assert.equal(calls.banners[0][0], 'AFTER-SCHOOL RUSH');

  game.run.elapsed = 125;
  director.update(125);
  assert.deepEqual(calls.disasters, ['earthquake']);
  assert.deepEqual(calls.bosses, []);
  assert.ok(director.eventTimer >= 70 && director.eventTimer <= 95, 'quake should open a readable recovery window');

  const recovery = director.eventTimer;
  game.run.elapsed = 125 + recovery;
  director.update(recovery);
  assert.deepEqual(calls.bosses, ['bully']);
  assert.ok(game.run.elapsed / 60 < 4, 'the first boss should land before minute four');
});

test('guided tutorial freezes the director until training is complete', () => {
  const { game, calls } = makeGame();
  const director = new Director(game);
  game.run.elapsed = 130;
  game.run.tutorialActive = true;
  director.update(130);
  assert.equal(calls.kids, 0);
  assert.deepEqual(calls.disasters, []);
  assert.equal(director.eventTimer, 125);
});

test('the 1:15 rush remains visible when the opening crowd is already at cap', () => {
  const { game, calls } = makeGame();
  calls.kids = 4;
  game.run.elapsed = 75;
  const director = new Director(game);
  director.spawnTimer = 999;
  director.update(0);
  assert.equal(calls.kids, 6);
  assert.equal(game.kids.maxKids, 6);
  assert.equal(calls.banners[0][0], 'AFTER-SCHOOL RUSH');
});
