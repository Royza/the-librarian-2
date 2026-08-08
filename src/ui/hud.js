import * as THREE from 'three';
import { ITEM_COLORS } from '../data/themes.js';
import { ITEM_STATE } from '../systems/items.js';

const _v = new THREE.Vector3();

const CHAOS_CAPTIONS = [
  [0, 'ORDERLY'],
  [15, 'A FEW STRAYS'],
  [32, 'GETTING MESSY'],
  [50, 'LOSING CONTROL'],
  [68, 'BEDLAM'],
  [84, 'TOTAL ANARCHY'],
];

/** All the in-run overlay: meters, minimap, popups, banners. */
export class HUD {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = TEMPLATE;
    game.uiRoot.appendChild(this.root);

    const $ = (s) => this.root.querySelector(s);
    this.el = {
      chaos: $('.chaos'),
      chaosFill: $('.chaos-fill'),
      chaosLabel: $('.chaos-label'),
      chaosCaption: $('.chaos-caption'),
      timer: $('.timer .t'),
      lvl: $('.lvl'),
      lvlSub: $('.lvl-sub'),
      xp: $('.bar.xp > i'),
      hp: $('.bar.hp > i'),
      stam: $('.bar.stam > i'),
      carry: $('.carry'),
      carryLabel: $('.carry-label'),
      powers: $('.powers'),
      combo: $('.combo'),
      comboN: $('.combo .n'),
      minimap: $('.minimap canvas'),
      zoneName: $('.zone-name'),
      bosses: $('.bosses'),
      compass: $('.compass'),
      compassArrow: $('.compass .arrow'),
      compassDist: $('.compass .dist'),
      toasts: $('.toasts'),
      popups: $('.popups'),
      effects: $('.effects'),
      mopper: $('.mopper'),
      mopFill: $('.mopper .track > i'),
      debug: $('.debug'),
    };

    this.mm = this.el.minimap.getContext('2d');
    this.el.minimap.width = 380;
    this.el.minimap.height = 380;
    this.mmScale = 0.62;              // pixels per metre
    this._mmStatic = null;

