import assert from 'node:assert/strict';
import test from 'node:test';

import { ItemSystem, ITEM_STATE } from '../src/systems/items.js';
import { bayHeadroom } from '../src/world/generator.js';

function item(id) {
  return {
    id, active: true, state: ITEM_STATE.CARRIED,
    x: 0, y: 1, z: 0, color: 'crimson', holder: {},
    targetBay: null, returnArc: null, returnReserved: false,
  };
}

test('simultaneous returns reserve the final shelf slot and score it once', () => {
  const bay = {
    color: 'crimson', capacity: 4, filled: 4, reserved: 0,
    wx: 2, wz: 2, nx: 1, nz: 0, run: { height: 2 },
  };
  assert.equal(bayHeadroom(bay), 5);
  const system = Object.create(ItemSystem.prototype);
  system.layout = {};
  system.freeList = [];
  let shelved = 0;
  system.onShelved = () => { shelved++; };
  const first = item(1);
  const second = item(2);

  assert.equal(system.returnTo(first, bay), true);
  assert.equal(bay.reserved, 1);
  assert.equal(system.returnTo(second, bay), false);
  assert.equal(second.state, ITEM_STATE.CARRIED);

  system._finishReturn(first, bay);
  assert.equal(bay.filled, 5);
  assert.equal(bay.reserved, 0);
  assert.equal(shelved, 1);
  assert.equal(first.active, false);
});
