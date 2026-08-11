import assert from 'node:assert/strict';
import test from 'node:test';

import { Game, STATE } from '../src/game.js';
import { Progression } from '../src/systems/progression.js';

function makeStepContext() {
  const calls = { ended: [] };
  const inert = { update() {} };
  const context = {
    run: {
      duration: 900, elapsed: 0, sessionElapsed: 0, trainingElapsed: 0,
      tutorialActive: true, comboTimer: 0, combo: 0, chaos: 0, maxChaos: 100,
    },
    clock: 0,
    input: {},
    player: { update() {}, health: 100 },
    powers: inert,
    items: { update() {}, render() {} },
    kids: inert,
    bosses: { update() {}, active: [] },
    disasters: inert,
    director: inert,
    progression: inert,
    branchMechanics: inert,
    fx: inert,
    level: inert,
    render: { camera: {} },
    telemetry: inert,
    audio: { setIntensity() {} },
    _updateChaos() {},
    endRun: (won, reason) => calls.ended.push({ won, reason }),
  };
  return { context, calls };
}

test('first-shift training does not consume the scored fifteen-minute clock', () => {
  const { context, calls } = makeStepContext();
  Game.prototype._step.call(context, 180);
  assert.equal(context.run.elapsed, 0);
  assert.equal(context.run.sessionElapsed, 180);
  assert.equal(context.run.trainingElapsed, 180);
  assert.deepEqual(calls.ended, []);

  context.run.tutorialActive = false;
  Game.prototype._step.call(context, 899.9);
  assert.equal(context.run.elapsed, 899.9);
  assert.deepEqual(calls.ended, []);
  Game.prototype._step.call(context, 0.1);
  assert.deepEqual(calls.ended, [{ won: true, reason: 'survived' }]);
});

test('a new run explicitly restores gameplay input after results disabled it', () => {
  // This is a source-level lifecycle invariant: the transition itself remains
  // browser-covered, while the state values guard against accidental renames.
  assert.equal(STATE.PLAYING, 'playing');
  const source = Game.prototype.startRun.toString();
  assert.match(source, /this\.input\.enabled\s*=\s*true/);
});

test('persistent vertical camera inversion can be applied immediately at runtime', () => {
  const calls = [];
  const context = {
    save: { settings: { invertCameraY: true } },
    camera: { setInvertY: (enabled) => calls.push(enabled) },
  };

  Game.prototype.applyCameraSettings.call(context);
  assert.deepEqual(calls, [true]);

  context.save.settings.invertCameraY = false;
  Game.prototype.applyCameraSettings.call(context);
  assert.deepEqual(calls, [true, false]);
});

test('pause hotkeys do not resume through an open paused Settings screen', () => {
  const originalWindow = globalThis.window;
  let keydown = null;
  globalThis.window = {
    addEventListener(type, handler) {
      if (type === 'keydown') keydown = handler;
    },
  };

  const calls = [];
  const context = {
    state: STATE.PAUSED,
    menus: { current: 'settings' },
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    audio: { enabled: true, mute() {} },
  };

  try {
    Game.prototype._bindGlobalKeys.call(context);
    keydown({ repeat: false, code: 'Escape', target: null });
    keydown({ repeat: false, code: 'KeyP', target: null });
    assert.deepEqual(calls, []);

    context.menus.current = 'pause';
    keydown({ repeat: false, code: 'Escape', target: null });
    assert.deepEqual(calls, ['resume']);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('Second Wind catches Chaos added by the current frame before game over', () => {
  const { context, calls } = makeStepContext();
  context.seed = 'second-wind-order';
  context.run.tutorialActive = false;
  context.run.xpEarned = 0;
  context.player.heal = () => {};
  context.camera = { addTrauma() {} };
  context.fx = { update() {}, ring() {} };
  context.audio = { setIntensity() {}, play() {} };
  context.hud = { banner() {} };
  context.progression = new Progression(context);
  context.progression.secondWind = true;
  context._updateChaos = () => { context.run.chaos = 100; };

  Game.prototype._step.call(context, 1 / 60);
  assert.equal(context.run.chaos, 60);
  assert.equal(context.progression.secondWindUsed, true);
  assert.deepEqual(calls.ended, []);
});

test('abandoning guided training never records or rewards a run', () => {
  const calls = [];
  const run = {
    tutorialActive: true, shelved: 1, pickedUp: 1, kidsCalmed: 0,
    bossesBeaten: 0, disastersSurvived: 0, elapsed: 0, bestCombo: 1,
    xpEarned: 140, isDaily: false,
  };
  const context = {
    state: STATE.PLAYING,
    run,
    input: { enabled: true },
    progression: { cancelDraft: () => calls.push('cancel'), cardMultiplier: 1 },
    menus: { hideAll: () => calls.push('hide'), showResults: () => calls.push('results') },
    hud: {
      tutorial: { prepareRunEnd: () => { run.tutorialActive = false; run.shelved = 0; run.pickedUp = 0; run.xpEarned = 0; } },
      hide: () => calls.push('hud-hide'),
    },
    audio: { stopMusic() {}, play() {} },
    telemetry: { finish: () => calls.push('telemetry') },
    save: { addLifetime: () => calls.push('save'), recordDaily: () => calls.push('daily') },
    theme: { id: 'library' },
    events: { emit: () => calls.push('event') },
  };
  Game.prototype.endRun.call(context, false, 'quit');
  assert.equal(run.score, 0);
  assert.equal(run.unscoredTraining, true);
  assert.ok(!calls.includes('telemetry'));
  assert.ok(!calls.includes('save'));
  assert.ok(!calls.includes('daily'));
  assert.ok(calls.includes('results'));
});

test('disposing a run resets persistent renderer grading before menu reuse', () => {
  const calls = [];
  const disposable = { dispose() {} };
  const context = {
    telemetry: disposable, branchMechanics: disposable, player: disposable,
    kids: disposable, bosses: disposable, powers: disposable, disasters: disposable,
    items: disposable, fx: disposable, level: disposable, mats: null,
    render: {
      setLensDistortion: (x, y) => calls.push(['lens', x, y]),
      setChaosGrade: (v) => calls.push(['chaos', v]),
    },
  };

  Game.prototype.disposeRun.call(context);
  assert.deepEqual(calls, [['lens', 0, 0], ['chaos', 0]]);
  assert.equal(context.level, null);
  assert.equal(context.player, null);
});
