import assert from 'node:assert/strict';
import test from 'node:test';

import { Game } from '../src/game.js';
import {
  CHAOS_BALANCE,
  chaosPacingMultiplier,
  chaosPressureRate,
  cleanFloorReliefRate,
  isChaosPaused,
  shelveChaosRelief,
} from '../src/systems/chaos.js';

test('Chaos is visible immediately and ramps smoothly through minutes five and six', () => {
  const opening = chaosPressureRate({ elapsed: 0, floor: 0 });
  assert.ok(opening > 0, 'ambient pressure should move the opening meter');
  assert.equal(chaosPacingMultiplier(0), 0.8);
  assert.equal(chaosPacingMultiplier(15 * 60), 1.55);

  const minute4 = chaosPressureRate({ elapsed: 4 * 60, floor: 45 });
  const minute5 = chaosPressureRate({ elapsed: 5 * 60, floor: 45 });
  const minute6 = chaosPressureRate({ elapsed: 6 * 60, floor: 45 });
  assert.ok(minute5 / minute4 < 1.1, 'minute five must not create a coefficient spike');
  assert.ok(minute6 / minute5 < 1.1, 'minute six must continue the smooth curve');
});

test('filing a book gives strong, combo-scaled relief and a clean floor recovers', () => {
  assert.equal(CHAOS_BALANCE.pickupRelief, 0.32);
  assert.equal(shelveChaosRelief(0), 0.95);
  assert.equal(shelveChaosRelief(20), 1.65);
  assert.equal(shelveChaosRelief(200), 1.65, 'combo relief is capped');
  assert.ok(CHAOS_BALANCE.pickupRelief + shelveChaosRelief(8) > 1.5);
  assert.equal(cleanFloorReliefRate(10, 0), 0);
  assert.equal(cleanFloorReliefRate(0, 0), 1.4);
  assert.equal(cleanFloorReliefRate(0, 1), 0);
  assert.equal(CHAOS_BALANCE.cleanFloorChaosFloor, 5);
});

test('clearing disaster clutter materially lowers the resumed Chaos rate', () => {
  const buried = chaosPressureRate({ elapsed: 6 * 60, floor: 70 });
  const recovered = chaosPressureRate({ elapsed: 6 * 60, floor: 15 });
  assert.ok(buried > recovered * 2, 'remaining floor damage must drive resumed pressure');
});

test('post-disaster recovery and Quiet Please pause Chaos independently', () => {
  const run = { chaosFrozen: true, disasterRecoveryRemaining: 10 };
  assert.equal(isChaosPaused(run), true);
  run.chaosFrozen = false;
  assert.equal(isChaosPaused(run), true, 'Quiet Please ending cannot clear disaster recovery');
  run.chaosFrozen = true;
  run.disasterRecoveryRemaining = 0;
  assert.equal(isChaosPaused(run), true, 'disaster recovery ending cannot clear Quiet Please');
  run.chaosFrozen = false;
  assert.equal(isChaosPaused(run), false);
});

test('all positive Chaos sources hold during a cleanup window, then resume', () => {
  const context = {
    run: {
      elapsed: 6 * 60,
      chaos: 30,
      maxChaos: 100,
      peakChaos: 30,
      chaosFrozen: false,
      disasterRecoveryRemaining: 20,
    },
    player: { stats: { chaosDampening: 0 } },
    items: { floorCount: 70, looseCount: 70 },
    disasters: { messCount: 0 },
    bosses: { chaosPressure: 0 },
    addChaos: Game.prototype.addChaos,
  };

  Game.prototype._updateChaos.call(context, 5);
  assert.equal(context.run.chaos, 30);
  assert.equal(Game.prototype.addChaos.call(context, 8), 0);
  assert.equal(context.run.chaos, 30);

  context.run.disasterRecoveryRemaining = 0;
  Game.prototype._updateChaos.call(context, 5);
  assert.ok(context.run.chaos > 30, 'current loose-item burden resumes pressure');
});

