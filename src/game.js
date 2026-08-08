import * as THREE from 'three';
import { RenderSystem, autoDetectQuality } from './render/renderer.js';
import { buildMaterials, disposeMaterials } from './render/materials.js';
import { buildEnvironment } from './render/environment.js';
import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { EventBus } from './core/events.js';
import { ChaseCamera } from './core/camera.js';
import { RNG } from './core/rng.js';
import { generateLayout } from './world/generator.js';
import { Level } from './world/level.js';
import { CollisionWorld, PathFinder } from './world/collision.js';
import { THEMES } from './data/themes.js';
import { DEFAULT_CHARACTER } from './data/characters.js';
import { ItemSystem, ITEM_STATE } from './systems/items.js';
import { FX } from './systems/fx.js';
import { Player } from './entities/player.js';
import { KidManager } from './entities/kid.js';
import { BossManager } from './entities/bosses.js';
import { Director } from './systems/director.js';
import { DisasterManager } from './systems/disasters.js';
import { PowerSystem } from './systems/powers.js';
import { Progression } from './systems/progression.js';
import { SaveData } from './core/save.js';
import { HUD } from './ui/hud.js';
import { Menus } from './ui/menus.js';

export const STATE = {
  BOOT: 'boot',
  MENU: 'menu',
  LOADING: 'loading',
  PLAYING: 'playing',
  LEVELUP: 'levelup',
  PAUSED: 'paused',
  GAMEOVER: 'gameover',
  VICTORY: 'victory',
};

