import { ITEM_COLORS } from '../data/themes.js';
import { queryBays } from '../world/generator.js';
import { formatKeyCode, gamepadLabelFor } from '../core/input.js';
import { SIGNATURE_POWER_IDS } from '../data/upgrades.js';
import { ITEM_STATE } from './items.js';

const EVENT_GUIDES = {
  masterVampire: {
    title: 'DUST THE MASTER',
    body: 'The Master Vampire is tougher, faster, and visibly tracked above the action and on the map. Dodge its rushes, then alternate stake lunges and kicks.',
  },
  bully: {
    title: 'CATCH THE BULLY',
    body: 'Follow the red BULLY marker on the map. Chase Braden and stay right beside him to drain his bar.',
  },
  karen: {
    title: 'SATISFY THE COMPLAINT',
    body: 'File the requested color into matching shelves. The boss bar shows the exact color and remaining count.',
  },
  sickKid: {
    title: 'HELP POORLY PERCY',
    body: (control) => `Stand in each green puddle and hold ${control} to mop. Staying close to Percy also comforts him.`,
  },
  chaperone: {
    title: 'CONFRONT THE CHAPERONE',
    body: 'Follow the blue CHAPERONE marker and stay close to confront her while controlling the children she brings.',
  },
  earthquake: {
    title: 'EARTHQUAKE',
    body: 'The whole branch is shaking books loose around you. Collect and refile the new floor pile before Chaos climbs.',
  },
  tornado: {
    title: 'TRACK THE TORNADO',
    body: 'The orange TORNADO marker moves with it. Keep out of the spinning danger zone, then recover the scattered items.',
  },
  volcano: {
    title: 'VOLCANO SAFETY',
    body: 'Keep away from the orange VOLCANO marker and its lava. Move out of warning rings before the bombs land.',
  },
  aliens: {
    title: 'ALIEN INVASION',
    body: 'Track the green UFO marker and watch which shelf its beam is emptying. Recover and refile the abducted items it drops.',
  },
  mess: {
    title: 'CLEAN THE SPILL',
    body: (control) => `Stand in the green spill and hold ${control} until the clean-up bar fills. Do it before the stain soaks in.`,
  },
};

const BRANCH_GUIDES = {
  cemetery: {
    title: 'WELCOME TO THE PATROL',
    body: 'Move with WASD, sprint with Shift, and dodge with Space. Q stakes the nearest vampire in range; E delivers a wider, heavier Slayer kick. Keep Hellmouth Activity below 100% until sunrise.',
  },
  library: {
    title: 'DEWEY STREAK',
    body: 'Keep filing without a long pause to build a 12-item combo. The branch objective card under the map tracks your streak.',
  },
  videostore: {
    title: 'BE KIND, REWIND',
    body: 'File the requested tape color before the timer expires. The branch objective card shows its color, count, and late-fee clock.',
  },
  recordstore: {
    title: 'BUILD THE SETLIST',
    body: 'File the three colors in the shown order. A wrong color resets the sequence; a perfect set earns a bonus.',
  },
  grocery: {
    title: 'CLEANUP BONUS',
    body: 'Hazardous groceries have special effects. Safely filing one earns bonus XP and eases Chaos; color labels can be enabled in Settings.',
  },
};

/**
 * Action-driven onboarding plus one-time explanations for unfamiliar events.
 * The first-run flag is consumed as soon as the guided shift starts, so
 * refreshing or abandoning cannot make the next run repeat it unexpectedly.
 */
export class TutorialSystem {
  constructor(game, element) {
    this.game = game;
    this.el = element;
    this.activeIntro = false;
    this.step = null;
    this.notice = null;
    this.noticeQueue = [];
    this.practiceItem = null;
    this.didSprint = false;
    this.didDash = false;
    this._mobilitySignature = null;
    this._karenNoticeSignature = null;
    this._stepDelay = 0;
    this.el.hidden = true;
    this.el.setAttribute('aria-hidden', 'true');
  }

  onEvent(type, payload = {}) {
    if (type === 'runStart') this._startRun();
    if (type === 'runEnd') this._endRun();
    if (type === 'upgrade' && this.activeIntro && this.step === 'upgrade') this._onUpgrade(payload);
    if (type === 'power' && this.activeIntro && this.step === 'power') this._onPower(payload);
    if (type === 'bossSpawn') this._eventGuide(payload.type?.id, payload.type?.name);
    if (type === 'disasterStart') this._eventGuide(payload.def?.id, payload.def?.name);
    if (type === 'mess') this._eventGuide('mess', 'Clean-up');
  }

