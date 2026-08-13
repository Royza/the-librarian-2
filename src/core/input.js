// Keyboard + mouse + gamepad input. Actions are polled, edges are consumed.

export const DEFAULT_BINDINGS = Object.freeze({
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  gravityGun: 'KeyQ',
  bookerang: 'KeyE',
  colorPulse: 'KeyF',
  dash: 'Space',
  mop: 'KeyR',
  pause: 'Escape',
  mute: 'KeyM',
});

export const REMAP_ACTIONS = Object.freeze([
  ['up', 'MOVE UP'], ['down', 'MOVE DOWN'], ['left', 'MOVE LEFT'], ['right', 'MOVE RIGHT'],
  ['sprint', 'SPRINT'], ['dash', 'DODGE'], ['gravityGun', 'STAKE ATTACK'],
  ['bookerang', 'SLAYER KICK'], ['colorPulse', 'SPECIAL'], ['mop', 'INTERACT'],
]);

export function formatKeyCode(code) {
  if (!code) return '—';
  const names = {
    Space: 'SPACE', ShiftLeft: 'L SHIFT', ShiftRight: 'R SHIFT',
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Escape: 'ESC', Backquote: '`', BracketLeft: '[', BracketRight: ']',
    Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  };
  if (names[code]) return names[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '');
}

// Standard-layout controller labels. Powers deliberately expose every valid
// shortcut so onboarding copy and the HUD match what Input actually accepts.
const GAMEPAD_LABELS = Object.freeze({
  sprint: 'RT',
  dash: 'A',
  gravityGun: 'LB / LT',
  bookerang: 'Y / RB',
  colorPulse: 'X',
  mop: 'B',
  pause: 'START',
});

export function gamepadLabelFor(action) {
  return GAMEPAD_LABELS[action] || 'BUTTON';
}

// These accessibility aliases remain available even when the primary WASD or
// Shift binding is changed. Escape and P also remain reliable pause exits.
const ACCESSIBLE_ALIASES = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  ShiftRight: 'sprint', KeyP: 'pause', Backquote: 'debug',
};

export function isEditableTarget(target) {
  return !!target?.closest?.('input, textarea, select, [contenteditable="true"]');
}

function isInteractiveControlTarget(target) {
  return !!target?.closest?.('button, input, select, textarea, summary, a[href], [role="button"], [contenteditable="true"]');
}

