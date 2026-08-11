import assert from 'node:assert/strict';
import test from 'node:test';

import { applyKarenCompliance, BossManager, mopControlLabel } from '../src/entities/bosses.js';

test('dead boss presentation never reapplies gameplay behavior', () => {
  const player = { stats: { moveSpeed: 5 } };
  let behaviorUpdates = 0;
  const boss = {
    alive: false,
    deadT: 0,
    type: { id: 'karen' },
    model: { setVisible() {} },
    update() {
      behaviorUpdates++;
      player.stats.moveSpeed = 4.1;
    },
    dispose() {},
  };
  const manager = { active: [boss], defeated: new Set(), game: { player } };

  BossManager.prototype.update.call(manager, 0.5);
  assert.equal(behaviorUpdates, 0);
  assert.equal(player.stats.moveSpeed, 5);
  assert.equal(boss.deadT, 0.5);
});

test('Karen intro invulnerability cannot consume her visible filing quota', () => {
  const toasts = [];
  const boss = {
    alive: true,
    state: 'intro',
    maxHp: 140,
    hp: 140,
    demandColor: 'plum',
    demandTotal: 8,
    demandLeft: 8,
    game: { hud: { toast: (message) => toasts.push(message) } },
    damage(amount) {
      if (this.state === 'intro') return false;
      this.hp -= amount;
      return true;
    },
  };

  assert.equal(applyKarenCompliance(boss, { color: 'plum' }), false);
  assert.equal(boss.demandLeft, 8);
  assert.equal(boss.hp, 140);
  assert.deepEqual(toasts, []);

  boss.state = 'active';
  assert.equal(applyKarenCompliance(boss, { color: 'plum' }), true);
  assert.equal(boss.demandLeft, 7);
  assert.ok(boss.hp < 140);
  assert.match(toasts[0], /7 to go/);
});

test('Percy live prompts follow controller and remapped mop controls', () => {
  assert.equal(mopControlLabel({ usingGamepad: true, bindingFor: () => 'KeyR' }), 'B');
  assert.equal(mopControlLabel({ usingGamepad: false, bindingFor: () => 'KeyT' }), 'T');
});