  update(dt) {
    const g = this.game;
    if (!g.run || !g.player) return;

    if (!g.save.tutorialsEnabled) {
      if (this.activeIntro) this._finishIntro(false);
      this.notice = null;
      this.noticeQueue.length = 0;
      this._hide();
      return;
    }

    // HUD rendering continues under pause/draft overlays, but teaching steps
    // and delayed draft triggers must advance only with gameplay simulation.
    if (this.activeIntro && g.state !== 'playing') return;
    if (this.activeIntro) this._updateIntro(dt);
    else this._updateNotice(dt);
  }

  _startRun() {
    this.notice = null;
    this.noticeQueue.length = 0;
    this.practiceItem = null;
    this.didSprint = false;
    this.didDash = false;
    this._mobilitySignature = null;
    this._karenNoticeSignature = null;

    if (this.game.theme?.id === 'cemetery') {
      this.game.run.tutorialActive = false;
      this.activeIntro = false;
      this.step = null;
      this._hide();
      this._branchGuide();
      return;
    }

    if (!this.game.save.shouldShowIntroTutorial()) {
      this.game.run.tutorialActive = false;
      this.activeIntro = false;
      this._hide();
      this._branchGuide();
      return;
    }

    // Do not let a one-off guided promotion alter this player's daily build.
    // Keep first-shift training unconsumed for their next regular shift.
    if (this.game.run.isDaily) {
      this.game.run.tutorialActive = false;
      this.activeIntro = false;
      this.step = null;
      this.noticeQueue.push({
        id: 'daily-training',
        title: 'DAILY SHIFT · STANDARD START',
        body: 'Guided training waits for a regular shift so it does not alter your daily starting build. The shared challenge guarantees the same floor seed.',
        t: 12,
      });
      this._nextNotice();
      this._branchGuide();
      return;
    }

    this.game.save.beginIntroTutorial();
    this.game.run.tutorialActive = true;
    this.activeIntro = true;
    this.step = 'move';
    this.startX = this.game.player.x;
    this.startZ = this.game.player.z;
    this._show({
      eyebrow: 'FIRST SHIFT · 1 OF 5',
      title: 'GET YOUR BEARINGS',
      body: 'Move through the branch. The map rotates with the camera, so moving up-screen also moves up on the map.',
      key: this.game.input.usingGamepad ? 'LEFT STICK' : 'WASD / ARROW KEYS',
    });
  }

  _endRun() {
    this._cleanupPowerTarget();
    if (this.game.run) this.game.run.tutorialActive = false;
    this.activeIntro = false;
    this.step = null;
    this.notice = null;
    this.noticeQueue.length = 0;
    this._hide();
  }

  _updateIntro(dt) {
    const g = this.game;
    const p = g.player;

    if (this.step === 'move') {
      if (Math.hypot(p.x - this.startX, p.z - this.startZ) < 2.2) return;
      this._spawnPracticeItem();
      return;
    }

    if (this.step === 'pickup') {
      if (g.run.pickedUp <= this.pickupBaseline && !p.carried.includes(this.practiceItem)) return;
      this.step = 'shelve';
      const color = this.practiceItem?.color || p.carried[0]?.color;
      const name = ITEM_COLORS[color]?.name ?? color ?? 'matching';
      const noun = g.theme.itemNoun || 'item';
      this._show({
        eyebrow: 'FIRST SHIFT · 3 OF 5',
        title: `FILE THE ${String(name).toUpperCase()} ${noun.toUpperCase()}`,
        body: `Follow the ${name} arrow to a ${name} shelf. Filing happens automatically when you get close.`,
        key: 'FOLLOW THE COLORED ARROW',
        color: ITEM_COLORS[color]?.ui,
      });
      return;
    }

    if (this.step === 'shelve') {
      if (g.run.shelved <= this.shelveBaseline) return;
      this.step = 'mobility';
      this.practiceItem = null;
      this._showMobility();
      return;
    }

    if (this.step === 'mobility') {
      const moving = Math.hypot(p.vx, p.vz) > 1;
      if (moving && g.input.isDown('sprint')) this.didSprint = true;
      if (p.dashActive > 0) this.didDash = true;
      this._showMobility();
      if (!this.didSprint || !this.didDash) return;
      this.step = 'upgrade';
      this._stepDelay = 0.45;
      this._show({
        eyebrow: 'FIRST SHIFT · 5 OF 5',
        title: 'EARN A SIGNATURE POWER',
        body: 'Nice work. Your first promotion is ready—choose one of the blue POWER cards.',
        key: 'PICK A BLUE POWER CARD',
      });
      return;
    }

    if (this.step === 'upgrade') {
      this._stepDelay -= dt;
      if (this._stepDelay > 0 || g.progression.currentOffer) return;
      this._stepDelay = Infinity;
      const need = Math.max(1, g.progression.xpToNext - g.progression.xp + 0.01);
      g.progression.addXP(need);
      return;
    }

    if (this.step === 'power') {
      return;
    }
  }