const GAMEPAD_ACTIONS = [
  [0, 'dash'], [1, 'mop'], [2, 'colorPulse'], [3, 'bookerang'],
  [4, 'gravityGun'], [5, 'bookerang'], [6, 'gravityGun'], [7, 'sprint'],
  [9, 'pause'],
];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    // Programmatic focus gives menus a reliable handoff target when they close.
    // `-1` keeps the canvas out of the user's normal Tab order.
    if (canvas?.setAttribute && !canvas.hasAttribute?.('tabindex')) canvas.setAttribute('tabindex', '-1');
    this.down = new Set();
    this.pressed = new Set();     // edge: went down this frame
    this.released = new Set();
    this.mouse = {
      x: 0, y: 0, ndcX: 0, ndcY: 0,
      down: false, downEdge: false, rightDown: false,
      dragX: 0, dragY: 0, dragging: false,
      wheel: 0,
    };
    this.enabled = true;
    this.gamepadIndex = null;
    this.usingGamepad = false;
    this._axes = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
    this.bindings = { ...DEFAULT_BINDINGS };
    this._keymap = new Map();
    this._keyboardCodes = new Set();
    this._gamepadDown = new Set();
    this._suppressedGamepad = new Set();
    this._menuHeld = new Set();
    this._rebuildKeymap();

    window.addEventListener('keydown', (e) => {
      // Keyboard ownership changes modality even when a native menu control
      // consumes the key and no gameplay action is queued.
      this.usingGamepad = false;
      const a = this._keymap.get(e.code);
      // Native buttons, text fields, selects, and custom menu cards own their
      // keys. In particular Space must activate a focused control, not queue a
      // dash that leaks into the run it starts or resumes.
      if (isInteractiveControlTarget(e.target)) return;
      if (a === 'dash') e.preventDefault();
      if (!a) return;
      this._keyboardCodes.add(e.code);
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = this._keymap.get(e.code);
      this._keyboardCodes.delete(e.code);
      if (!a) return;
      if (!this._keyHeld(a) && !this._gamepadDown.has(a)) this.down.delete(a);
      this.released.add(a);
    });
    window.addEventListener('blur', () => {
      this._keyboardCodes.clear();
      for (const a of [...this.down]) if (!this._gamepadDown.has(a)) this.down.delete(a);
      // Focus loss can swallow keyup/mouseup and suspend rAF before endFrame.
      // Discard all one-frame edges and pointer transients so returning to the
      // game cannot fire an old dash/power or leave a mouse button stuck.
      this.pressed.clear();
      this.released.clear();
      this.mouse.down = false;
      this.mouse.rightDown = false;
      this.mouse.downEdge = false;
      this.mouse.dragX = 0;
      this.mouse.dragY = 0;
      this.mouse.dragging = false;
      this.mouse.wheel = 0;
      this._mouseClientX = null;
      this._mouseClientY = null;
      this.canvas?.classList?.remove('camera-dragging');
    });
    window.addEventListener('pointerdown', () => { this.usingGamepad = false; }, true);

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.ndcX = (this.mouse.x / r.width) * 2 - 1;
      this.mouse.ndcY = -(this.mouse.y / r.height) * 2 + 1;
      this.usingGamepad = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.down = true;
        this.mouse.downEdge = true;
        this.mouse.dragging = true;
        this._mouseClientX = Number.isFinite(e.clientX) ? e.clientX : null;
        this._mouseClientY = Number.isFinite(e.clientY) ? e.clientY : null;
        this.canvas?.classList?.add('camera-dragging');
        e.preventDefault?.();
      }
      if (e.button === 2) this.mouse.rightDown = true;
    });
    // Listen on the window while dragging so orbiting remains continuous when
    // the pointer briefly leaves the canvas or crosses the HUD.
    window.addEventListener('mousemove', (e) => {
      if (!this.mouse.down) return;
      const fallbackX = this._mouseClientX === null || !Number.isFinite(e.clientX) ? 0 : e.clientX - this._mouseClientX;
      const fallbackY = this._mouseClientY === null || !Number.isFinite(e.clientY) ? 0 : e.clientY - this._mouseClientY;
      const dx = Number.isFinite(e.movementX) ? e.movementX : fallbackX;
      const dy = Number.isFinite(e.movementY) ? e.movementY : fallbackY;
      // A tab switch or monitor boundary can report a huge jump. Bound a
      // single event without limiting deliberate multi-event drags.
      this.mouse.dragX += Math.max(-160, Math.min(160, dx));
      this.mouse.dragY += Math.max(-160, Math.min(160, dy));
      if (Number.isFinite(e.clientX)) this._mouseClientX = e.clientX;
      if (Number.isFinite(e.clientY)) this._mouseClientY = e.clientY;
      this.usingGamepad = false;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouse.down = false;
        this.mouse.dragging = false;
        this._mouseClientX = null;
        this._mouseClientY = null;
        this.canvas?.classList?.remove('camera-dragging');
      }
      if (e.button === 2) this.mouse.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.gamepadIndex) return;
      this.gamepadIndex = null;
      for (const a of this._gamepadDown) if (!this._keyHeld(a)) this.down.delete(a);
      this._gamepadDown.clear();
      this._suppressedGamepad.clear();
      this._menuHeld.clear();
    });
  }

  setBindings(custom = {}) {
    this.bindings = { ...DEFAULT_BINDINGS };
    for (const action of Object.keys(DEFAULT_BINDINGS)) {
      if (typeof custom[action] !== 'string' || !custom[action]) continue;
      // M is a global safety control and is intentionally not remappable.
      if (action !== 'mute' && custom[action] === DEFAULT_BINDINGS.mute) continue;
      this.bindings[action] = custom[action];
    }
    this._rebuildKeymap();
    // A binding can change while the settings screen is open. Clear stale
    // keyboard actions so a previously held key never sticks after remapping.
    this._keyboardCodes.clear();
    for (const a of [...this.down]) if (!this._gamepadDown.has(a)) this.down.delete(a);
  }

  bindingFor(action) { return this.bindings[action] || DEFAULT_BINDINGS[action] || ''; }

  _rebuildKeymap() {
    this._keymap.clear();
    for (const [code, action] of Object.entries(ACCESSIBLE_ALIASES)) this._keymap.set(code, action);
    for (const [action, code] of Object.entries(this.bindings)) this._keymap.set(code, action);
  }

  pollGamepad() {
    this._axes.moveX = 0; this._axes.moveY = 0;
    this._axes.aimX = 0; this._axes.aimY = 0;

    // A controller may already be connected before the game constructs Input.
    if (this.gamepadIndex === null) {
      const first = [...(navigator.getGamepads?.() || [])].find(Boolean);
      if (first) this.gamepadIndex = first.index;
    }
    if (this.gamepadIndex === null) return;
    const gp = navigator.getGamepads?.()[this.gamepadIndex];
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.18 ? 0 : v);
    const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0);
    const rx = dz(gp.axes[2] || 0), ry = dz(gp.axes[3] || 0);
    if (lx || ly || rx || ry) this.usingGamepad = true;
    this._axes.moveX = lx; this._axes.moveY = ly;
    this._axes.aimX = rx; this._axes.aimY = ry;

    const btn = (i) => !!gp.buttons[i]?.pressed;
    const nextGamepad = new Set();
    for (const [i, action] of GAMEPAD_ACTIONS) {
      if (!btn(i)) continue;
      nextGamepad.add(action);
      if (this._suppressedGamepad.has(action)) continue;
      if (!this._gamepadDown.has(action) && !this.down.has(action)) this.pressed.add(action);
      this.down.add(action);
      this.usingGamepad = true;
    }
    for (const action of this._gamepadDown) {
      if (!nextGamepad.has(action) && !this._keyHeld(action)) this.down.delete(action);
    }
    for (const action of [...this._suppressedGamepad]) {
      if (!nextGamepad.has(action)) this._suppressedGamepad.delete(action);
    }
    this._gamepadDown = nextGamepad;

    // Menu navigation is emitted as edges so a held stick cannot fly through
    // every card. Menus ignores these events when its overlay is closed.
    const menu = new Set();
    if (btn(12) || ly < -0.62) menu.add('up');
    if (btn(13) || ly > 0.62) menu.add('down');
    if (btn(14) || lx < -0.62) menu.add('left');
    if (btn(15) || lx > 0.62) menu.add('right');
    if (btn(0)) menu.add('activate');
    if (btn(1)) menu.add('back');
    if (btn(9)) menu.add('start');
    for (const command of menu) {
      if (this._menuHeld.has(command)) continue;
      window.dispatchEvent(new CustomEvent('librarian:menu-nav', { detail: { command } }));
    }
    this._menuHeld = menu;
  }

  _keyHeld(action) {
    for (const code of this._keyboardCodes) if (this._keymap.get(code) === action) return true;
    return false;
  }

  isDown(a) { return this.enabled && this.down.has(a); }
  wasPressed(a) { return this.enabled && this.pressed.has(a); }
  consumePressed(a) { this.pressed.delete(a); }

  /** Keep a menu button from also acting on gameplay until it is released. */
  suppressGamepadAction(action) {
    this.pressed.delete(action);
    if (!this._keyHeld(action)) this.down.delete(action);
    this._suppressedGamepad.add(action);
  }

  // Raw movement vector in screen/world XZ space (camera-relative rotation applied by caller).
  moveVector() {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = 0, y = 0;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('right')) x += 1;
    if (this.down.has('up')) y -= 1;
    if (this.down.has('down')) y += 1;
    if (this._axes.moveX || this._axes.moveY) { x = this._axes.moveX; y = this._axes.moveY; }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y };
  }

  aimVector() { return { x: this._axes.aimX, y: this._axes.aimY }; }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.downEdge = false;
    this.mouse.dragX = 0;
    this.mouse.dragY = 0;
    this.mouse.wheel = 0;
  }
}
