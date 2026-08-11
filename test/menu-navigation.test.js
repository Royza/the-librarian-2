import assert from 'node:assert/strict';
import test from 'node:test';

import { capturedDailyRunOptions, dailyRunOptionsForTheme, formatTip, Menus, stepSelect } from '../src/ui/menus.js';

test('keyboard and controller directions change a focused seed branch select', () => {
  const events = [];
  const select = {
    options: { length: 4 },
    selectedIndex: 0,
    dispatchEvent: (event) => events.push(event.type),
  };

  assert.equal(stepSelect(select, 'right'), true);
  assert.equal(select.selectedIndex, 1);
  assert.deepEqual(events, ['input', 'change']);
  assert.equal(stepSelect(select, 'up'), true);
  assert.equal(select.selectedIndex, 0);
  assert.equal(stepSelect(select, 'left'), false);
  assert.equal(select.selectedIndex, 0);
});

test('daily branch changes derive that branch seed while preserving the captured day', () => {
  const options = dailyRunOptionsForTheme({
    challenge: 'daily', dailyDay: '2026-08-07', seed: 'daily:2026-08-07:library', seedTheme: 'library', fromResults: true,
  }, 'grocery');
  assert.equal(options.seed, 'daily:2026-08-07:grocery');
  assert.equal(options.dailyDay, '2026-08-07');
  assert.equal(options.fromResults, true);
});

test('the main-menu Daily button carries the exact UTC day it rendered', () => {
  assert.deepEqual(capturedDailyRunOptions({ id: '2026-08-07' }), {
    challenge: 'daily', dailyDay: '2026-08-07',
  });
});

test('leaving a results retry path disposes the finished run and restores menu state', () => {
  const calls = [];
  const context = {
    game: {
      state: 'victory',
      disposeRun: () => calls.push('dispose'),
      showMenu: () => calls.push('menu'),
    },
    showMain: () => calls.push('plain-main'),
  };
  Menus.prototype._returnToMain.call(context);
  assert.deepEqual(calls, ['dispose', 'menu']);
});

test('erasing progression requires confirmation and reapplies reset runtime settings', () => {
  const calls = [];
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { confirm: () => false } });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { removeItem: (key) => calls.push(['remove-history', key]) },
  });
  const settings = { quality: 'low', master: 0.8, music: 0.5, sfx: 0.85, keyBindings: {} };
  const context = {
    game: {
      save: { settings, reset: () => calls.push('reset') },
      input: { setBindings: (v) => calls.push(['bindings', v]) },
      render: { setQuality: (v) => calls.push(['quality', v]) },
      audio: {
        setVolume: (v) => calls.push(['master', v]),
        setMusicVolume: (v) => calls.push(['music', v]),
        setSfxVolume: (v) => calls.push(['sfx', v]),
        play: () => calls.push('sound'),
      },
    },
    _applyAccessibilitySettings: () => calls.push('accessibility'),
    _returnFromSettings: () => calls.push('return'),
  };

  assert.equal(Menus.prototype._resetSave.call(context), false);
  assert.deepEqual(calls, []);
  globalThis.window.confirm = () => true;
  assert.equal(Menus.prototype._resetSave.call(context), true);
  assert.deepEqual(calls, [
    'reset', ['remove-history', 'librarian2.playtests.v1'], ['bindings', {}], ['quality', 'low'], ['master', 0.8],
    ['music', 0.5], ['sfx', 0.85], 'accessibility', 'sound', 'return',
  ]);
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage });
});

for (const origin of ['resume button', 'draft card']) {
  test(`closing the overlay hands keyboard focus from the ${origin} to gameplay`, () => {
    const calls = [];
    const active = { blur: () => calls.push('blur') };
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: active } });
    const context = {
      root: {
        contains: (el) => el === active,
        classList: { remove: () => calls.push('hide') },
        setAttribute: (name, value) => calls.push([name, value]),
        inert: false,
      },
      backBtn: { classList: { remove() {} } },
      game: { state: 'playing', canvas: { focus: () => calls.push('canvas') } },
      _captureCleanup: null,
      _keyHandler: null,
    };

    Menus.prototype.hideAll.call(context);
    assert.deepEqual(calls, ['blur', 'canvas', ['aria-hidden', 'true'], 'hide']);
    assert.equal(context.root.inert, true);
    Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
  });
}

