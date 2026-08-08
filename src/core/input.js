// Keyboard + mouse + gamepad input. Actions are polled, edges are consumed.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyQ: 'gravityGun',
  KeyE: 'bookerang',
  KeyF: 'colorPulse',
  Space: 'dash',
  KeyR: 'mop',
  Escape: 'pause', KeyP: 'pause',
  Tab: 'codex',
  KeyM: 'mute',
  Backquote: 'debug',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();     // edge: went down this frame
    this.released = new Set();
    this.mouse = { x: 0, y: 0, ndcX: 0, ndcY: 0, down: false, downEdge: false, rightDown: false, wheel: 0 };
    this.enabled = true;
    this.gamepadIndex = null;
    this.usingGamepad = false;
    this._axes = { moveX: 0, moveY: 0, aimX: 0, aimY: 0 };

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Space') e.preventDefault();
      const a = KEYMAP[e.code];
      if (!a) return;
      if (!this.down.has(a)) this.pressed.add(a);
      this.down.add(a);
      this.usingGamepad = false;
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      this.down.delete(a);
      this.released.add(a);
    });
    window.addEventListener('blur', () => { this.down.clear(); });

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.ndcX = (this.mouse.x / r.width) * 2 - 1;
      this.mouse.ndcY = -(this.mouse.y / r.height) * 2 + 1;
      this.usingGamepad = false;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { this.mouse.down = true; this.mouse.downEdge = true; }
      if (e.button === 2) this.mouse.rightDown = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.down = false;
      if (e.button === 2) this.mouse.rightDown = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });

    window.addEventListener('gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  pollGamepad() {
    this._axes.moveX = 0; this._axes.moveY = 0;
    this._axes.aimX = 0; this._axes.aimY = 0;
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
    const map = [
      [0, 'dash'], [1, 'mop'], [2, 'colorPulse'], [3, 'bookerang'],
      [4, 'gravityGun'], [5, 'bookerang'], [6, 'gravityGun'], [7, 'sprint'],
      [9, 'pause'],
    ];
    for (const [i, action] of map) {
      if (btn(i)) {
        if (!this.down.has(action)) this.pressed.add(action);
        this.down.add(action);
        this.usingGamepad = true;
      } else if (this.down.has(action) && !this._keyHeld(action)) {
        this.down.delete(action);
      }
    }
  }

  _keyHeld() { return false; }

  isDown(a) { return this.enabled && this.down.has(a); }
  wasPressed(a) { return this.enabled && this.pressed.has(a); }

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
    this.mouse.wheel = 0;
  }
}
