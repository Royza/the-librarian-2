import assert from 'node:assert/strict';
import test from 'node:test';

import { RNG } from '../src/core/rng.js';
import { THEMES } from '../src/data/themes.js';
import { BranchMechanics } from '../src/systems/branchMechanics.js';

function makeGame(themeId) {
  const calls = { xp: 0, banners: [], toasts: [] };
  const game = {
    theme: THEMES[themeId],
    rng: new RNG(`branch-test-${themeId}`),
    run: { chaos: 20, combo: 0, tutorialActive: false },
    progression: { addXP: (amount) => { calls.xp += amount; } },
    hud: {
      banner: (...args) => calls.banners.push(args),
      toast: (...args) => calls.toasts.push(args),
    },
    addChaos: (amount) => { game.run.chaos += amount; },
  };
  return { game, calls };
}

test('library rewards each completed twelve-file Dewey streak', () => {
  const { game, calls } = makeGame('library');
  const branch = new BranchMechanics(game);
  game.run.combo = 12;
  branch.onShelved({}, {});
  assert.equal(calls.xp, 45);
  assert.equal(game.run.chaos, 17.5);
  assert.equal(game.run.branchObjective.progress, 12);

  // A multi-file return can cross two streak boundaries in the same frame;
  // neither earned reward should be suppressed by a presentation cooldown.
  game.run.combo = 24;
  branch.onShelved({}, {});
  assert.equal(calls.xp, 90);
  assert.equal(game.run.chaos, 15);

  game.run.combo = 8;
  branch.onShelved({}, {});
  assert.equal(game.run.branchObjective.progress, 8);
  game.run.combo = 0;
  branch.update(0.1);
  assert.equal(game.run.branchObjective.progress, 0);
});

test('video rewind rush rewards only the requested color', () => {
  const { game, calls } = makeGame('videostore');
  const branch = new BranchMechanics(game);
  const wanted = branch.targetColor;
  const other = game.theme.colors.find((color) => color !== wanted);
  branch.onShelved({ color: other }, {});
  assert.equal(calls.xp, 0);
  branch.onShelved({ color: wanted }, {});
  branch.onShelved({ color: wanted }, {});
  assert.equal(calls.xp, 120);
  assert.equal(game.run.chaos, 16);
});

test('record setlist resets on a wrong color and rewards the full order', () => {
  const { game, calls } = makeGame('recordstore');
  const branch = new BranchMechanics(game);
  const [first, second, third] = branch.sequence;
  branch.onShelved({ color: first }, {});
  branch.onShelved({ color: third }, {});
  assert.equal(game.run.branchObjective.progress, 0);
  for (const color of [first, second, third]) branch.onShelved({ color }, {});
  assert.equal(calls.xp, 100);
  assert.equal(game.run.chaos, 17);
});

test('grocery safety bonus applies only to hazardous returns', () => {
  const { game, calls } = makeGame('grocery');
  const branch = new BranchMechanics(game);
  branch.onShelved({ hazard: null }, {});
  branch.onShelved({ hazard: { name: 'Egg Carton' } }, {});
  assert.equal(calls.xp, 25);
  assert.equal(game.run.chaos, 18.5);
  assert.equal(game.run.branchObjective.progress, 1);
});