test('starting from replaced loading markup still hands body focus to gameplay', () => {
  const calls = [];
  const active = { tagName: 'BODY' };
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { activeElement: active } });
  const context = {
    root: {
      contains: () => false,
      classList: { remove: () => calls.push('hide') },
      setAttribute() {},
      inert: false,
    },
    backBtn: { classList: { remove() {} } },
    game: { state: 'playing', canvas: { focus: () => calls.push('canvas') } },
    _captureCleanup: null,
    _keyHandler: null,
  };

  Menus.prototype.hideAll.call(context);
  assert.deepEqual(calls, ['canvas', 'hide']);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
});

test('only an open overlay participates in accessibility and focus navigation', () => {
  const attrs = [];
  const originalRAF = globalThis.requestAnimationFrame;
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
  const context = {
    sheet: {
      innerHTML: '', classList: { toggle() {} }, scrollTop: 4,
      style: {}, offsetHeight: 10,
    },
    root: {
      inert: true,
      setAttribute: (name, value) => attrs.push([name, value]),
      classList: { add() {} },
    },
    backBtn: { classList: { toggle() {} } },
    _applyAccessibilitySettings() {},
  };

  Menus.prototype._show.call(context, '<button>Resume</button>', 'pause');
  assert.equal(context.root.inert, false);
  assert.deepEqual(attrs, [['aria-hidden', 'false']]);
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: originalRAF });
});

test('navigating away from Settings cancels an active key-remap capture', () => {
  const calls = [];
  const originalRAF = globalThis.requestAnimationFrame;
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: () => 1 });
  const context = {
    sheet: { innerHTML: '', classList: { toggle() {} }, scrollTop: 0, style: {}, offsetHeight: 1 },
    root: { inert: false, setAttribute() {}, classList: { add() {}, contains: () => false } },
    backBtn: { classList: { toggle() {} } },
    _captureCleanup: () => calls.push('cancel-capture'),
    _applyAccessibilitySettings() {},
  };

  Menus.prototype._show.call(context, '<button>Play</button>', 'main');
  assert.deepEqual(calls, ['cancel-capture']);
  assert.equal(context._captureCleanup, null);
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: originalRAF });
});

test('a stale remap timeout cannot orphan a newer capture listener', () => {
  const originalWindow = globalThis.window;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const handlers = [];
  let staleFinish = null;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (type, fn) => { if (type === 'keydown') handlers.push(fn); },
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, 'setTimeout', {
    configurable: true,
    value: (fn) => { staleFinish = fn; return 7; },
  });
  Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: () => {} });
  const button = (action) => ({
    dataset: { bind: action }, textContent: action, isConnected: true,
    classList: { add() {}, remove() {} },
  });
  const context = {
    _captureCleanup: null,
    game: {
      input: { bindingFor: (action) => action === 'up' ? 'KeyW' : 'KeyS', setBindings() {} },
      save: { settings: { keyBindings: {} }, setSetting() {} },
    },
    showSettings() {},
  };

  Menus.prototype._captureBinding.call(context, button('up'));
  handlers[0]({ code: 'KeyM', preventDefault() {}, stopImmediatePropagation() {} });
  const oldTimeout = staleFinish;
  Menus.prototype._captureBinding.call(context, button('down'));
  const currentCleanup = context._captureCleanup;
  oldTimeout();
  assert.equal(context._captureCleanup, currentCleanup);
  currentCleanup();
  assert.equal(context._captureCleanup, null);

  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'setTimeout', { configurable: true, value: originalSetTimeout });
  Object.defineProperty(globalThis, 'clearTimeout', { configurable: true, value: originalClearTimeout });
});

test('controller level-up cards advertise their actual power button', () => {
  let html = '';
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
  const context = {
    game: {
      run: { tutorialActive: false },
      hud: { tutorial: null },
      input: { usingGamepad: true, bindingFor: () => 'KeyQ' },
      progression: { levels: {}, currentOffer: [{}], choose() {}, reroll() {} },
    },
    _show: (markup) => { html = markup; },
    _click() {},
    _keyHandler: null,
  };
  Menus.prototype.showLevelUp.call(context, [{
    id: 'gravityGun', kind: 'power', icon: 'Q', name: 'Beam', desc: () => 'Pull items.',
  }], 2, 0);

  assert.match(html, /BUTTON LB \/ LT/);
  assert.doesNotMatch(html, /KEY Q/);
  context._keyHandler?.();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});

