import assert from 'node:assert/strict';
import test from 'node:test';

import { Player } from '../src/entities/player.js';
import { ItemSystem, ITEM_STATE } from '../src/systems/items.js';

test('the final tutorial power target cannot be vacuumed or auto-filed first', () => {
  const target = {
    state: ITEM_STATE.FREE, grounded: true, trainingPowerTarget: true,
    x: 0, z: 0, color: 'crimson', holder: null,
  };
  let returnCalls = 0;
  const player = {
    x: 0, z: 0, scaleMul: 1, carried: [],
    stats: { pickupRadius: 4, returnRadius: 4, carrySlots: 6 },
    get isFull() { return this.carried.length >= this.stats.carrySlots; },
    game: {
      clock: 0,
      layout: { bayIndexCell: 10, bayIndex: new Map([['0,0', [{ color: 'crimson', filled: 0, capacity: 4, reserved: 0, wx: 0, wz: 0 }]]]) },
      items: {
        forEachInRadius: (_x, _z, _r, fn) => fn(target),
        returnTo: () => { returnCalls++; return true; },
      },
      audio: { play() {} },
    },
  };

  Player.prototype._vacuum.call(player, 1 / 60);
  assert.equal(target.state, ITEM_STATE.FREE);
  assert.equal(target.holder, null);

  target.state = ITEM_STATE.CARRIED;
  target.holder = player;
  player.carried.push(target);
  Player.prototype._autoShelve.call(player, 1 / 60);
  assert.deepEqual(player.carried, [target]);
  assert.equal(returnCalls, 0);
});

test('released training targets re-enter the pool as ordinary pickup items', () => {
  const pooled = {
    id: 0, active: true, state: ITEM_STATE.FREE,
    targetBay: null, returnReserved: false,
    trainingPowerTarget: true, trainingSourceBay: {}, trainingSourceDisplaced: true,
  };
  const system = Object.create(ItemSystem.prototype);
  system.items = [pooled];
  system.freeList = [];
  system.rng = { range: () => 0 };
  system.release(pooled);
  const reused = system.spawn(1, 0.3, 2, 'crimson');
  assert.equal(reused, pooled);
  assert.equal(reused.trainingPowerTarget, false);
  assert.equal(reused.trainingSourceBay, null);
  assert.equal(reused.trainingSourceDisplaced, false);
});