const RUN_DURATION = 15 * 60;   // one shift: fifteen minutes of children

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;

    this.events = new EventBus();
    this.save = new SaveData();
    this.render = new RenderSystem(canvas);
    this.input = new Input(canvas);
    this.audio = new AudioEngine();
    this.camera = new ChaseCamera(this.render.camera);

    this.state = STATE.BOOT;
    this.clock = 0;
    this.timeScale = 1;
    this._accum = 0;
    this._last = performance.now();
    this._frames = 0;
    this._fpsTime = 0;
    this.fps = 60;

    this.menus = new Menus(this);
    this.hud = new HUD(this);

    this.run = null;
    this.level = null;

    this.events.on('*', (type, payload) => this.hud?.onEvent?.(type, payload));

    this._bindGlobalKeys();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === STATE.PLAYING) this.pause();
        else if (this.state === STATE.PAUSED) this.resume();
      }
      if (e.code === 'KeyM') this.audio.mute(this.audio.enabled);
    });
  }

  // --- lifecycle ------------------------------------------------------------

  async showMenu() {
    this.state = STATE.MENU;
    this.menus.showMain();
    await this.audio.resume();
    this.audio.startMusic('warm');
    this.audio.setIntensity(0.1);
  }

  async startRun({ themeId = 'library', seed = null, characterId = null } = {}) {
    this.state = STATE.LOADING;
    this.menus.showLoading();
    await frame(); await frame();

    this.disposeRun();

    const theme = THEMES[themeId];
    this.theme = theme;
    this.characterId = characterId || this.save.data.lastCharacter || DEFAULT_CHARACTER;
    this.save.setLastCharacter(this.characterId);
    const seedValue = seed ?? `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
    this.seed = seedValue;
    this.rng = new RNG(seedValue);

    // Scene setup for this theme
    this.render.scene.fog = new THREE.FogExp2(theme.fog.color, 1.6 / theme.fog.far);
    this.render.scene.background = new THREE.Color(theme.fog.color);
    this.envTarget?.dispose?.();
    this.envTarget = buildEnvironment(this.render.renderer, theme.envPalette);
    this.envMap = this.envTarget.texture;
    this.render.scene.environment = this.envMap;

    this.mats = buildMaterials(theme);
    this.layout = generateLayout(seedValue, theme);
    this.collision = new CollisionWorld(this.layout);
    this.pathfinder = new PathFinder(this.layout);
    this.level = new Level(this.render.scene, this.layout, theme, this.mats, this.render.quality);

    this.fx = new FX(this.render.scene, this.render.camera);
    this.items = new ItemSystem(this.render.scene, this.mats, theme, this.layout);
    this.items.onGrounded = (it) => this.onItemGrounded(it);
    this.items.onShelved = (it, bay) => this.onItemShelved(it, bay);

    this.player = new Player(this, this.layout.spawn.x, this.layout.spawn.z);
    this.kids = new KidManager(this);
    this.bosses = new BossManager(this);
    this.powers = new PowerSystem(this);
    this.disasters = new DisasterManager(this);
    this.progression = new Progression(this);
    this.director = new Director(this);

    this.run = {
      duration: RUN_DURATION,
      elapsed: 0,
      chaos: 0,
      maxChaos: 100,
      peakChaos: 0,
      shelved: 0,
      pickedUp: 0,
      kidsCalmed: 0,
      bossesBeaten: 0,
      disastersSurvived: 0,
      combo: 0,
      comboTimer: 0,
      bestCombo: 0,
      xpEarned: 0,
      score: 0,
    };

    // Apply meta upgrades bought between runs.
    this.save.applyMeta(this.player, this.progression);

    this.camera.yaw = Math.PI * 0.25;
    this.camera.setCeiling(theme.ceilingHeight);
    this.camera.update(0.016, this.player, { x: 0, z: 0 }, { snap: true });

    // Warm the shader cache before the first frame so we don't hitch on entry.
    this.render.renderer.compile(this.render.scene, this.render.camera);

    this.state = STATE.PLAYING;
    this.clock = 0;
    this.timeScale = 1;
    this.menus.hideAll();
    this.hud.show();
    this.hud.showLevelBanner(theme, this.layout);
    this.audio.startMusic(theme.music);
    this.audio.setIntensity(0.15);
    this.events.emit('runStart', { theme, seed: seedValue });
  }

  disposeRun() {
    this.player?.dispose();
    this.kids?.dispose();
    this.bosses?.dispose();
    this.powers?.dispose();
    this.disasters?.dispose();
    this.items?.dispose();
    this.fx?.dispose();
    this.level?.dispose();
    this.player = null; this.kids = null; this.bosses = null;
    this.powers = null; this.disasters = null; this.items = null;
    this.fx = null; this.level = null; this.director = null;
    // Textures are cached and shared across runs; the materials wrapping them
    // are not, so they have to go with the level.
    if (this.mats) { disposeMaterials(this.mats); this.mats = null; }
  }

  pause() {
    if (this.state !== STATE.PLAYING) return;
    this.state = STATE.PAUSED;
    this.input.enabled = false;
    this.menus.showPause();
    this.audio.setIntensity(0.05);
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this.state = STATE.PLAYING;
    this.input.enabled = true;
    this.menus.hideAll();
    this._last = performance.now();
  }

  endRun(won, reason) {
    if (this.state === STATE.GAMEOVER || this.state === STATE.VICTORY) return;
    this.state = won ? STATE.VICTORY : STATE.GAMEOVER;
    this.input.enabled = false;
    this.audio.stopMusic();
    this.audio.play(won ? 'win' : 'lose');

    const r = this.run;
    r.score = Math.round(
      r.shelved * 12 + r.pickedUp * 3 + r.kidsCalmed * 25 +
      r.bossesBeaten * 400 + r.disastersSurvived * 250 +
      r.elapsed * 2 + (won ? 3000 : 0) + r.bestCombo * 30,
    );
    const gained = Math.round(r.xpEarned + (won ? 2500 : 0));
    this.save.addLifetime(gained, r.score, this.theme.id, won);
    this.hud.hide();
    this.menus.showResults(won, reason, r, gained);
    this.events.emit('runEnd', { won, reason, run: r });
  }

  // --- gameplay hooks -------------------------------------------------------

  onItemGrounded(it) {
    const pan = this._panFor(it.x, it.z);
    this.audio.play('bookfall', { pan, volume: 0.5, rate: 0.85 + Math.random() * 0.4 });
  }

  onItemPickedUp(it) {
    this.run.pickedUp++;
    this.run.chaos = Math.max(0, this.run.chaos - 0.18);
    this.progression.addXP(3);
  }

  onItemShelved(it, bay) {
    const r = this.run;
    r.shelved++;
    r.combo++;
    r.comboTimer = 3.2;
    r.bestCombo = Math.max(r.bestCombo, r.combo);
    r.chaos = Math.max(0, r.chaos - 0.55 - Math.min(r.combo, 20) * 0.02);

    const mult = 1 + Math.min(r.combo, 25) * 0.06;
    this.progression.addXP(Math.round(10 * mult));
    this.progression.onShelved();
    this.audio.play('shelve', { pan: this._panFor(bay.wx, bay.wz), rate: 0.95 + Math.min(r.combo, 12) * 0.045 });
    if (r.combo > 1) this.audio.play('combo', { step: r.combo });
    this.fx.sparkle(bay.wx + bay.nx * 0.3, bay.run.height * 0.5, bay.wz + bay.nz * 0.3, 0xffe9b0, 8);
    this.level.refreshBay(bay);
    this.hud.popup(bay.wx, bay.run.height * 0.7, bay.wz, r.combo > 1 ? `+${Math.round(10 * mult)} ×${r.combo}` : `+10`, '#ffd77a');
    this.events.emit('shelved', { bay, combo: r.combo });
  }

  onBayChanged(bay) { this.level.refreshBay(bay); }

  addChaos(amount) {
    const damp = 1 - (this.player?.stats.chaosDampening ?? 0) / 100;
    this.run.chaos = Math.min(this.run.maxChaos, this.run.chaos + amount * damp);
  }

  /** Stereo pan for a world position, from its horizontal place on screen. */
  _panFor(x, z) {
    const cam = this.render.camera;
    _panVec.set(x, 1, z);
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    _panVec.project(cam);
    // Behind the camera the projection flips; treat that as dead centre.
    if (!Number.isFinite(_panVec.x) || _panVec.z > 1) return 0;
    return Math.max(-1, Math.min(1, _panVec.x));
  }

  // --- main loop ------------------------------------------------------------

  _loop(now) {
    requestAnimationFrame(this._loop);
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.25) dt = 0.25;

    this._frames++;
    this._fpsTime += dt;
    if (this._fpsTime >= 0.5) {
      this.fps = this._frames / this._fpsTime;
      this._frames = 0; this._fpsTime = 0;
    }

    this.input.pollGamepad();

    if (this.state === STATE.PLAYING) {
      this._step(dt * this.timeScale);
    } else if (this.state === STATE.LEVELUP) {
      // Time crawls while you choose an upgrade — reads as a beat, not a stop.
      this._step(dt * 0.08);
    } else if (this.level && this.player) {
      this.level.update(dt, this.player, this.render.camera.position);
      this.fx?.update(dt);
    }

    if (this.level) {
      this.camera.update(dt, this.player ?? { x: 0, z: 0 }, { x: this.player?.vx ?? 0, z: this.player?.vz ?? 0 });
      this.render.setFocusDistance(this.camera.distance);
      this.render.setChaosGrade(this.run ? this.run.chaos / this.run.maxChaos : 0);
    }
    if (this.input.mouse.wheel) this.camera.zoom(this.input.mouse.wheel);

    this.hud?.update(dt);
    this.render.renderer.info.reset();
    this.render.render(dt);
    this.input.endFrame();
  }

  _step(dt) {
    const r = this.run;
    this.clock += dt;
    r.elapsed += dt;

    if (r.comboTimer > 0) {
      r.comboTimer -= dt;
      if (r.comboTimer <= 0) r.combo = 0;
    }

    this.player.update(dt, this.input);
    this.powers.update(dt, this.input);
    this.items.update(dt, this);
    this.kids.update(dt);
    this.bosses.update(dt);
    this.disasters.update(dt);
    this.director.update(dt);
    this.progression.update(dt);
    this.fx.update(dt);
    this.level.update(dt, this.player, this.render.camera.position);
    this.items.render(this.render.camera);

    this._updateChaos(dt);

    this.audio.setIntensity(Math.min(1, r.chaos / r.maxChaos * 1.15 + (this.bosses.active.length ? 0.3 : 0)));

    if (r.chaos >= r.maxChaos) this.endRun(false, 'chaos');
    else if (this.player.health <= 0) this.endRun(false, 'health');
    else if (r.elapsed >= r.duration) this.endRun(true, 'survived');
  }

  _updateChaos(dt) {
    const r = this.run;
    const floor = this.items.floorCount;
    const held = this.items.looseCount - floor;
    const messes = this.disasters.messCount;

    // Pressure grows sub-linearly with the size of the mess. A big pile still
    // hurts, but it doesn't become unrecoverable the moment a tornado passes —
    // the player always has a road back if they start filing.
    const minute = r.elapsed / 60;
    const perItem = 0.011 + Math.min(0.030, minute * 0.0021);
    const load = Math.pow(floor, 0.8) + Math.pow(held, 0.8) * 0.5;
    let rate = load * perItem + messes * 0.18;
    rate += this.bosses.chaosPressure;

    // Opening grace: the first ninety seconds ease you in rather than punishing
    // the time it takes to work out what the colours mean.
    rate *= Math.min(1, 0.35 + r.elapsed / 90 * 0.65);
    if (r.chaosFrozen) rate = 0;

    if (rate > 0) this.addChaos(rate * dt);
    else if (r.chaos > 0) r.chaos = Math.max(0, r.chaos - 0.6 * dt);

    // Getting on top of the mess is rewarded, not just perfection — the meter
    // has to visibly move while you're clawing back or it reads as hopeless.
    if (messes === 0 && floor < 8) {
      const clean = 1 - floor / 8;
      r.chaos = Math.max(0, r.chaos - (0.5 + 1.4 * clean) * dt);
    }
    r.peakChaos = Math.max(r.peakChaos, r.chaos);
  }
}

/**
 * Yield long enough for the loading screen to paint. Raced against a timer so a
 * backgrounded tab (where rAF is suspended) still finishes loading.
 */
const _panVec = new THREE.Vector3();

function frame() {
  return new Promise((res) => {
    let done = false;
    const fire = () => { if (!done) { done = true; res(); } };
    requestAnimationFrame(fire);
    setTimeout(fire, 60);
  });
}