test('pause tips switch every advertised action to controller controls', () => {
  const game = { input: { usingGamepad: true, bindingFor: () => 'KeyZ' } };
  assert.equal(
    formatTip('<b>WASD</b> · <b>Shift</b> · <b>Space</b>', game),
    '<b>LEFT STICK</b> · <b>RT</b> · <b>A</b>',
  );
  assert.equal(
    formatTip('<b>Q</b> · <b>E</b> · <b>F</b> · <b>R</b>', game),
    '<b>LB / LT</b> · <b>Y / RB</b> · <b>X</b> · <b>B</b>',
  );
});

test('Settings rerenders restore focus to the semantic control that changed', () => {
  const calls = [];
  const originalRAF = globalThis.requestAnimationFrame;
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (fn) => { fn(); return 1; } });
  const context = {
    current: 'settings',
    root: { classList: { contains: (name) => name === 'on' } },
    sheet: { querySelector: (selector) => ({ focus: () => calls.push(selector) }) },
  };

  Menus.prototype._focusAfterRender.call(context, '[data-setting-bool="tutorials"] [data-v="false"]', 'settings');
  assert.deepEqual(calls, ['[data-setting-bool="tutorials"] [data-v="false"]']);
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: originalRAF });
});

test('Settings opened during a run retain Pause as their back route through rerenders', () => {
  let back = null;
  const context = {
    current: 'pause',
    _settingsReturnScreen: 'main',
    _settingsMessage: '',
    game: {
      save: {
        settings: {
          master: 0.8, music: 0.5, sfx: 0.85, tutorials: true,
          colorLabels: false, reducedMotion: false, invertCameraY: false,
          textScale: 1, keyBindings: {},
        },
      },
      render: { quality: 'low' },
      input: { bindingFor: () => 'KeyZ' },
    },
    sheet: { querySelectorAll: () => [] },
    _show(markup, name, onBack) { this.current = name; back = onBack; },
    _click() {},
    _focusAfterRender() {},
    _returnFromSettings() {},
  };

  Menus.prototype.showSettings.call(context);
  assert.equal(context._settingsReturnScreen, 'pause');
  assert.equal(typeof back, 'function');

  // A boolean/quality change rebuilds Settings while current === settings.
  Menus.prototype.showSettings.call(context, '[data-setting-bool="invertCameraY"]');
  assert.equal(context._settingsReturnScreen, 'pause');

  // Returning from a nested Settings screen must retain the same destination.
  context.current = 'playtest-history';
  Menus.prototype.showSettings.call(context);
  assert.equal(context._settingsReturnScreen, 'pause');
});

test('Settings back returns to the paused run without resuming it', () => {
  const calls = [];
  const context = {
    _settingsReturnScreen: 'pause',
    game: { state: 'paused', run: {}, progression: {} },
    showPause: () => calls.push('pause'),
    showMain: () => calls.push('main'),
  };

  Menus.prototype._returnFromSettings.call(context);
  assert.deepEqual(calls, ['pause']);
  assert.equal(context.game.state, 'paused');

  context.game.state = 'menu';
  Menus.prototype._returnFromSettings.call(context);
  assert.deepEqual(calls, ['pause', 'main']);
});

test('owned Escape backs out of paused Settings without leaking to the global pause shortcut', () => {
  const calls = [];
  const context = {
    root: { classList: { contains: (name) => name === 'on' } },
    onBack: () => calls.push('back'),
    game: { audio: { play: (id) => calls.push(id) } },
  };
  const event = {
    code: 'Escape',
    stopImmediatePropagation: () => calls.push('stopped'),
  };

  assert.equal(Menus.prototype._handleOverlayBackKey.call(context, event), true);
  assert.deepEqual(calls, ['stopped', 'ui', 'back']);
});

test('changing vertical drag inversion persists and applies the camera setting immediately', () => {
  const calls = [];
  const originalDocument = globalThis.document;
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { documentElement: { classList: { toggle() {} } } },
  });
  const settings = {
    invertCameraY: false, textScale: 1, reducedMotion: false, colorLabels: false,
  };
  const context = {
    game: {
      save: {
        settings,
        setSetting: (key, value) => { settings[key] = value; calls.push(['save', key, value]); },
      },
      uiRoot: { style: { setProperty() {} } },
      render: { setReducedMotion() {} },
      camera: { setReducedMotion() {} },
      applyCameraSettings: () => calls.push(['camera', settings.invertCameraY]),
    },
  };
  context._applyAccessibilitySettings = () => Menus.prototype._applyAccessibilitySettings.call(context);

  Menus.prototype._applyBooleanSetting.call(context, 'invertCameraY', true);
  assert.deepEqual(calls, [
    ['save', 'invertCameraY', true],
    ['camera', true],
  ]);
  Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
});