test('a tidy opening still visibly advances to a fair five-percent baseline', () => {
  const context = {
    run: {
      elapsed: 0,
      chaos: 0,
      maxChaos: 100,
      peakChaos: 0,
      chaosFrozen: false,
      disasterRecoveryRemaining: 0,
    },
    player: { stats: { chaosDampening: 0 } },
    items: { floorCount: 0, looseCount: 0 },
    disasters: { messCount: 0 },
    bosses: { chaosPressure: 0 },
    addChaos: Game.prototype.addChaos,
  };

  Game.prototype._updateChaos.call(context, 60);
  assert.ok(context.run.chaos > 0, 'opening Chaos cannot be pinned at zero by clean recovery');
  context.run.chaos = 20;
  Game.prototype._updateChaos.call(context, 60);
  assert.equal(context.run.chaos, 5, 'a pristine room recovers to the readable baseline');
});

const RECOVERY_WINDOWS = [
  [150, 210],
  [390, 450],
  [660, 720],
];

function inRecoveryWindow(elapsed) {
  return RECOVERY_WINDOWS.some(([start, end]) => elapsed >= start && elapsed < end);
}

/**
 * A deterministic one-second projection of the same pressure and relief model
 * used by Game. Floor count is the remaining backlog after the modeled filing
 * rate, so direct pickup/filing relief is applied as well as the smaller pile.
 */
function projectChaos({
  from = 0,
  to = 15 * 60,
  initialChaos = 0,
  dampening = 0,
  floorAt,
  shelvedPerMinuteAt,
  comboAt = () => 8,
  messesAt = () => 0,
  bossPressureAt = () => 0,
  recoveryAt = inRecoveryWindow,
}) {
  let chaos = initialChaos;
  let peak = chaos;
  let failedAt = null;
  const minute = {};

  for (let elapsed = from; elapsed <= to; elapsed++) {
    const floor = floorAt(elapsed);
    const messes = messesAt(elapsed);
    if (!recoveryAt(elapsed)) {
      const currentDampening = typeof dampening === 'function'
        ? dampening(elapsed)
        : dampening;
      chaos += chaosPressureRate({
        elapsed,
        floor,
        messes,
        bossPressure: bossPressureAt(elapsed),
      }) * (1 - currentDampening);

      const passiveRelief = cleanFloorReliefRate(floor, messes);
      if (passiveRelief > 0 && chaos > CHAOS_BALANCE.cleanFloorChaosFloor) {
        chaos = Math.max(CHAOS_BALANCE.cleanFloorChaosFloor, chaos - passiveRelief);
      }
    }

    const filedRelief = CHAOS_BALANCE.pickupRelief + shelveChaosRelief(comboAt(elapsed));
    chaos -= shelvedPerMinuteAt(elapsed) / 60 * filedRelief;
    chaos = Math.max(0, Math.min(100, chaos));
    peak = Math.max(peak, chaos);
    if (elapsed % 60 === 0) minute[elapsed / 60] = chaos;
    if (chaos >= 100) { failedAt = elapsed; break; }
  }

  return { chaos, peak, failedAt, minute };
}

const ordinaryBossPressure = (elapsed) => {
  if (elapsed >= 240 && elapsed < 300) return 0.14;
  if (elapsed >= 510 && elapsed < 560) return 0.16;
  return 0;
};

const ordinaryMesses = (elapsed) => (
  elapsed >= 570 && elapsed < 630 ? 1 : 0
);

function ordinaryTrajectory(dampening = 0) {
  return projectChaos({
    dampening,
    floorAt: (elapsed) => 10 + elapsed / 27,
    shelvedPerMinuteAt: (elapsed) => (elapsed < 300 ? 8 : elapsed < 600 ? 10 : 14),
    bossPressureAt: ordinaryBossPressure,
    messesAt: ordinaryMesses,
  });
}

