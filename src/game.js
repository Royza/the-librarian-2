import * as THREE from 'three';
import { RenderSystem, autoDetectQuality } from './render/renderer.js';
import { buildMaterials, disposeMaterials } from './render/materials.js';
import { buildEnvironment } from './render/environment.js';
import { Input, isEditableTarget } from './core/input.js';
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
import { VampireManager } from './entities/vampire.js';
import { BossManager } from './entities/bosses.js';
import { Director } from './systems/director.js';
import { DisasterManager } from './systems/disasters.js';
import { PowerSystem } from './systems/powers.js';
import { Progression } from './systems/progression.js';
import {
  CHAOS_BALANCE,
  cemeteryPressureRate,
  chaosPressureRate,
  cleanFloorReliefRate,
  isChaosPaused,
  shelveChaosRelief,
} from './systems/chaos.js';
import { BranchMechanics } from './systems/branchMechanics.js';
import { RunTelemetry } from './systems/telemetry.js';
import { SaveData } from './core/save.js';
import { dailyId, dailySeedForDay } from './core/daily.js';
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

const RUN_DURATION = 15 * 60;   // one patrol: hold the cemetery until sunrise

export function presentationFxDelta(state, dt) {
  return state === STATE.PAUSED ? 0 : dt;
}

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
    this.applyCameraSettings();

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
    this.branchMechanics = null;
    this.telemetry = null;

    this.events.on('*', (type, payload) => this.hud?.onEvent?.(type, payload));

    this._bindGlobalKeys();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _bindGlobalKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.state === STATE.PLAYING) this.pause();
        // A paused Settings sub-screen owns Escape/Back. Only the actual pause
        // screen may resume the simulation from the pause hotkey.
        else if (this.state === STATE.PAUSED && this.menus.current === 'pause') this.resume();
      }
      if (e.code === 'KeyM' && !isEditableTarget(e.target)) this.audio.mute(this.audio.enabled);
    });
  }

  // --- lifecycle ------------------------------------------------------------

  /** Apply persistent camera preferences immediately without resetting orbit. */
  applyCameraSettings() {
    this.camera.setInvertY(!!this.save.settings.invertCameraY);
  }

  async showMenu() {
    this.state = STATE.MENU;
    this.menus.showMain();
    await this.audio.resume();
    this.audio.startMusic('warm');
    this.audio.setIntensity(0.1);
  }

  async startRun({ themeId = 'cemetery', seed = null, characterId = null, challenge = null, dailyDay: requestedDailyDay = null } = {}) {
    // Result-only announcements belong to exactly one run. Clear them before
    // training or an unscored abort can inherit an earlier branch unlock.
    this.save.lastCardsEarned = 0;
    this.save.lastUnlockedTheme = null;
    this.state = STATE.LOADING;
    this.menus.showLoading(themeId);
    await frame(); await frame();

    this.disposeRun();

    const theme = THEMES[themeId];
    this.theme = theme;
    this.characterId = theme.id === 'cemetery'
      ? DEFAULT_CHARACTER
      : (characterId || this.save.data.lastCharacter || 'marion');
    this.save.setLastCharacter(this.characterId);
    const isDaily = challenge === 'daily';
    // A results-screen retry belongs to the daily challenge it started on,
    // even if UTC midnight passes while the results are open.
    const dailyDay = isDaily ? (requestedDailyDay || dailyId()) : null;
    const seedValue = seed ?? (isDaily
      ? dailySeedForDay(themeId, dailyDay)
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`);
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
    this.vampires = theme.id === 'cemetery' ? new VampireManager(this) : null;
    this.kids = this.vampires || new KidManager(this);
    this.bosses = new BossManager(this);
    this.powers = new PowerSystem(this);
    this.disasters = new DisasterManager(this);
    this.progression = new Progression(this);

    this.run = {
      duration: RUN_DURATION,
      elapsed: 0,
      sessionElapsed: 0,
      trainingElapsed: 0,
      chaos: 0,
      maxChaos: 100,
      peakChaos: 0,
      shelved: 0,
      pickedUp: 0,
      kidsCalmed: 0,
      vampiresSlain: 0,
      supernaturalEventsResolved: 0,
      bossesBeaten: 0,
      disastersSurvived: 0,
      combo: 0,
      comboTimer: 0,
      bestCombo: 0,
      disasterRecoveryRemaining: 0,
      disasterRecoveryStartFloor: 0,
      disasterRecoveryEndFloor: 0,
      xpEarned: 0,
      score: 0,
      challenge,
      isDaily,
      dailyDay,
      tutorialActive: false,
    };

    // Apply meta upgrades bought between runs.
    this.save.applyMeta(this.player, this.progression);
    this.branchMechanics = new BranchMechanics(this);
    this.telemetry = new RunTelemetry(this);
    // Director.begin() applies starting licenses and head-start drafts, so it
    // must be constructed only after permanent progression is installed.
    this.director = new Director(this);

    // Settings can change from the pause overlay while this long-lived camera
    // survives across runs, so reapply the saved preference at each boundary.
    this.applyCameraSettings();
    this.camera.setContainment(this.layout);
    this.camera.setCeiling(theme.ceilingHeight);
    this.camera.reset(this.player);

    // Warm the shader cache before the first frame so we don't hitch on entry.
    this.render.renderer.compile(this.render.scene, this.render.camera);

    this.state = STATE.PLAYING;
    this.input.enabled = true;
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
    this.telemetry?.dispose();
    this.branchMechanics?.dispose();
    this.player?.dispose();
    this.kids?.dispose();
    this.bosses?.dispose();
    this.powers?.dispose();
    this.disasters?.dispose();
    this.items?.dispose();
    this.fx?.dispose();
    this.level?.dispose();
    this.player = null; this.kids = null; this.vampires = null; this.bosses = null;
    this.powers = null; this.disasters = null; this.items = null;
    this.fx = null; this.level = null; this.director = null;
    this.telemetry = null; this.branchMechanics = null;
    // The renderer and chase camera outlive a run. Remove all disaster/chaos
    // presentation before the menu or the next floor becomes visible.
    this.render.setLensDistortion(0, 0);
    this.render.setChaosGrade(0);
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
    // The global keyboard handler and the polled action see the same keydown.
    // Consume it so Escape/P cannot immediately reopen pause next frame.
    this.input.consumePressed('pause');
    this.state = STATE.PLAYING;
    this.input.enabled = true;
    this.menus.hideAll();
    this._last = performance.now();
  }

  endRun(won, reason) {
    if (this.state === STATE.GAMEOVER || this.state === STATE.VICTORY) return;
    const trainingOnly = !!this.run?.tutorialActive;
    this.state = won ? STATE.VICTORY : STATE.GAMEOVER;
    this.input.enabled = false;
    this.progression?.cancelDraft();
    this.menus.hideAll();
    if (trainingOnly) {
      this.hud?.tutorial?.prepareRunEnd?.();
      this.run.unscoredTraining = true;
    }
    this.audio.stopMusic();
    this.audio.play(won ? 'win' : 'lose');

    const r = this.run;
    r.score = trainingOnly ? 0 : Math.round(
      r.shelved * 12 + r.pickedUp * 3 + r.kidsCalmed * 25 +
      r.bossesBeaten * 400 + r.disastersSurvived * 250 +
      r.elapsed * 2 + (won ? 3000 : 0) + r.bestCombo * 30,
    );
    const gained = trainingOnly ? 0 : Math.round(r.xpEarned + (won ? 2500 : 0));
    if (!trainingOnly) {
      this.telemetry?.finish(reason, won);
      this.save.addLifetime(gained, r.score, this.theme.id, won, this.progression.cardMultiplier);
      if (r.isDaily) this.save.recordDaily(r.dailyDay, this.theme.id, r.score, won);
    }
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
    this.run.chaos = Math.max(0, this.run.chaos - CHAOS_BALANCE.pickupRelief);
    this.progression.addXP(3);
  }

  onItemShelved(it, bay) {
    const r = this.run;
    r.shelved++;
    r.combo++;
    r.comboTimer = this.progression.comboTime;
    r.bestCombo = Math.max(r.bestCombo, r.combo);
    r.chaos = Math.max(0, r.chaos - shelveChaosRelief(r.combo));

    const mult = 1 + Math.min(r.combo, 25) * 0.06;
    this.progression.addXP(Math.round(10 * mult));
    this.progression.onShelved();
    this.audio.play('shelve', { pan: this._panFor(bay.wx, bay.wz), rate: 0.95 + Math.min(r.combo, 12) * 0.045 });
    if (r.combo > 1) this.audio.play('combo', { step: r.combo });
    this.fx.sparkle(bay.wx + bay.nx * 0.3, bay.run.height * 0.5, bay.wz + bay.nz * 0.3, 0xffe9b0, 8);
    this.level.refreshBay(bay);
    this.hud.popup(bay.wx, bay.run.height * 0.7, bay.wz, r.combo > 1 ? `+${Math.round(10 * mult)} ×${r.combo}` : `+10`, '#ffd77a');
    this.events.emit('shelved', { bay, combo: r.combo });
    if (!r.tutorialActive) this.branchMechanics?.onShelved(it, bay);
  }

  onBayChanged(bay) { this.level.refreshBay(bay); }

  addChaos(amount) {
    // A cleanup window is a true reprieve: direct incident penalties cannot
    // sneak around the per-frame rate pause. Quiet Please remains a separate
    // effect and either one can independently hold Chaos.
    if (amount > 0 && isChaosPaused(this.run)) return 0;
    const damp = 1 - (this.player?.stats.chaosDampening ?? 0) / 100;
    const before = this.run.chaos;
    this.run.chaos = Math.min(this.run.maxChaos, before + amount * damp);
    return this.run.chaos - before;
  }

  /** Stereo pan for a world position, from its horizontal place on screen. */
  _panFor(x, z) {
    const cam = this.render.camera;
    _panVec.set(x, 1, z);
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    _panVec.project(cam);
    // Behind the camera the projection flips; treat that as dead center.
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

    const stateBeforeInput = this.state;
    this.input.pollGamepad();
    // Menus may synchronously resume a paused game from the same Start edge.
    // Only a press that began while already playing is allowed to pause.
    if (stateBeforeInput === STATE.PLAYING && this.state === STATE.PLAYING && this.input.wasPressed('pause')) this.pause();

    if (this.state === STATE.PLAYING) {
      this._step(dt * this.timeScale);
    } else if (this.state === STATE.LEVELUP) {
      // Time crawls while you choose an upgrade — reads as a beat, not a stop.
      this._step(dt * 0.08);
    } else if (this.level && this.player) {
      this.level.update(dt, this.player, this.render.camera.position);
      // Keep warning rings rendered during pause without aging them past the
      // simulation-time hazard they telegraph.
      this.fx?.update(presentationFxDelta(this.state, dt));
    }

    if (this.level) {
      // The canvas owns camera gestures only during live play. Menu overlays,
      // pause, loading, and upgrade cards retain normal left-click behavior.
      if (this.state === STATE.PLAYING && this.input.enabled) {
        this.camera.orbit(this.input.mouse.dragX, this.input.mouse.dragY);
        if (this.input.mouse.wheel) this.camera.zoom(this.input.mouse.wheel);
      }
      this.camera.update(dt, this.player ?? { x: 0, z: 0 }, { x: this.player?.vx ?? 0, z: this.player?.vz ?? 0 });
      this.render.setFocusDistance(this.camera.distance);
      this.render.setChaosGrade(this.run ? this.run.chaos / this.run.maxChaos : 0);
    }

    this.hud?.update(dt);
    this.render.renderer.info.reset();
    this.render.render(dt);
    this.input.endFrame();
  }

  _step(dt) {
    const r = this.run;
    this.clock += dt;
    r.sessionElapsed += dt;
    // Guided training is an onboarding prologue, not part of the scored
    // fifteen-minute shift. New players always receive the full run afterward.
    if (r.tutorialActive) r.trainingElapsed += dt;
    else r.elapsed += dt;

    if (r.comboTimer > 0) {
      r.comboTimer -= dt;
      if (r.comboTimer <= 0) r.combo = 0;
    }

    this.player.update(dt, this.input);
    if (this.theme?.id !== 'cemetery') {
      this.powers.update(dt, this.input);
      this.items.update(dt, this);
    }
    this.kids.update(dt);
    this.bosses.update(dt);
    this.disasters.update(dt);
    this.director.update(dt);
    this.branchMechanics?.update(dt);
    this.fx.update(dt);
    this.level.update(dt, this.player, this.render.camera.position);
    if (this.theme?.id !== 'cemetery') this.items.render(this.render.camera);

    this._updateChaos(dt);
    // Second Wind and other run-ending guards must see Chaos added by this
    // frame before the terminal checks below.
    this.progression.update(dt);
    this.telemetry?.update(dt);

    const headlineActive = this.bosses.active.length || this.vampires?.active.some((v) => v.master);
    this.audio.setIntensity(Math.min(1, r.chaos / r.maxChaos * 1.15 + (headlineActive ? 0.3 : 0)));

    if (r.chaos >= r.maxChaos) this.endRun(false, 'chaos');
    else if (this.player.health <= 0) this.endRun(false, 'health');
    else if (r.elapsed >= r.duration) this.endRun(true, 'survived');
  }

  _updateChaos(dt) {
    const r = this.run;
    if (this.theme?.id === 'cemetery') {
      const activity = this.vampires?.activityPressure || 0;
      // Population pressure remains the primary threat, but a Slayer who is
      // actively hunting must have time to cross the generated grounds. The
      // coefficient targets an idle loss around mid-patrol while letting a
      // steady 3–4 dustings/minute reach sunrise.
      const rate = cemeteryPressureRate({ elapsed: r.elapsed, duration: r.duration, activity });
      this.addChaos(rate * dt);
      if (activity <= 0 && r.chaos > 4) r.chaos = Math.max(4, r.chaos - 0.18 * dt);
      r.peakChaos = Math.max(r.peakChaos, r.chaos);
      return;
    }
    const floor = this.items.floorCount;
    const held = this.items.looseCount - floor;
    const messes = this.disasters.messCount;

    // Quiet Please and the post-disaster cleanup window are independent. While
    // either is active the meter holds exactly; picking up and filing can still
    // lower it, which is the point of the one-minute disaster reprieve.
    if (!isChaosPaused(r)) {
      const rate = chaosPressureRate({
        elapsed: r.elapsed,
        floor,
        held,
        messes,
        bossPressure: this.bosses.chaosPressure,
      });
      if (rate > 0) this.addChaos(rate * dt);

      // Getting on top of the mess is rewarded, not just perfection — the meter
      // visibly retreats before the room is completely pristine. Recovery stops
      // at a small readable baseline so a tidy opening does not pin the meter at
      // zero and recreate the old "nothing happens for minutes" problem.
      const cleanRelief = cleanFloorReliefRate(floor, messes);
      if (cleanRelief > 0 && r.chaos > CHAOS_BALANCE.cleanFloorChaosFloor) {
        r.chaos = Math.max(
          CHAOS_BALANCE.cleanFloorChaosFloor,
          r.chaos - cleanRelief * dt,
        );
      }
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
