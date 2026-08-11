import assert from 'node:assert/strict';
import test from 'node:test';

import { RNG } from '../src/core/rng.js';
import {
  DISASTERS,
  DisasterManager,
  earthquakeBooksPerPulse,
  tornadoBooksPerPulse,
} from '../src/systems/disasters.js';
import { presentationFxDelta } from '../src/game.js';
import { isChaosPaused } from '../src/systems/chaos.js';

function managerHarness() {
  const game = {
    rng: new RNG('disaster-lifecycle'),
    player: { x: 0, z: 0 },
    fx: { removeDecal() {} },
  };
  const manager = new DisasterManager(game);
  const impacts = [];
  manager._lavaImpact = (x, z) => impacts.push([x, z]);
  return { manager, impacts };
}

test('lava impacts advance on simulation time and stop across run disposal', () => {
  const { manager, impacts } = managerHarness();
  manager._pendingImpacts.push({ x: 3, z: 4, time: 1 });

  manager._updatePendingImpacts(0.6);
  assert.deepEqual(impacts, []);
  manager._updatePendingImpacts(0.4);
  assert.deepEqual(impacts, [[3, 4]]);

  manager._pendingImpacts.push({ x: 8, z: 9, time: 0.1 });
  manager.dispose();
  manager._updatePendingImpacts(1);
  assert.deepEqual(impacts, [[3, 4]]);
});

test('a lava warning that expires during slowed level-up simulation still lands', () => {
  let bursts = 0;
  const manager = Object.create(DisasterManager.prototype);
  manager.mitigation = 1;
  manager.game = {
    state: 'levelup',
    items: { knockOff() {} },
    layout: { bayIndexCell: 8, bayIndex: new Map() },
    fx: { burst: () => { bursts++; }, ring() {}, addDecal() {} },
    audio: { play() {} },
    camera: { addTrauma() {} },
    player: { x: 20, z: 20, damage() {} },
    level: { refreshBay() {} },
    _panFor: () => 0,
  };

  manager._lavaImpact(2, 3);
  assert.equal(bursts, 1);
  manager.game.state = 'paused';
  manager._lavaImpact(2, 3);
  assert.equal(bursts, 1);
});

test('pause freezes hazard telegraph FX on the same simulation clock as its impact', () => {
  assert.equal(presentationFxDelta('paused', 2.5), 0);
  assert.equal(presentationFxDelta('playing', 2.5), 2.5);
  assert.equal(presentationFxDelta('levelup', 2.5), 2.5);
});

test('warning-phase disasters dispose before their resources exist', () => {
  const manager = Object.create(DisasterManager.prototype);
  manager.game = {};
  manager._pendingImpacts = [];
  manager.messes = [];
  manager.active = ['tornado', 'volcano', 'aliens'].map((id) => ({
    def: { id }, phase: 'warn', data: {},
  }));
  assert.doesNotThrow(() => manager.clear());
  assert.deepEqual(manager.active, []);
});

test('disposing an active alien is silent while natural completion announces it', () => {
  let toasts = 0;
  const manager = Object.create(DisasterManager.prototype);
  manager.game = {
    render: { scene: { remove() {} } },
    fx: { hideBeam() {} },
    hud: { toast: () => { toasts++; } },
  };
  const inst = {
    data: {
      mesh: { traverse(fn) { fn({}); } },
      light: {}, beam: {},
    },
  };

  manager._end_aliens(inst, { silent: true });
  assert.equal(toasts, 0);
  manager._end_aliens(inst);
  assert.equal(toasts, 1);
});

test('earthquakes and tornadoes receive substantially larger knockoff budgets', () => {
  assert.equal(earthquakeBooksPerPulse(1, 1), 10);
  assert.equal(earthquakeBooksPerPulse(0, 1), 5);
  assert.equal(earthquakeBooksPerPulse(1, 0.5), 5);
  assert.equal(tornadoBooksPerPulse(1), 6);
  assert.equal(tornadoBooksPerPulse(0.5), 3);
});

test('disaster knockoff helper spends its exact budget across distinct shelf faces', () => {
  const manager = Object.create(DisasterManager.prototype);
  manager.rng = new RNG('knockoff-budget');
  const refreshed = [];
  manager.game = {
    items: {
      knockOff(bay, count) {
        bay.filled -= count;
        return Array.from({ length: count }, () => ({}));
      },
    },
    level: { refreshBay: (bay) => refreshed.push(bay.id) },
  };
  const bays = Array.from({ length: 8 }, (_, id) => ({ id, filled: 20 }));
  assert.equal(manager._knockBooksFromBays(bays, 10, { perBay: 2 }), 10);
  assert.equal(refreshed.length, 5);
  assert.equal(new Set(refreshed).size, 5);
});

test('natural disasters grant exactly one simulation minute of Chaos recovery', () => {
  let floor = 48;
  const banners = [];
  const events = [];
  const manager = Object.create(DisasterManager.prototype);
  manager.game = {
    run: { chaosFrozen: true, disasterRecoveryRemaining: 0 },
    items: { get floorCount() { return floor; } },
    hud: { banner: (...args) => banners.push(args) },
    events: { emit: (...args) => events.push(args) },
  };

  assert.equal(DISASTERS.earthquake.recoverySeconds, 60);
  assert.equal(DISASTERS.tornado.recoverySeconds, 60);
  assert.equal(DISASTERS.volcano.recoverySeconds, 60);
  assert.equal(DISASTERS.aliens.recoverySeconds, undefined);
  assert.equal(manager._beginChaosRecovery(DISASTERS.earthquake), true);
  assert.equal(manager.game.run.disasterRecoveryRemaining, 60);
  assert.equal(manager.game.run.disasterRecoveryStartFloor, 48);

  manager._updateChaosRecovery(0); // paused wall time never reaches this clock
  assert.equal(manager.game.run.disasterRecoveryRemaining, 60);
  manager._updateChaosRecovery(59.5);
  assert.equal(manager.game.run.disasterRecoveryRemaining, 0.5);
  floor = 17;
  assert.equal(manager._updateChaosRecovery(0.5), true);
  assert.equal(manager.game.run.disasterRecoveryRemaining, 0);
  assert.equal(manager.game.run.disasterRecoveryEndFloor, 17);
  assert.equal(manager.game.run.chaosFrozen, true, 'recovery must not clear Quiet Please');
  assert.equal(isChaosPaused(manager.game.run), true);
  assert.equal(banners.at(-1)[0], 'CHAOS RESUMES');
  assert.match(banners.at(-1)[1], /17 loose items/);
  assert.equal(events.at(-1)[0], 'disasterRecoveryEnd');
});

test('a newly completed natural disaster refreshes, rather than stacks, recovery', () => {
  const manager = Object.create(DisasterManager.prototype);
  manager.game = {
    run: { disasterRecoveryRemaining: 21 },
    items: { floorCount: 60 },
    events: { emit() {} },
  };
  manager._beginChaosRecovery(DISASTERS.tornado);
  assert.equal(manager.game.run.disasterRecoveryRemaining, 60);
  assert.equal(manager._beginChaosRecovery(DISASTERS.aliens), false);
  assert.equal(manager.game.run.disasterRecoveryRemaining, 60);
});