test('audio sliders keep applying immediately while Settings is opened from Pause', () => {
  const calls = [];
  const sliders = ['master', 'music', 'sfx'].map((key, index) => {
    const handlers = {};
    return {
      dataset: { set: key }, value: String(0.2 + index * 0.1), handlers,
      classList: { add() {} },
      addEventListener: (type, handler) => { handlers[type] = handler; },
    };
  });
  const settings = {
    master: 0.8, music: 0.5, sfx: 0.85, tutorials: true,
    colorLabels: false, reducedMotion: false, invertCameraY: false,
    textScale: 1, keyBindings: {},
  };
  const context = {
    current: 'pause', _settingsReturnScreen: 'main', _settingsMessage: '',
    game: {
      state: 'paused',
      save: {
        settings,
        setSetting: (key, value) => calls.push(['save', key, value]),
      },
      render: { quality: 'low' },
      input: { bindingFor: () => 'KeyZ' },
      audio: {
        setVolume: (value) => calls.push(['master', value]),
        setMusicVolume: (value) => calls.push(['music', value]),
        setSfxVolume: (value) => calls.push(['sfx', value]),
      },
    },
    sheet: { querySelectorAll: (selector) => selector === 'input[data-set]' ? sliders : [] },
    _show(markup, name) { this.current = name; },
    _click() {}, _focusAfterRender() {}, _returnFromSettings() {},
  };

  Menus.prototype.showSettings.call(context);
  sliders.forEach((slider) => slider.handlers.input());
  assert.deepEqual(calls, [
    ['save', 'master', 0.2], ['master', 0.2],
    ['save', 'music', 0.30000000000000004], ['music', 0.30000000000000004],
    ['save', 'sfx', 0.4], ['sfx', 0.4],
  ]);
  assert.equal(context.game.state, 'paused');
});

test('Pause includes a Settings route that keeps the run paused', () => {
  let markup = '';
  const actions = new Map();
  const calls = [];
  const context = {
    game: {
      state: 'paused', seed: 'pause-test', theme: { name: 'Library' },
      run: { isDaily: false, shelved: 2, kidsCalmed: 1, chaos: 12 },
      progression: { level: 3, levels: {} },
      input: { usingGamepad: false, bindingFor: () => 'KeyZ' },
      resume: () => calls.push('resume'),
      endRun: () => calls.push('quit'),
    },
    _show: (html) => { markup = html; },
    _click: (selector, handler) => actions.set(selector, handler),
    showSettings: (...args) => calls.push(['settings', ...args]),
    _copySeed() {},
  };

  Menus.prototype.showPause.call(context);
  assert.match(markup, /data-a="settings">SETTINGS/);
  actions.get('[data-a="settings"]')();
  assert.deepEqual(calls, [['settings', null, 'pause']]);
  assert.equal(context.game.state, 'paused');
});

test('held R key repeat cannot consume multiple draft rerolls', () => {
  let onKey = null;
  let rerolls = 0;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: (type, fn) => { if (type === 'keydown') onKey = fn; },
      removeEventListener() {},
    },
  });
  const context = {
    game: {
      run: { tutorialActive: false }, hud: { tutorial: null },
      input: { usingGamepad: false, bindingFor: () => 'KeyQ' },
      progression: {
        levels: {}, currentOffer: [{}], choose() {}, reroll: () => { rerolls++; },
      },
    },
    _show() {}, _click() {}, _keyHandler: null,
  };
  Menus.prototype.showLevelUp.call(context, [{
    id: 'backpack', kind: 'passive', icon: 'B', name: 'Backpack', desc: () => 'Carry more.',
  }], 2, 2);
  let prevented = 0;
  onKey({ key: 'r', repeat: true, preventDefault: () => { prevented++; } });
  assert.equal(rerolls, 0);
  onKey({ key: 'r', repeat: false, preventDefault: () => { prevented++; } });
  assert.equal(rerolls, 1);
  assert.equal(prevented, 1);
  context._keyHandler?.();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
});