  _spawnPracticeItem() {
    const g = this.game;
    const p = g.player;
    const bays = queryBays(g.layout, p.x, p.z, 22)
      .filter((b) => b.filled > 0)
      .sort((a, b) => ((a.wx - p.x) ** 2 + (a.wz - p.z) ** 2) - ((b.wx - p.x) ** 2 + (b.wz - p.z) ** 2));

    let chosen = null;
    for (const bay of bays) {
      const ax = bay.wx + bay.nx * 1.25;
      const az = bay.wz + bay.nz * 1.25;
      if (g.collision.isBlocked(ax, az)) continue;
      if (!g.pathfinder.find(p.x, p.z, ax, az)) continue;
      chosen = { bay, ax, az };
      break;
    }

    if (chosen) {
      const out = g.items.knockOff(chosen.bay, 1, { force: 0.15 });
      const it = out[0];
      if (it) {
        // Place the explicitly announced practice item in the reachable aisle,
        // rather than allowing its physical pop to bounce behind the shelf.
        it.x = chosen.ax; it.z = chosen.az; it.y = 0.32;
        it.vx = 0; it.vz = 0; it.vy = 0;
        g.level.refreshBay(chosen.bay);
        this.practiceItem = it;
      }
    }

    // Extremely defensive fallback for a malformed layout. The normal path is
    // always a shelf knock-off, preserving visual inventory correctly.
    if (!this.practiceItem) {
      const color = g.theme.colors[0];
      this.practiceItem = g.items.spawn(p.x - Math.sin(g.camera.yaw) * 3, 0.32, p.z - Math.cos(g.camera.yaw) * 3, color);
    }

    this.pickupBaseline = g.run.pickedUp;
    this.shelveBaseline = g.run.shelved;
    this.step = 'pickup';
    const color = this.practiceItem?.color;
    const name = ITEM_COLORS[color]?.name ?? color ?? 'loose';
    const noun = g.theme.itemNoun || 'item';
    g.hud.banner(`A PRACTICE ${noun.toUpperCase()} SLIPS FREE`, 'This one is part of training—not a random shelf drop.');
    this._show({
      eyebrow: 'FIRST SHIFT · 2 OF 5',
      title: `PICK UP THE ${String(name).toUpperCase()} ${noun.toUpperCase()}`,
      body: `Walk close to the pulsing ${noun}. Your librarian vacuums loose ${g.theme.itemNounPlural || 'items'} into their arms automatically.`,
      key: 'WALK INTO PICKUP RANGE',
      color: ITEM_COLORS[color]?.ui,
    });
  }

  _showMobility() {
    const sprint = formatKeyCode(this.game.input.bindingFor('sprint'));
    const dash = formatKeyCode(this.game.input.bindingFor('dash'));
    const signature = [this.didSprint, this.didDash, this.game.input.usingGamepad, sprint, dash].join(':');
    if (signature === this._mobilitySignature) return;
    this._mobilitySignature = signature;
    this._show({
      eyebrow: 'FIRST SHIFT · 4 OF 5',
      title: 'MOVE WITH PURPOSE',
      body: `${this.didSprint ? '✓' : '○'} Sprint while moving    ${this.didDash ? '✓' : '○'} Dash while moving`,
      key: this.game.input.usingGamepad ? 'RT SPRINT · A DASH' : `${sprint} SPRINT · ${dash} DASH`,
    });
  }

  _onUpgrade({ id, def }) {
    if (!SIGNATURE_POWER_IDS.includes(id)) return;
    this.step = 'power';
    this.powerAction = id;
    this._preparePowerTarget(id);
    const key = formatKeyCode(this.game.input.bindingFor(id));
    const instruction = id === 'bookerang'
      ? 'A practice item is in your arms. Throw it home to prove the power works.'
      : id === 'gravityGun'
        ? 'A practice item is loose nearby. The training beam will lock onto it.'
        : 'A practice item is loose nearby. Shush it back to its matching shelf.';
    this._show({
      eyebrow: 'FIRST SHIFT · FINAL STEP',
      title: `TRY ${String(def.name).toUpperCase()}`,
      body: `${instruction} Powers recharge, so there is no reason to save them forever.`,
      key: this.game.input.usingGamepad
        ? `PRESS ${gamepadLabelFor(id)} · HIGHLIGHTED BELOW`
        : `PRESS ${key} · HIGHLIGHTED BELOW`,
      color: '#6fb6f0',
    });
  }