    this.popupPool = [];
    this.activePopups = [];
    this.banners = [];
    // Level 0 already shows the shelf compass — without it the colour rule is
    // undiscoverable. The upgrade adds boss/disaster markers on the minimap.
    this.cartography = 1;
    this.slots = [];
    this.powerEls = new Map();
    this._buildPowers();
    this.debugOn = false;

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') { this.debugOn = !this.debugOn; this.el.debug.classList.toggle('on', this.debugOn); }
    });
  }

  show() { this.root.classList.add('on'); this._mmStatic = null; }
  hide() { this.root.classList.remove('on'); }

  setCartography(l) { this.cartography = 1 + l; }

  _buildPowers() {
    const defs = [
      { id: 'gravityGun', icon: '🔫', key: 'Q' },
      { id: 'bookerang', icon: '🪃', key: 'E' },
      { id: 'colorPulse', icon: '🌈', key: 'F' },
      { id: 'dash', icon: '💨', key: '␣' },
    ];
    this.el.powers.innerHTML = '';
    for (const d of defs) {
      const el = document.createElement('div');
      el.className = 'power locked';
      el.innerHTML = `<div class="cd"></div><span class="icon">${d.icon}</span><span class="key">${d.key}</span><span class="lvl-pip"></span>`;
      this.el.powers.appendChild(el);
      this.powerEls.set(d.id, el);
    }
  }

  // --- messaging ------------------------------------------------------------

  toast(text, ms = 2400) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.el.toasts.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, ms);
    // Keep the stack short so spam doesn't fill the screen.
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  banner(title, sub = '', { danger = false, ms = 2600 } = {}) {
    const el = document.createElement('div');
    el.className = 'banner' + (danger ? ' danger' : '');
    el.innerHTML = `<h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}`;
    this.root.appendChild(el);
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 600);
    }, ms);
  }

  bossBanner(type) {
    this.banner(type.name.toUpperCase(), `${type.icon}  ${type.blurb}`, { danger: true, ms: 3400 });
  }

  disasterWarning(def) {
    this.banner(`⚠ ${def.name} INCOMING`, def.warning, { danger: true, ms: 2600 });
  }

  showLevelBanner(theme, layout) {
    this.banner(theme.name.toUpperCase(), `${layout.stats.bays.toLocaleString()} shelves · seed ${String(layout.seed).slice(0, 6)}`, { ms: 3200 });
  }

  popup(x, y, z, text, color = '#ffffff') {
    let el = this.popupPool.pop();
    if (!el) {
      el = document.createElement('div');
      el.className = 'popup';
      this.el.popups.appendChild(el);
    }
    el.textContent = text;
    el.style.color = color;
    el.style.display = 'block';
    this.activePopups.push({ el, x, y, z, t: 0, life: 1.2, vy: 1.4 });
  }

  onEvent() { /* reserved for future reactive HUD bits */ }

  // --- per-frame ------------------------------------------------------------

  update(dt) {
    const g = this.game;
    if (!g.run || !g.player) return;

    const r = g.run;
    const pct = r.chaos / r.maxChaos;
    this.el.chaosFill.style.width = `${(pct * 100).toFixed(1)}%`;
    this.el.chaosLabel.textContent = `CHAOS  ${Math.floor(r.chaos)}%`;
    this.el.chaos.classList.toggle('critical', pct > 0.78);
    let cap = CHAOS_CAPTIONS[0][1];
    for (const [t, c] of CHAOS_CAPTIONS) if (r.chaos >= t) cap = c;
    if (r.chaosFrozen) cap = 'SHHHHH — CHAOS FROZEN';
    if (this.el.chaosCaption.textContent !== cap) this.el.chaosCaption.textContent = cap;

    const left = Math.max(0, r.duration - r.elapsed);
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    this.el.timer.textContent = `${mm}:${String(ss).padStart(2, '0')}`;

    const prog = g.progression;
    this.el.lvl.textContent = `LEVEL ${prog.level}`;
    this.el.lvlSub.textContent = `${Math.floor(prog.xp)} / ${prog.xpToNext} XP`;
    this.el.xp.style.width = `${(prog.progress * 100).toFixed(1)}%`;

    const p = g.player;
    this.el.hp.style.width = `${(p.health / p.stats.maxHealth * 100).toFixed(1)}%`;
    this.el.stam.style.width = `${(p.stamina / p.stats.maxStamina * 100).toFixed(1)}%`;

    this._updateCarry(p);
    this._updatePowers();
    this._updateCombo(r);
    this._updateBosses();
    this._updateCompass(dt);
    this._updateEffects(p);
    this._updateMopper();
    this._updatePopups(dt);
    this._updateMinimap();

    if (this.debugOn) {
      const info = g.render.renderer.info;
      this.el.debug.textContent =
        `fps ${g.fps.toFixed(0)}  draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k\n` +
        `kids ${g.kids.count}/${g.kids.maxKids}  items ${g.items.floorCount} floor  bosses ${g.bosses.active.length}\n` +
        `bays ${g.layout.stats.bays}  seed ${g.layout.seed}  quality ${g.render.quality}`;
    }
  }

  _updateCarry(p) {
    const need = p.stats.carrySlots;
    while (this.slots.length < need) {
      const s = document.createElement('div');
      s.className = 'slot';
      this.el.carry.appendChild(s);
      this.slots.push(s);
    }
    while (this.slots.length > need) this.slots.pop().remove();
    for (let i = 0; i < this.slots.length; i++) {
      const it = p.carried[i];
      const s = this.slots[i];
      if (it) {
        s.classList.add('full');
        s.style.background = ITEM_COLORS[it.color]?.ui ?? '#888';
      } else {
        s.classList.remove('full');
        s.style.background = '';
      }
    }
    this.el.carryLabel.textContent = `CARRYING ${p.carried.length}/${need}`;
  }

  _updatePowers() {
    const g = this.game;
    for (const [id, el] of this.powerEls) {
      if (id === 'dash') {
        const cd = g.player.dashTimer;
        const max = g.player.stats.dashCooldown;
        el.classList.remove('locked');
        el.classList.toggle('ready', cd <= 0);
        el.querySelector('.cd').style.transform = `scaleY(${Math.max(0, cd / max)})`;
        continue;
      }
      const lvl = g.powers.levels[id] || 0;
      el.classList.toggle('locked', lvl === 0);
      if (!lvl) { el.querySelector('.cd').style.transform = 'scaleY(0)'; continue; }
      const frac = g.powers.cooldownFraction(id);
      el.classList.toggle('ready', frac >= 1);
      el.querySelector('.cd').style.transform = `scaleY(${1 - frac})`;
      const pip = el.querySelector('.lvl-pip');
      if (pip.children.length !== lvl) {
        pip.innerHTML = '<i></i>'.repeat(lvl);
      }
    }
  }

  _updateCombo(r) {
    const on = r.combo > 1;
    this.el.combo.classList.toggle('on', on);
    if (on) this.el.comboN.textContent = `×${r.combo}`;
  }

  _updateBosses() {
    const g = this.game;
    const live = g.bosses.active.filter((b) => b.alive);
    const host = this.el.bosses;
    while (host.children.length > live.length) host.lastChild.remove();
    while (host.children.length < live.length) {
      const el = document.createElement('div');
      el.className = 'bossbar';
      el.innerHTML = `<div class="row"><span class="nm"></span><span class="hint"></span></div><div class="track"><i></i></div>`;
      host.appendChild(el);
    }
    live.forEach((b, i) => {
      const el = host.children[i];
      el.querySelector('.nm').textContent = `${b.type.icon}  ${b.type.name}`;
      el.querySelector('.hint').textContent = b.type.title.toUpperCase();
      const bar = el.querySelector('.track > i');
      bar.style.width = `${(b.hp / b.maxHp * 100).toFixed(1)}%`;
      bar.style.background = `linear-gradient(90deg, #${b.type.color.toString(16).padStart(6, '0')}, #ffd9a0)`;
    });
  }

  _updateCompass(dt) {
    const g = this.game;
    const target = g.player.guidanceTarget();
    this.el.compass.classList.toggle('on', !!target);
    if (!target) return;
    const dx = target.wx - g.player.x, dz = target.wz - g.player.z;
    const dist = Math.hypot(dx, dz);
    // Project the direction into camera space so the arrow points on screen.
    const yaw = g.camera.yaw;
    const sx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const sy = -dx * Math.sin(yaw) - dz * Math.cos(yaw);
    const a = Math.atan2(sx, -sy);
    const R = Math.min(window.innerWidth, window.innerHeight) * 0.28;
    const px = Math.sin(a) * R, py = -Math.cos(a) * R;
    this.el.compassArrow.style.transform = `translate(${px}px, ${py}px) rotate(${a}rad)`;
    this.el.compassArrow.style.color = ITEM_COLORS[target.color]?.ui ?? '#fff';
    this.el.compassDist.style.transform = `translate(${px}px, ${py}px)`;
    this.el.compassDist.textContent = `${dist.toFixed(0)}m`;
    this.el.compassDist.style.color = ITEM_COLORS[target.color]?.ui ?? '#fff';
  }

  _updateEffects(p) {
    const host = this.el.effects;
    const list = [...p.effects.entries()];
    while (host.children.length > list.length) host.lastChild.remove();
    while (host.children.length < list.length) {
      const el = document.createElement('div');
      el.className = 'effect';
      el.innerHTML = '<span class="ring"></span><span class="nm"></span>';
      host.appendChild(el);
    }
    const NAMES = { slip: '🍌 SLIPPING', grow: '🍄 SUPERSIZED', spicy: '🌶️ FIRED UP', heavy: '🍉 WEIGHED DOWN' };
    list.forEach(([id, e], i) => {
      const el = host.children[i];
      el.querySelector('.nm').textContent = `${NAMES[id] || id.toUpperCase()} ${e.t.toFixed(1)}s`;
    });
  }

  _updateMopper() {
    const m = this.game.disasters?.currentMess;
    this.el.mopper.classList.toggle('on', !!m);
    if (m) this.el.mopFill.style.width = `${(m.progress * 100).toFixed(0)}%`;
  }

  _updatePopups(dt) {
    const cam = this.game.render.camera;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.activePopups.length - 1; i >= 0; i--) {
      const p = this.activePopups[i];
      p.t += dt;
      if (p.t >= p.life) {
        p.el.style.display = 'none';
        this.popupPool.push(p.el);
        this.activePopups.splice(i, 1);
        continue;
      }
      _v.set(p.x, p.y + p.t * p.vy, p.z).project(cam);
      if (_v.z > 1) { p.el.style.opacity = '0'; continue; }
      const k = 1 - p.t / p.life;
      p.el.style.left = `${(_v.x * 0.5 + 0.5) * w}px`;
      p.el.style.top = `${(-_v.y * 0.5 + 0.5) * h}px`;
      p.el.style.opacity = String(Math.min(1, k * 2));
      p.el.style.transform = `translate(-50%,-50%) scale(${0.85 + k * 0.35})`;
    }
  }

  // --- minimap --------------------------------------------------------------

  _buildStaticMap() {
    const g = this.game;
    const L = g.layout;
    const size = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const s = size / Math.max(L.width, L.depth);

    c.fillStyle = 'rgba(24,17,10,0.9)';
    c.fillRect(0, 0, size, size);

    // Districts, tinted by their dominant colour.
    for (const z of L.zones) {
      const col = ITEM_COLORS[z.dominant]?.ui ?? '#888';
      c.fillStyle = col + '18';
      c.fillRect(z.rect.x * s, z.rect.z * s, z.rect.w * s, z.rect.d * s);
    }
    // Shelf runs.
    c.strokeStyle = 'rgba(232,182,76,0.4)';
    c.lineWidth = Math.max(1, 1.6 * s / 2);
    for (const run of L.shelfRuns) {
      const hx = Math.cos(run.angle) * run.length / 2;
      const hz = Math.sin(run.angle) * run.length / 2;
      c.beginPath();
      c.moveTo((run.x - hx) * s, (run.z - hz) * s);
      c.lineTo((run.x + hx) * s, (run.z + hz) * s);
      c.stroke();
    }
    // Perimeter.
    c.strokeStyle = 'rgba(232,182,76,0.6)';
    c.lineWidth = 3;
    c.strokeRect(1, 1, size - 2, size - 2);

    this._mmStatic = cv;
    this._mmScale = s;
  }

  _updateMinimap() {
    const g = this.game;
    if (!this._mmStatic) this._buildStaticMap();
    const ctx = this.mm;
    const W = this.el.minimap.width;
    const view = 78;                      // metres across the minimap
    const s = W / view;
    const p = g.player;

    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(W / 2, W / 2);
    ctx.rotate(-g.camera.yaw);
    ctx.scale(s / this._mmScale, s / this._mmScale);
    ctx.translate(-p.x * this._mmScale, -p.z * this._mmScale);
    ctx.drawImage(this._mmStatic, 0, 0);
    ctx.restore();

    // Overlay live actors in screen space.
    const toScreen = (x, z) => {
      const dx = (x - p.x) * s, dz = (z - p.z) * s;
      const ca = Math.cos(-g.camera.yaw), sa = Math.sin(-g.camera.yaw);
      return [W / 2 + dx * ca - dz * sa, W / 2 + dx * sa + dz * ca];
    };

    for (const it of g.items.items) {
      if (!it.active || it.state !== ITEM_STATE.FREE) continue;
      const [x, y] = toScreen(it.x, it.z);
      ctx.fillStyle = ITEM_COLORS[it.color]?.ui ?? '#fff';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    for (const k of g.kids.active) {
      const [x, y] = toScreen(k.x, k.z);
      ctx.fillStyle = k.heldItem ? '#ff6a6a' : '#ffd77a';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (this.cartography >= 3) {
      for (const b of g.bosses.active) {
        if (!b.alive) continue;
        const [x, y] = toScreen(b.x, b.z);
        ctx.fillStyle = `#${b.type.color.toString(16).padStart(6, '0')}`;
        ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      for (const d of g.disasters.active) {
        const dd = d.data;
        if (dd?.x === undefined) continue;
        const [x, y] = toScreen(dd.x, dd.z);
        ctx.fillStyle = '#ff8a3a';
        ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const m of g.disasters.messes) {
      const [x, y] = toScreen(m.x, m.z);
      ctx.fillStyle = '#88b03a';
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    }

    // Player marker.
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.fillStyle = '#fff3d4';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
    ctx.closePath(); ctx.fill();
    ctx.restore();

    // Which district am I standing in?
    const zone = g.layout.zones.find((z) => z.rect.contains(p.x, p.z));
    const name = zone?.name ?? 'The Boulevards';
    if (this.el.zoneName.textContent !== name) this.el.zoneName.textContent = name;
  }

  dispose() { this.root.remove(); }
}

const TEMPLATE = `
<div class="chaos">
  <div class="chaos-frame">
    <div class="chaos-fill"></div>
    <div class="chaos-ticks"><i style="left:25%"></i><i style="left:50%"></i><i style="left:75%"></i></div>
    <div class="chaos-label">CHAOS 0%</div>
  </div>
  <div class="chaos-caption">ORDERLY</div>
</div>

<div class="timer"><span class="t">15:00</span><small>UNTIL CLOSING</small></div>

<div class="vitals">
  <div class="panel">
    <div class="lvl-row"><span class="lvl">LEVEL 1</span><span class="lvl-sub">0 / 120 XP</span></div>
    <div class="bar xp"><i></i></div>
    <div class="mini-row"><span>HEALTH</span></div>
    <div class="bar hp"><i style="width:100%"></i></div>
    <div class="mini-row"><span>STAMINA</span></div>
    <div class="bar stam"><i style="width:100%"></i></div>
    <div class="carry"></div>
    <div class="carry-label">CARRYING 0/6</div>
  </div>
</div>

<div class="minimap"><canvas></canvas><div class="zone-name"></div></div>

<div class="bosses"></div>

<div class="combo"><div class="n">×2</div><div class="t">COMBO</div></div>

<div class="compass"><div class="arrow">➤</div><div class="dist">0m</div></div>

<div class="powers"></div>

<div class="effects"></div>

<div class="mopper">
  <div class="k">HOLD <b>R</b> TO CLEAN</div>
  <div class="track"><i></i></div>
</div>

<div class="toasts"></div>
<div class="popups"></div>
<div class="debug"></div>
`;
