import assert from 'node:assert/strict';
import test from 'node:test';

import { HUD } from '../src/ui/hud.js';

test('a fresh locked run clears previous power readiness and level pips', () => {
  const classes = new Set(['ready']);
  const key = { textContent: '' };
  const cd = { style: { transform: '' } };
  const pip = { innerHTML: '<i></i><i></i>' };
  Object.defineProperty(pip, 'children', { get: () => pip.innerHTML ? [{}, {}] : [] });
  const el = {
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); },
    },
    querySelector(selector) { return selector === '.key' ? key : selector === '.cd' ? cd : pip; },
  };
  const hud = {
    game: {
      input: { bindingFor: () => 'KeyQ' },
      powers: { levels: { gravityGun: 0 } },
    },
    powerEls: new Map([['gravityGun', el]]),
  };

  HUD.prototype._updatePowers.call(hud);
  assert.equal(classes.has('locked'), true);
  assert.equal(classes.has('ready'), false);
  assert.equal(pip.innerHTML, '');
  assert.equal(cd.style.transform, 'scaleY(0)');
});

test('power HUD shows controller controls and highlights the taught signature power', () => {
  const classes = new Set();
  const key = { textContent: '' };
  const cd = { style: { transform: '' } };
  const pip = { innerHTML: '' };
  Object.defineProperty(pip, 'children', { get: () => [] });
  const el = {
    classList: {
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      remove(name) { classes.delete(name); },
    },
    querySelector(selector) { return selector === '.key' ? key : selector === '.cd' ? cd : pip; },
  };
  const hud = {
    game: {
      input: { usingGamepad: true, bindingFor: () => 'KeyE' },
      powers: { levels: { bookerang: 1 }, cooldownFraction: () => 1 },
    },
    tutorial: { activeIntro: true, step: 'power', powerAction: 'bookerang' },
    powerEls: new Map([['bookerang', el]]),
  };

  HUD.prototype._updatePowers.call(hud);
  assert.equal(key.textContent, 'Y / RB');
  assert.equal(classes.has('tutorial-target'), true);
});

test('clean-up HUD names the active keyboard or controller mop control', () => {
  const key = { textContent: '' };
  const context = {
    game: {
      disasters: { currentMess: { progress: 0.25 } },
      input: { usingGamepad: true, bindingFor: () => 'KeyR' },
    },
    el: {
      mopper: { classList: { toggle() {} } },
      mopKey: key,
      mopFill: { style: { width: '' } },
    },
  };
  HUD.prototype._updateMopper.call(context);
  assert.equal(key.textContent, 'B');
  context.game.input.usingGamepad = false;
  HUD.prototype._updateMopper.call(context);
  assert.equal(key.textContent, 'R');
});

test('typing a backquote in the seed field does not toggle the debug HUD', () => {
  const classes = new Set();
  const context = {
    debugOn: false,
    el: { debug: { classList: { toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } } },
  };
  const seedInput = { closest: (selector) => selector.includes('input') ? {} : null };
  const page = { closest: () => null };

  HUD.prototype._handleDebugKey.call(context, { code: 'Backquote', target: seedInput });
  assert.equal(context.debugOn, false);
  HUD.prototype._handleDebugKey.call(context, { code: 'Backquote', target: page });
  assert.equal(context.debugOn, true);
  assert.equal(classes.has('on'), true);
});

test('a new HUD run clears old toasts, banners, and popup entities', () => {
  const calls = [];
  const popup = { style: { display: 'block' } };
  const hud = {
    el: { toasts: { replaceChildren: () => calls.push('toasts') } },
    root: { querySelectorAll: () => [{ remove: () => calls.push('banner') }] },
    activePopups: [{ el: popup }],
    popupPool: [],
  };

  HUD.prototype._clearTransient.call(hud);
  assert.deepEqual(calls, ['toasts', 'banner']);
  assert.equal(popup.style.display, 'none');
  assert.deepEqual(hud.activePopups, []);
  assert.deepEqual(hud.popupPool, [popup]);
});

test('HUD leaves the accessibility tree whenever it is visually hidden', () => {
  const attrs = [];
  const classes = new Set();
  const root = {
    inert: true,
    setAttribute: (name, value) => attrs.push([name, value]),
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
  };
  const context = {
    root,
    game: { progression: { levels: {} } },
    _clearTransient() {},
    cartography: 1,
    _mmStatic: {},
  };

  HUD.prototype.show.call(context);
  assert.equal(root.inert, false);
  assert.equal(classes.has('on'), true);
  HUD.prototype.hide.call(context);
  assert.equal(root.inert, true);
  assert.equal(classes.has('on'), false);
  assert.deepEqual(attrs, [['aria-hidden', 'false'], ['aria-hidden', 'true']]);
});
