import assert from 'node:assert/strict';
import test from 'node:test';

import { Input, isEditableTarget } from '../src/core/input.js';

function harness() {
  const handlers = new Map();
  const windowStub = {
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of handlers.get(event.type) || []) fn(event);
      return true;
    },
  };
  const canvasHandlers = new Map();
  const canvas = {
    addEventListener(type, fn) { canvasHandlers.set(type, fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
  let pads = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowStub });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { getGamepads: () => pads },
  });
  if (typeof globalThis.CustomEvent !== 'function') {
    Object.defineProperty(globalThis, 'CustomEvent', {
      configurable: true,
      value: class CustomEvent { constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; } },
    });
  }
  return {
    canvas,
    emit(type, init = {}) {
      const event = {
        type,
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        stopPropagation() {},
        ...init,
      };
      windowStub.dispatchEvent(event);
      return event;
    },
    canvasEmit(type, init = {}) {
      const event = { button: 0, deltaY: 0, preventDefault() {}, ...init };
      canvasHandlers.get(type)?.(event);
      return event;
    },
    setPads(next) { pads = next; },
  };
}

function gamepad({ dash = false } = {}) {
  const buttons = Array.from({ length: 16 }, () => ({ pressed: false }));
  buttons[0] = { pressed: dash };
  return { index: 0, axes: [0, 0, 0, 0], buttons };
}

test('remapped keyboard bindings preserve arrow-key accessibility aliases', () => {
  const h = harness();
  const input = new Input(h.canvas);
  input.setBindings({ up: 'KeyI' });

  h.emit('keydown', { code: 'KeyW' });
  assert.equal(input.isDown('up'), false);
  h.emit('keydown', { code: 'KeyI' });
  assert.equal(input.isDown('up'), true);
  h.emit('keyup', { code: 'KeyI' });
  assert.equal(input.isDown('up'), false);
  h.emit('keydown', { code: 'ArrowUp' });
  assert.equal(input.isDown('up'), true);
});

test('the global mute key cannot be stolen by a gameplay remap', () => {
  const h = harness();
  const input = new Input(h.canvas);
  input.setBindings({ gravityGun: 'KeyM' });

  assert.equal(input.bindingFor('gravityGun'), 'KeyQ');
  h.emit('keydown', { code: 'KeyM' });
  assert.equal(input.isDown('mute'), true);
  assert.equal(input.isDown('gravityGun'), false);
});

test('keyboard release does not cancel a gamepad-held action', () => {
  const h = harness();
  const input = new Input(h.canvas);
  h.emit('keydown', { code: 'Space' });
  assert.equal(input.isDown('dash'), true);

  h.setPads([gamepad({ dash: true })]);
  input.pollGamepad();
  h.emit('keyup', { code: 'Space' });
  assert.equal(input.isDown('dash'), true);

  h.setPads([gamepad({ dash: false })]);
  input.pollGamepad();
  assert.equal(input.isDown('dash'), false);
});

test('native menu controls keep Space and Tab while gameplay keeps its dash key', () => {
  const h = harness();
  const input = new Input(h.canvas);
  const control = { closest: () => ({}) };
  const page = { closest: () => null };

  const controlSpace = h.emit('keydown', { code: 'Space', target: control });
  assert.equal(controlSpace.defaultPrevented, false);
  assert.equal(input.isDown('dash'), false);

  const summary = { closest: (selector) => selector.includes('summary') ? {} : null };
  const summarySpace = h.emit('keydown', { code: 'Space', target: summary });
  assert.equal(summarySpace.defaultPrevented, false);
  assert.equal(input.isDown('dash'), false);

  const tab = h.emit('keydown', { code: 'Tab', target: page });
  assert.equal(tab.defaultPrevented, false);

  const gameplaySpace = h.emit('keydown', { code: 'Space', target: page });
  assert.equal(gameplaySpace.defaultPrevented, true);
  assert.equal(input.wasPressed('dash'), true);
});

test('a gamepad menu action stays suppressed until its physical button is released', () => {
  const h = harness();
  const input = new Input(h.canvas);
  h.setPads([gamepad({ dash: true })]);
  input.pollGamepad();
  assert.equal(input.wasPressed('dash'), true);

  input.suppressGamepadAction('dash');
  assert.equal(input.wasPressed('dash'), false);
  assert.equal(input.isDown('dash'), false);
  input.endFrame();
  input.pollGamepad();
  assert.equal(input.wasPressed('dash'), false);

  h.setPads([gamepad({ dash: false })]);
  input.pollGamepad();
  h.setPads([gamepad({ dash: true })]);
  input.pollGamepad();
  assert.equal(input.wasPressed('dash'), true);
});

test('seed text fields retain native caret-editing arrow keys', () => {
  const seedInput = {
    closest: (selector) => selector.includes('input') ? seedInput : null,
  };
  assert.equal(isEditableTarget(seedInput), true);
});

test('window blur clears stale keyboard and mouse edges but preserves held gamepad state', () => {
  const h = harness();
  const input = new Input(h.canvas);
  h.emit('keydown', { code: 'Space' });
  h.canvasEmit('mousedown', { button: 0 });
  h.canvasEmit('mousedown', { button: 2 });
  h.canvasEmit('wheel', { deltaY: 4 });
  assert.equal(input.wasPressed('dash'), true);
  assert.equal(input.mouse.down, true);
  assert.equal(input.mouse.rightDown, true);
  assert.equal(input.mouse.wheel, 1);

  h.setPads([gamepad({ dash: true })]);
  input.pollGamepad();
  h.emit('blur');
  assert.equal(input.wasPressed('dash'), false);
  assert.equal(input.isDown('dash'), true);
  assert.equal(input.mouse.down, false);
  assert.equal(input.mouse.rightDown, false);
  assert.equal(input.mouse.downEdge, false);
  assert.equal(input.mouse.wheel, 0);
});

test('left-mouse dragging accumulates orbit deltas only while held and clears them per frame', () => {
  const h = harness();
  const input = new Input(h.canvas);

  h.emit('mousemove', { movementX: 40, movementY: -20, clientX: 40, clientY: 20 });
  assert.equal(input.mouse.dragX, 0);
  assert.equal(input.mouse.dragY, 0);

  h.canvasEmit('mousedown', { button: 0, clientX: 100, clientY: 80 });
  h.emit('mousemove', { movementX: 28, movementY: -14, clientX: 128, clientY: 66 });
  assert.equal(input.mouse.dragging, true);
  assert.equal(input.mouse.dragX, 28);
  assert.equal(input.mouse.dragY, -14);

  input.endFrame();
  assert.equal(input.mouse.dragX, 0);
  assert.equal(input.mouse.dragY, 0);
  assert.equal(input.mouse.dragging, true);

  h.emit('mouseup', { button: 0 });
  h.emit('mousemove', { movementX: 12, movementY: 9, clientX: 140, clientY: 75 });
  assert.equal(input.mouse.dragging, false);
  assert.equal(input.mouse.dragX, 0);
  assert.equal(input.mouse.dragY, 0);
});

test('keyboard and pointer use in menus take modality back from the controller', () => {
  const h = harness();
  const input = new Input(h.canvas);
  const control = { closest: () => ({}) };

  input.usingGamepad = true;
  h.emit('keydown', { code: 'Enter', target: control });
  assert.equal(input.usingGamepad, false);
  input.usingGamepad = true;
  h.emit('pointerdown', { target: control });
  assert.equal(input.usingGamepad, false);
});