  _preparePowerTarget(id) {
    const g = this.game;
    const p = g.player;
    const bays = queryBays(g.layout, p.x, p.z, 12)
      .filter((bay) => bay.filled > 0)
      .sort((a, b) => ((a.wx - p.x) ** 2 + (a.wz - p.z) ** 2) - ((b.wx - p.x) ** 2 + (b.wz - p.z) ** 2));
    const bay = bays[0] || null;
    let item = bay ? g.items.knockOff(bay, 1, { force: 0.05 })[0] : null;
    if (!item) {
      item = g.items.spawn(
        p.x + Math.sin(p.yaw) * 3,
        0.32,
        p.z + Math.cos(p.yaw) * 3,
        g.theme.colors[0],
      );
    }
    if (!item) return;

    if (bay) {
      item.x = bay.wx + bay.nx * 1.2;
      item.z = bay.wz + bay.nz * 1.2;
    }
    item.y = 0.32;
    item.vx = 0;
    item.vy = 0;
    item.vz = 0;
    item.grounded = true;
    item.trainingPowerTarget = true;
    item.trainingSourceBay = bay;
    item.trainingSourceDisplaced = !!bay;
    if (id === 'bookerang') {
      item.state = ITEM_STATE.CARRIED;
      item.holder = p;
      p.carried.push(item);
    }
    this.powerTarget = { id, item, bay };
    this.practiceItem = item;
    g.run.tutorialPowerTarget = this.powerTarget;
    if (bay) g.level.refreshBay(bay);
  }

  _onPower({ id, hits } = {}) {
    if (id !== this.powerAction || Number(hits) <= 0) return;
    this._finishIntro(true);
  }

  _cleanupPowerTarget() {
    const target = this.powerTarget;
    if (!target) return;
    const g = this.game;
    const { item, bay } = target;
    const restoreSource = !!bay && item?.trainingSourceDisplaced;
    const carriedIndex = g.player?.carried?.indexOf(item) ?? -1;
    if (carriedIndex >= 0) g.player.carried.splice(carriedIndex, 1);
    if (item?.active) g.items?.release?.(item);
    if (restoreSource) {
      bay.filled++;
      g.level?.refreshBay?.(bay);
    }
    if (g.run) g.run.tutorialPowerTarget = null;
    this.powerTarget = null;
    this.practiceItem = null;
  }

  prepareRunEnd() {
    if (!this.activeIntro && !this.game.run?.tutorialActive) return false;
    this._cleanupPowerTarget();
    this._resetTrainingState();
    this.activeIntro = false;
    this.step = null;
    this._hide();
    return true;
  }

  _resetTrainingState() {
    const g = this.game;
    if (!g.run) return;
    // Keep the taught loadout when training completes, but none of its
    // practice work, XP, combo, damage, or movement enters scored service.
    Object.assign(g.run, {
      tutorialActive: false,
      pickedUp: 0,
      shelved: 0,
      combo: 0,
      comboTimer: 0,
      bestCombo: 0,
      xpEarned: 0,
      chaos: 0,
      peakChaos: 0,
      chaosFrozen: false,
    });
    g.progression.xp = 0;
    g.progression._teaCounter = 0;
    if (g.player.stats?.maxHealth !== undefined) g.player.health = g.player.stats.maxHealth;
    if (g.player.stats?.maxStamina !== undefined) g.player.stamina = g.player.stats.maxStamina;
    g.player.vx = 0;
    g.player.vz = 0;
    g.player.dashTimer = 0;
    g.player.dashActive = 0;
    if (g.powers) {
      for (const id of Object.keys(g.powers.cooldowns || {})) g.powers.cooldowns[id] = 0;
      g.powers.sortField = null;
      g.powers.sortFieldTick = 0;
      g.powers.beamTimer = 0;
      g.powers.quietActive = 0;
      // Automatic QUIET PLEASE may have fired while the training clock was
      // frozen. Clear its effect without granting an immediate free retrigger
      // on the first scored frame.
      if (g.powers.levels?.quietPlease > 0 && g.powers.stat) {
        g.powers.cooldowns.quietPlease = g.powers.stat('quietPlease', 'cooldown');
      }
      if (g.powers.beam) g.fx?.hideBeam?.(g.powers.beam);
    }
    g.telemetry?.resetAfterTraining?.();
  }

