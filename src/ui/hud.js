import * as THREE from 'three';
import { ITEM_COLORS } from '../data/themes.js';
import { ITEM_STATE } from '../systems/items.js';
import { TutorialSystem } from '../systems/tutorial.js';
import { formatKeyCode, gamepadLabelFor, isEditableTarget } from '../core/input.js';

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
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
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
      mapAlerts: $('.map-alerts'),
      branchObjective: $('.branch-objective'),
      bosses: $('.bosses'),
      compass: $('.compass'),
      compassArrow: $('.compass .arrow'),
      compassDist: $('.compass .dist'),
      toasts: $('.toasts'),
      popups: $('.popups'),
      effects: $('.effects'),
      mopper: $('.mopper'),
      mopKey: $('.mop-key'),
      mopFill: $('.mopper .track > i'),
      debug: $('.debug'),
      tutorial: $('.tutorial-card'),
    };

    this.mm = this.el.minimap.getContext('2d');
    this.el.minimap.width = 380;
    this.el.minimap.height = 380;
    this.mmScale = 0.62;              // pixels per meter
    this._mmStatic = null;

    this.popupPool = [];
    this.activePopups = [];
    this.banners = [];
    // Level 0 already shows essential objective markers and shelf guidance.
    // Cartography expands the minimap's useful planning radius.
    this.cartography = 1;
    this.slots = [];
    this.powerEls = new Map();
    this._buildPowers();
    this.debugOn = false;
    this.tutorial = new TutorialSystem(game, this.el.tutorial);

    window.addEventListener('keydown', (e) => this._handleDebugKey(e));
  }

  show() {
    this._clearTransient();
    this.cartography = 1 + (this.game.progression?.levels.cartography || 0);
    this.root.inert = false;
    this.root.setAttribute('aria-hidden', 'false');
    this.root.classList.add('on');
    this._mmStatic = null;
  }
  hide() {
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.classList.remove('on');
  }

  _handleDebugKey(e) {
    if (e.code !== 'Backquote' || isEditableTarget(e.target)) return;
    this.debugOn = !this.debugOn;
    this.el.debug.classList.toggle('on', this.debugOn);
  }

  _clearTransient() {
    this.el.toasts.replaceChildren();
    for (const banner of this.root.querySelectorAll('.banner')) banner.remove();
    for (const popup of this.activePopups) {
      popup.el.style.display = 'none';
      this.popupPool.push(popup.el);
    }
    this.activePopups.length = 0;
  }

  setCartography(l) { this.cartography = 1 + l; }

  _buildPowers() {
    const defs = [
      { id: 'gravityGun', icon: '🔫' },
      { id: 'bookerang', icon: '🪃' },
      { id: 'colorPulse', icon: '🌈' },
      { id: 'dash', icon: '💨' },
    ];
    this.el.powers.innerHTML = '';
    for (const d of defs) {
      const el = document.createElement('div');
      el.className = 'power locked';
      el.dataset.action = d.id;
      el.innerHTML = `<div class="cd"></div><span class="icon">${d.icon}</span><span class="key">${formatKeyCode(this.game.input.bindingFor(d.id))}</span><span class="lvl-pip"></span>`;
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

  onEvent(type, payload) { this.tutorial.onEvent(type, payload); }

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
    if (r.disasterRecoveryRemaining > 0) {
      cap = `CLEANUP WINDOW — CHAOS PAUSED ${Math.ceil(r.disasterRecoveryRemaining)}s`;
    }
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
    this._updateBranchObjective();
    this._updateEffects(p);
    this._updateMopper();
    this._updatePopups(dt);
    this._updateMinimap();
    this.tutorial.update(dt);

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
        s.textContent = this.game.save.settings.colorLabels ? colorInitial(it.color) : '';
        s.setAttribute('aria-label', `${ITEM_COLORS[it.color]?.name ?? it.color} item`);
      } else {
        s.classList.remove('full');
        s.style.background = '';
        s.textContent = '';
        s.removeAttribute('aria-label');
      }
    }
    this.el.carryLabel.textContent = `CARRYING ${p.carried.length}/${need}`;
  }

  _updatePowers() {
    const g = this.game;
    const tutorialPower = this.tutorial?.activeIntro && this.tutorial.step === 'power'
      ? this.tutorial.powerAction
      : null;
    for (const [id, el] of this.powerEls) {
      const control = g.input.usingGamepad
        ? gamepadLabelFor(id)
        : formatKeyCode(g.input.bindingFor(id));
      el.querySelector('.key').textContent = control;
      el.classList.toggle('tutorial-target', tutorialPower === id);
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
      if (!lvl) {
        el.classList.remove('ready');
        el.querySelector('.cd').style.transform = 'scaleY(0)';
        el.querySelector('.lvl-pip').innerHTML = '';
        continue;
      }
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
      el.innerHTML = `<div class="row"><span class="nm"></span><span class="hint"></span></div><div class="objective"></div><div class="track"><i></i></div>`;
      host.appendChild(el);
    }
    live.forEach((b, i) => {
      const el = host.children[i];
      el.querySelector('.nm').textContent = `${b.type.icon}  ${b.type.name}`;
      const hint = el.querySelector('.hint');
      const objective = el.querySelector('.objective');
      if (b.type.id === 'karen') {
        const color = ITEM_COLORS[b.demandColor];
        hint.textContent = `${Math.max(0, b.demandLeft)} / ${b.demandTotal} LEFT`;
        objective.innerHTML = `<i style="background:${color?.ui ?? '#fff'}"></i> FILE <b>${Math.max(0, b.demandLeft)} ${String(color?.name ?? b.demandColor).toUpperCase()}</b> ${this.game.theme.itemNounPlural.toUpperCase()} INTO MATCHING SHELVES`;
        objective.style.color = color?.ui ?? '';
      } else {
        hint.textContent = bossObjective(b.type.id).short;
        objective.textContent = bossObjective(b.type.id).long;
        objective.style.color = '';
      }
      const bar = el.querySelector('.track > i');
      bar.style.width = `${(b.hp / b.maxHp * 100).toFixed(1)}%`;
      bar.style.background = `linear-gradient(90deg, #${b.type.color.toString(16).padStart(6, '0')}, #ffd9a0)`;
    });
  }

  _updateCompass(dt) {
    const g = this.game;
    let target = g.player.guidanceTarget();
    let targetKind = 'shelf';
    const practice = this.tutorial?.practiceItem;
    if (!target && practice?.active && practice.state === ITEM_STATE.FREE) {
      target = { wx: practice.x, wz: practice.z, color: practice.color };
      targetKind = 'practice item';
    }
    this.el.compass.classList.toggle('on', !!target);
    if (!target) return;
    const dx = target.wx - g.player.x, dz = target.wz - g.player.z;
    const dist = Math.hypot(dx, dz);
    // Project the direction into camera space so the arrow points on screen.
    const yaw = g.camera.yaw;
    const R = Math.min(window.innerWidth, window.innerHeight) * 0.28;
    const { x: px, y: py, angle } = worldToCompassDelta(dx, dz, yaw, R);
    this.el.compassArrow.style.transform = `translate(${px}px, ${py}px) rotate(${angle}rad)`;
    this.el.compassArrow.style.color = ITEM_COLORS[target.color]?.ui ?? '#fff';
    this.el.compassDist.style.transform = `translate(${px}px, ${py}px)`;
    const colorName = ITEM_COLORS[target.color]?.name ?? target.color;
    this.el.compassDist.textContent = this.game.save.settings.colorLabels
      ? `${colorInitial(target.color)} · ${dist.toFixed(0)}m`
      : `${dist.toFixed(0)}m`;
    this.el.compassDist.setAttribute('aria-label', `${colorName} ${targetKind}, ${dist.toFixed(0)} meters`);
    this.el.compassDist.style.color = ITEM_COLORS[target.color]?.ui ?? '#fff';
  }

  _updateBranchObjective() {
    const o = this.game.run?.branchObjective;
    const el = this.el.branchObjective;
    el.classList.toggle('on', !!o);
    if (!o) return;
    const progress = Math.max(0, o.progress ?? 0);
    const target = Math.max(1, o.target ?? 1);
    const timed = Number.isFinite(o.time) ? ` · ${Math.ceil(o.time)}s` : '';
    const color = ITEM_COLORS[o.color]?.ui ?? o.color ?? '#e8b64c';
    el.style.setProperty('--objective-color', color);
    el.querySelector('.objective-label').textContent = o.label || 'BRANCH OBJECTIVE';
    el.querySelector('.objective-detail').textContent = o.detail || '';
    el.querySelector('.objective-count').textContent = `${progress}/${target}${timed}`;
    el.querySelector('.objective-track > i').style.width = `${Math.min(100, progress / target * 100)}%`;
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
    this.el.mopKey.textContent = this.game.input.usingGamepad
      ? gamepadLabelFor('mop')
      : formatKeyCode(this.game.input.bindingFor('mop'));
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

    // Districts, tinted by their dominant color.
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
    // Objective markers are baseline. Cartography upgrades instead reveal a
    // progressively wider slice of the generated branch.
    const view = 78 + Math.max(0, this.cartography - 1) * 14;
    const s = W / view;
    const p = g.player;

    ctx.save();
    ctx.clearRect(0, 0, W, W);
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    ctx.translate(W / 2, W / 2);
    // Camera-relative map: world-forward is rotated by +yaw into screen space.
    // The previous -yaw sign mirrored both turns and movement on the map.
    ctx.rotate(g.camera.yaw);
    ctx.scale(s / this._mmScale, s / this._mmScale);
    ctx.translate(-p.x * this._mmScale, -p.z * this._mmScale);
    ctx.drawImage(this._mmStatic, 0, 0);
    ctx.restore();

    // Overlay live actors in screen space.
    const toScreen = (x, z) => {
      const [dx, dz] = worldToMinimapDelta(x - p.x, z - p.z, g.camera.yaw, s);
      return [W / 2 + dx, W / 2 + dz];
    };

    for (const it of g.items.items) {
      if (!it.active || it.state !== ITEM_STATE.FREE) continue;
      const [x, y] = toScreen(it.x, it.z);
      drawItemDot(ctx, x, y, it.color, !!g.save.settings.colorLabels);
    }
    for (const k of g.kids.active) {
      const [x, y] = toScreen(k.x, k.z);
      ctx.fillStyle = k.heldItem ? '#ff6a6a' : '#ffd77a';
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // Bosses and disasters are core objectives, not an upgrade privilege. They
    // are always labeled, outlined, and clamped to the map edge when distant.
    const pulse = minimapPulse(performance.now(), !!g.save.settings.reducedMotion);
    const markerScale = Math.max(0.9, Math.min(1.3, Number(g.save.settings.textScale) || 1));
    for (const b of g.bosses.active) {
      if (!b.alive) continue;
      const [x, y] = toScreen(b.x, b.z);
      drawTrackedMarker(ctx, x, y, W, `#${b.type.color.toString(16).padStart(6, '0')}`, bossMapLabel(b.type.id), pulse, markerScale);
    }
    for (const d of g.disasters.active) {
      const dd = d.data;
      if (dd?.x === undefined || dd?.z === undefined) continue;
      const [x, y] = toScreen(dd.x, dd.z);
      drawTrackedMarker(ctx, x, y, W, disasterColor(d.def.id), disasterMapLabel(d.def.id), pulse, markerScale);
    }
    for (const m of g.disasters.messes) {
      const [x, y] = toScreen(m.x, m.z);
      ctx.fillStyle = '#88b03a';
      ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
    }

    const practice = this.tutorial.practiceItem;
    if (practice?.active) {
      const [x, y] = toScreen(practice.x, practice.z);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 11 + pulse * 5, 0, Math.PI * 2); ctx.stroke();
    }

    // Player marker points in the actual velocity direction. With a stationary
    // player it falls back to character facing, rather than pretending that
    // the arrow is permanently camera-forward.
    let vx = p.vx, vz = p.vz;
    if (Math.hypot(vx, vz) < 0.25) { vx = Math.sin(p.yaw); vz = Math.cos(p.yaw); }
    const markerAngle = minimapMarkerAngle(vx, vz, g.camera.yaw);
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(markerAngle);
    ctx.fillStyle = '#fff3d4';
    ctx.strokeStyle = '#120d08';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    ctx.restore();

    this._updateMapAlerts();

    // Which district am I standing in?
    const zone = g.layout.zones.find((z) => z.rect.contains(p.x, p.z));
    const name = zone?.name ?? g.layout.identity?.boulevardName ?? 'The Boulevards';
    if (this.el.zoneName.textContent !== name) this.el.zoneName.textContent = name;
  }

  _updateMapAlerts() {
    const g = this.game;
    const alerts = [];
    for (const b of g.bosses.active) {
      if (!b.alive) continue;
      let detail = bossObjective(b.type.id).short;
      if (b.type.id === 'karen') {
        const color = ITEM_COLORS[b.demandColor];
        detail = `FILE ${b.demandLeft} ${String(color?.name ?? b.demandColor).toUpperCase()}`;
      }
      alerts.push({ icon: b.type.icon, label: bossMapLabel(b.type.id), detail, color: `#${b.type.color.toString(16).padStart(6, '0')}` });
    }
    for (const d of g.disasters.active) {
      alerts.push({ icon: d.def.icon, label: disasterMapLabel(d.def.id), detail: d.phase === 'warn' ? 'INCOMING' : 'ACTIVE', color: disasterColor(d.def.id) });
    }
    const sig = JSON.stringify(alerts);
    if (sig === this._mapAlertSig) return;
    this._mapAlertSig = sig;
    this.el.mapAlerts.innerHTML = alerts.map((a) => `
      <div class="map-alert" style="--alert-color:${a.color}">
        <span class="map-alert-icon">${a.icon}</span>
        <span><b>${a.label}</b><small>${a.detail}</small></span>
      </div>`).join('');
    this.el.mapAlerts.classList.toggle('on', alerts.length > 0);
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
    <div class="lvl-row"><span class="lvl">LEVEL 1</span><span class="lvl-sub">0 / 180 XP</span></div>
    <div class="bar xp"><i></i></div>
    <div class="mini-row"><span>HEALTH</span></div>
    <div class="bar hp"><i style="width:100%"></i></div>
    <div class="mini-row"><span>STAMINA</span></div>
    <div class="bar stam"><i style="width:100%"></i></div>
    <div class="carry"></div>
    <div class="carry-label">CARRYING 0/6</div>
  </div>
</div>

<div class="minimap">
  <canvas aria-label="Camera-relative map of the current branch"></canvas>
  <div class="map-heading">VIEW ↑</div>
  <div class="zone-name"></div>
</div>

<div class="right-rail">
  <div class="map-alerts" aria-live="polite"></div>
  <div class="branch-objective">
    <div class="objective-top"><span class="objective-label"></span><span class="objective-count"></span></div>
    <div class="objective-detail"></div>
    <div class="objective-track"><i></i></div>
  </div>
</div>

<div class="bosses"></div>

<div class="combo"><div class="n">×2</div><div class="t">COMBO</div></div>

<div class="compass"><div class="arrow">➤</div><div class="dist">0m</div></div>

<div class="powers"></div>

<div class="effects"></div>

<div class="mopper">
  <div class="k">HOLD <b class="mop-key">R</b> TO CLEAN</div>
  <div class="track"><i></i></div>
</div>

<div class="toasts"></div>
<div class="popups"></div>
<div class="tutorial-card" role="status" aria-live="polite">
  <div class="tutorial-eyebrow"></div>
  <div class="tutorial-title"></div>
  <div class="tutorial-body"></div>
  <div class="tutorial-key"></div>
</div>
<div class="debug"></div>
`;

const COLOR_INITIALS = {
  crimson: 'R', cobalt: 'B', forest: 'G', amber: 'Y', plum: 'P', teal: 'T', rust: 'O', slate: 'S',
};

function colorInitial(color) { return COLOR_INITIALS[color] ?? String(color || '?').slice(0, 1).toUpperCase(); }

function bossObjective(id) {
  const defs = {
    bully: { short: 'CHASE HIM', long: 'STAY CLOSE TO CATCH HIM' },
    karen: { short: 'FILE HER COLOR', long: 'FILE THE REQUESTED COLOR' },
    sickKid: { short: 'CLEAN IT UP', long: 'MOP PUDDLES OR STAY CLOSE TO COMFORT' },
    chaperone: { short: 'CONFRONT HER', long: 'STAY CLOSE WHILE CONTROLLING THE CLASS' },
  };
  return defs[id] || { short: 'COMPLETE OBJECTIVE', long: 'FOLLOW THE MARKER' };
}

function bossMapLabel(id) {
  return ({ bully: 'BULLY', karen: 'KAREN', sickKid: 'PERCY', chaperone: 'CHAPERONE' })[id] || String(id).toUpperCase();
}

function disasterMapLabel(id) {
  return ({ earthquake: 'EARTHQUAKE', tornado: 'TORNADO', volcano: 'VOLCANO', aliens: 'UFO' })[id] || String(id).toUpperCase();
}

function disasterColor(id) {
  return ({ earthquake: '#ffb05c', tornado: '#ff7f32', volcano: '#ff542e', aliens: '#63ffd0' })[id] || '#ff8a3a';
}

function drawItemDot(ctx, x, y, color, assisted) {
  const fill = ITEM_COLORS[color]?.ui ?? '#fff';
  ctx.fillStyle = fill;
  ctx.strokeStyle = assisted ? '#120d08' : fill;
  ctx.lineWidth = 1.2;
  if (!assisted) { ctx.fillRect(x - 2, y - 2, 4, 4); return; }
  const shape = Object.keys(ITEM_COLORS).indexOf(color);
  ctx.beginPath();
  if (shape === 0) ctx.rect(x - 3.5, y - 3.5, 7, 7);
  else if (shape === 1) ctx.arc(x, y, 3.8, 0, Math.PI * 2);
  else if (shape === 2) polygon(ctx, x, y, 4.5, 3, -Math.PI / 2);
  else if (shape === 3) polygon(ctx, x, y, 4.5, 4, -Math.PI / 2);
  else if (shape === 4) polygon(ctx, x, y, 4.5, 5, -Math.PI / 2);
  else if (shape === 5) polygon(ctx, x, y, 4.5, 6, 0);
  else if (shape === 6) {
    ctx.moveTo(x - 1.3, y - 4.5); ctx.lineTo(x + 1.3, y - 4.5);
    ctx.lineTo(x + 1.3, y - 1.3); ctx.lineTo(x + 4.5, y - 1.3);
    ctx.lineTo(x + 4.5, y + 1.3); ctx.lineTo(x + 1.3, y + 1.3);
    ctx.lineTo(x + 1.3, y + 4.5); ctx.lineTo(x - 1.3, y + 4.5);
    ctx.lineTo(x - 1.3, y + 1.3); ctx.lineTo(x - 4.5, y + 1.3);
    ctx.lineTo(x - 4.5, y - 1.3); ctx.lineTo(x - 1.3, y - 1.3); ctx.closePath();
  } else {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const r = i % 2 ? 2 : 4.6;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  ctx.fill(); ctx.stroke();
}

function polygon(ctx, x, y, radius, sides, rotation) {
  for (let i = 0; i < sides; i++) {
    const a = rotation + i * Math.PI * 2 / sides;
    const px = x + Math.cos(a) * radius, py = y + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawTrackedMarker(ctx, rawX, rawY, size, color, label, pulse, textScale = 1) {
  const m = trackedMarkerMetrics(textScale);
  const cx = size / 2, cy = size / 2;
  const dx = rawX - cx, dy = rawY - cy;
  const dist = Math.hypot(dx, dy) || 1;
  const limit = size / 2 - m.edgeMargin;
  const k = dist > limit ? limit / dist : 1;
  const x = cx + dx * k, y = cy + dy * k;

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = m.markerRadius + pulse * 8 * m.scale;
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3 * m.scale;
  ctx.beginPath(); ctx.arc(x, y, m.markerRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * m.scale;
  ctx.beginPath(); ctx.arc(x, y, m.ringRadius + pulse * 4 * m.scale, 0, Math.PI * 2); ctx.stroke();

  ctx.font = `800 ${m.fontSize}px Outfit, sans-serif`;
  const width = ctx.measureText(label).width + m.padX;
  const lx = Math.max(m.inset, Math.min(size - width - m.inset, x - width / 2));
  const ly = Math.max(m.inset, Math.min(size - m.labelHeight - m.inset, y + m.labelOffset));
  ctx.fillStyle = 'rgba(8,6,4,.9)';
  ctx.fillRect(lx, ly, width, m.labelHeight);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * m.scale;
  ctx.strokeRect(lx, ly, width, m.labelHeight);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx + width / 2, ly + m.labelHeight / 2);
  ctx.restore();
}

export function trackedMarkerMetrics(textScale = 1) {
  const scale = Math.max(0.9, Math.min(1.3, Number(textScale) || 1));
  return {
    scale,
    fontSize: 16 * scale,
    padX: 12 * scale,
    labelHeight: 21 * scale,
    labelOffset: 17 * scale,
    inset: 4 * scale,
    edgeMargin: 30 * scale,
    markerRadius: 10 * scale,
    ringRadius: 15 * scale,
  };
}

export function minimapPulse(nowMs, reducedMotion = false) {
  return reducedMotion ? 0.5 : 0.5 + Math.sin(Number(nowMs) * 0.008) * 0.5;
}

/** Convert a world-space XZ delta into the camera-relative minimap plane. */
export function worldToMinimapDelta(dx, dz, cameraYaw, scale = 1) {
  const ca = Math.cos(cameraYaw), sa = Math.sin(cameraYaw);
  return [(dx * ca - dz * sa) * scale, (dx * sa + dz * ca) * scale];
}

/** Project a world direction to a screen-edge point for the right-facing ➤ glyph. */
export function worldToCompassDelta(dx, dz, cameraYaw, radius = 1) {
  const screenX = dx * Math.cos(cameraYaw) - dz * Math.sin(cameraYaw);
  const cameraForward = -dx * Math.sin(cameraYaw) - dz * Math.cos(cameraYaw);
  const length = Math.hypot(screenX, cameraForward) || 1;
  const x = screenX / length * radius;
  const y = -cameraForward / length * radius;
  return { x, y, angle: Math.atan2(y, x) };
}

/** Rotation for an up-pointing player glyph to match actual world movement. */
export function minimapMarkerAngle(vx, vz, cameraYaw) {
  const [screenX, screenY] = worldToMinimapDelta(vx, vz, cameraYaw);
  return Math.atan2(screenX, -screenY);
}