test('ordinary cleanup now reaches a real late-shift threat without a minute-six cliff', () => {
  const result = ordinaryTrajectory();
  assert.equal(result.failedAt, null);
  assert.ok(result.minute[5] >= 8 && result.minute[5] <= 18, `minute 5 was ${result.minute[5]}`);
  assert.ok(result.minute[10] >= 35 && result.minute[10] <= 50, `minute 10 was ${result.minute[10]}`);
  assert.ok(result.minute[15] >= 65 && result.minute[15] <= 85, `minute 15 was ${result.minute[15]}`);
});

test('a realistic earned-max dampening build is easier without flattening late Chaos', () => {
  const base = ordinaryTrajectory();
  // Union Rep IV is permanent (16%). Modeling one Zen Focus level every two
  // minutes reaches the true 46% ceiling only at minute twelve. Spending six
  // drafts on Zen has an opportunity cost: this route files more slowly and
  // carries a somewhat larger backlog than the mixed ordinary build.
  const earnedDampening = (elapsed) => (
    0.16 + Math.min(6, Math.floor(elapsed / 120)) * 0.05
  );
  const progressed = projectChaos({
    dampening: earnedDampening,
    floorAt: (elapsed) => Math.min(62, 13 + elapsed / 20),
    shelvedPerMinuteAt: (elapsed) => (elapsed < 300 ? 7 : elapsed < 600 ? 9 : 11),
    bossPressureAt: (elapsed) => (
      ordinaryBossPressure(elapsed) || (elapsed >= 780 && elapsed < 825 ? 0.18 : 0)
    ),
    messesAt: (elapsed) => (
      ordinaryMesses(elapsed) || (elapsed >= 780 && elapsed < 840) ? 1 : 0
    ),
  });

  assert.equal(earnedDampening(0), 0.16);
  assert.ok(Math.abs(earnedDampening(12 * 60) - 0.46) < 1e-9);
  assert.equal(progressed.failedAt, null);
  assert.ok(progressed.chaos < base.chaos * 0.7, 'earned dampening should remain powerful');
  assert.ok(progressed.minute[15] >= 35 && progressed.minute[15] <= 55, `progressed late Chaos was ${progressed.minute[15]}`);
  assert.ok(progressed.minute[15] > progressed.minute[12] + 20, 'the closing wave must still move the meter');
});

test('an overwhelmed floor loses around mid-shift, not at the old five-minute cliff', () => {
  const overwhelmed = (dampening) => projectChaos({
    dampening,
    floorAt: (elapsed) => Math.min(80, 16 + elapsed / 10),
    shelvedPerMinuteAt: () => 3,
    comboAt: () => 2,
    bossPressureAt: (elapsed) => (
      elapsed >= 240 && elapsed < 315 ? 0.16
        : elapsed >= 510 && elapsed < 570 ? 0.2
          : elapsed >= 780 && elapsed < 840 ? 0.25
            : 0
    ),
    messesAt: (elapsed) => (
      (elapsed >= 570 && elapsed < 650) || (elapsed >= 780 && elapsed < 860) ? 1 : 0
    ),
  });

  const base = overwhelmed(0);
  const progressed = overwhelmed(0.32);
  assert.ok(base.failedAt >= 7 * 60 && base.failedAt <= 9 * 60, `base failed at ${base.failedAt / 60}m`);
  assert.ok(progressed.failedAt >= 8 * 60 && progressed.failedAt <= 11 * 60, `progressed failed at ${progressed.failedAt / 60}m`);
});

test('strong disaster cleanup creates a road back, then late pressure resumes above five', () => {
  const result = projectChaos({
    from: 9 * 60,
    initialChaos: 72,
    floorAt: (elapsed) => Math.max(8, 52 - (elapsed - 9 * 60) * 0.12),
    shelvedPerMinuteAt: (elapsed) => (elapsed < 12 * 60 ? 18 : 12),
    comboAt: () => 18,
    recoveryAt: (elapsed) => elapsed < 10 * 60,
  });

  assert.ok(result.minute[10] <= 40, `cleanup window only reached ${result.minute[10]}`);
  assert.ok(result.chaos < 50, `recovery ended at ${result.chaos}`);
  assert.ok(result.chaos > CHAOS_BALANCE.cleanFloorChaosFloor, 'late pressure should resume after recovery');
});