  _finishIntro(celebrate) {
    const g = this.game;
    this._cleanupPowerTarget();
    this._resetTrainingState();
    this.activeIntro = false;
    this.step = null;
    this.practiceItem = null;
    this._hide();
    if (celebrate) {
      this.game.hud.banner('TRAINING COMPLETE', 'Normal library service has begun. Good luck.');
      this._branchGuide();
    }
  }

  _branchGuide() {
    const id = this.game.theme?.id;
    const guide = BRANCH_GUIDES[id];
    const key = `branch:${id}`;
    if (!guide || !this.game.save.tutorialsEnabled || this._hasOrQueuedGuide(key)) return;
    this.noticeQueue.push({ ...guide, id: key, seenKey: key, t: 12, delay: 3.2 });
    if (!this.notice) this._nextNotice();
  }

  _eventGuide(id, fallbackTitle) {
    if (!id || !this.game.save.tutorialsEnabled) return;
    const key = `event:${id}`;
    if (this._hasOrQueuedGuide(key)) return;
    const guide = EVENT_GUIDES[id] || { title: fallbackTitle || 'NEW OBJECTIVE', body: 'Watch the objective and map markers for what to do next.' };
    const control = this.game.input.usingGamepad
      ? gamepadLabelFor('mop')
      : formatKeyCode(this.game.input.bindingFor('mop'));
    const body = typeof guide.body === 'function' ? guide.body(control) : guide.body;
    this.noticeQueue.push({ ...guide, body, id, seenKey: key, t: 12 });
    if (!this.activeIntro && !this.notice) this._nextNotice();
  }

  _updateNotice(dt) {
    if (!this.notice) { this._nextNotice(); return; }
    if (this.game.state === 'paused' || this.game.state === 'levelup') return;
    if (this.notice.delay > 0) {
      this.notice.delay -= dt;
      if (this.notice.delay <= 0) this._renderNotice();
      return;
    }
    this.notice.t -= dt;
    if (this.notice.id === 'karen') this._refreshKarenNotice();
    if (this.notice.t > 0) return;
    this.notice = null;
    this._hide();
    this._nextNotice();
  }

  _nextNotice() {
    this.notice = this.noticeQueue.shift() || null;
    if (!this.notice) return;
    if (this.notice.id === 'karen') this._karenNoticeSignature = null;
    if (this.notice.delay > 0) { this._hide(); return; }
    this._renderNotice();
  }

  _renderNotice() {
    if (this.notice.seenKey && !this.game.save.hasSeenTutorial(this.notice.seenKey)) {
      // Persist only when the guide actually reaches the screen. A queued or
      // delayed brief discarded by an early run end must remain eligible next
      // time the player encounters it.
      this.game.save.markTutorialSeen(this.notice.seenKey);
    }
    this._show({ eyebrow: 'FIRST ENCOUNTER · QUICK BRIEF', title: this.notice.title, body: this.notice.body, key: 'OBJECTIVE ALSO SHOWN ABOVE' });
  }

  _hasOrQueuedGuide(key) {
    return this.game.save.hasSeenTutorial(key)
      || this.notice?.seenKey === key
      || this.noticeQueue.some((notice) => notice.seenKey === key);
  }

  _refreshKarenNotice() {
    const b = this.game.bosses?.active.find((boss) => boss.alive && boss.type.id === 'karen');
    if (!b) return;
    const color = ITEM_COLORS[b.demandColor];
    const signature = `${b.demandColor}:${b.demandLeft}:${b.demandTotal}`;
    if (signature === this._karenNoticeSignature) return;
    this._karenNoticeSignature = signature;
    this._show({
      eyebrow: 'FIRST ENCOUNTER · KAREN',
      title: `FILE ${b.demandLeft} ${String(color?.name ?? b.demandColor).toUpperCase()} ITEMS`,
      body: `Pick up ${color?.name ?? b.demandColor} items and carry them to matching ${color?.name ?? b.demandColor} shelves. Each correct filing satisfies one complaint.`,
      key: `${b.demandLeft} OF ${b.demandTotal} REMAINING`,
      color: color?.ui,
    });
  }

  _show({ eyebrow, title, body, key = '', color = '' }) {
    this.el.querySelector('.tutorial-eyebrow').textContent = eyebrow;
    this.el.querySelector('.tutorial-title').textContent = title;
    this.el.querySelector('.tutorial-body').textContent = body;
    this.el.querySelector('.tutorial-key').textContent = key;
    this.el.style.setProperty('--tutorial-accent', color || '#e8b64c');
    this.el.hidden = false;
    this.el.setAttribute('aria-hidden', 'false');
    this.el.classList.add('on');
  }

  _hide() {
    this.el.classList.remove('on');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.hidden = true;
  }
}
