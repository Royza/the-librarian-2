import { ITEM_COLORS } from '../data/themes.js';

/**
 * A small rules layer that makes each branch change the way a shift is played,
 * not just its materials. The UI reads `run.branchObjective` directly.
 */
export class BranchMechanics {
  constructor(game) {
    this.game = game;
    this.rng = game.rng.fork(5150);
    this.id = game.theme.id;
    this.timer = 0;
    this.targetColor = null;
    this.progress = 0;
    this.target = 0;
    this.sequence = [];
    this.sequenceIndex = 0;
    this.rewardCooldown = 0;

    if (this.id === 'cemetery') this._setObjective('CEMETERY PATROL', 'Keep Hellmouth Activity under control until sunrise', 0, 1);
    if (this.id === 'library') this._setObjective('DEWEY STREAK', 'Build a 12-item filing combo', 0, 12);
    if (this.id === 'videostore') this._startRewindRush(true);
    if (this.id === 'recordstore') this._newSetlist(true);
    if (this.id === 'grocery') this._setObjective('CLEANUP BONUS', 'File hazardous groceries for safety bonuses', 0, 1);
  }

  _setObjective(label, detail, progress = 0, target = 1, color = null, time = null) {
    this.game.run.branchObjective = { label, detail, progress, target, color, time };
  }

  update(dt) {
    if (this.game.run.tutorialActive) return;
    this.rewardCooldown = Math.max(0, this.rewardCooldown - dt);
    if (this.id === 'cemetery') {
      const o = this.game.run.branchObjective;
      if (o) {
        o.progress = Math.min(1, this.game.run.elapsed / this.game.run.duration);
        o.target = 1;
        o.detail = `${this.game.run.vampiresSlain} vampires slain · ${this.game.kids.count} active threats`;
      }
      return;
    }
    if (this.id === 'library') this._syncLibraryObjective();
    if (this.id !== 'videostore') return;
    this.timer -= dt;
    const o = this.game.run.branchObjective;
    if (o) o.time = Math.max(0, this.timer);
    if (this.timer <= 0) {
      if (this.progress < this.target && !this._intro) {
        this.game.addChaos(4);
        this.game.hud.banner('LATE FEES', `The ${this._colorName()} tapes were not rewound in time.`, { danger: true });
      }
      this._startRewindRush(false);
    }
  }

  onShelved(item, bay) {
    if (this.id === 'library') this._libraryShelved();
    if (this.id === 'videostore') this._videoShelved(item);
    if (this.id === 'recordstore') this._recordShelved(item);
    if (this.id === 'grocery') this._groceryShelved(item);
  }

  _libraryShelved() {
    const combo = this.game.run.combo;
    this._syncLibraryObjective();
    if (combo > 0 && combo % 12 === 0) {
      this.game.run.chaos = Math.max(0, this.game.run.chaos - 2.5);
      this.game.progression.addXP(45);
      this.game.hud.toast('Perfect Dewey streak!  +45 XP · chaos eased');
    }
  }

  _syncLibraryObjective() {
    const combo = this.game.run.combo;
    const o = this.game.run.branchObjective;
    if (o) o.progress = Math.min(12, combo % 12 || (combo ? 12 : 0));
  }

  _startRewindRush(intro) {
    this._intro = intro;
    this.targetColor = this.rng.pick(this.game.theme.colors);
    this.progress = 0;
    this.target = intro ? 2 : 4;
    this.timer = intro ? 55 : 48;
    this._setObjective(
      'BE KIND, REWIND',
      `File ${this.target} ${this._colorName()} tapes before late fees`,
      0, this.target, this.targetColor, this.timer,
    );
  }

  _videoShelved(item) {
    if (item.color !== this.targetColor) return;
    this.progress++;
    this._intro = false;
    const o = this.game.run.branchObjective;
    if (o) o.progress = Math.min(this.target, this.progress);
    if (this.progress < this.target) return;
    this.game.run.chaos = Math.max(0, this.game.run.chaos - 4);
    this.game.progression.addXP(120);
    this.game.hud.banner('REWOUND ON TIME', '+120 XP · late fees avoided');
    this._startRewindRush(false);
  }

  _newSetlist(intro = false) {
    const colors = this.rng.shuffle(this.game.theme.colors).slice(0, 3);
    this.sequence = colors;
    this.sequenceIndex = 0;
    this._setObjective(
      'BUILD THE SETLIST',
      colors.map((c) => ITEM_COLORS[c]?.name ?? c).join('  →  '),
      0, colors.length, colors[0], null,
    );
    if (!intro) this.game.hud.toast('New setlist: file the colors in order');
  }

  _recordShelved(item) {
    const want = this.sequence[this.sequenceIndex];
    if (item.color === want) {
      this.sequenceIndex++;
    } else if (item.color === this.sequence[0]) {
      this.sequenceIndex = 1;
    } else {
      this.sequenceIndex = 0;
    }
    const o = this.game.run.branchObjective;
    if (o) {
      o.progress = this.sequenceIndex;
      o.color = this.sequence[this.sequenceIndex] ?? null;
    }
    if (this.sequenceIndex < this.sequence.length) return;
    this.game.run.chaos = Math.max(0, this.game.run.chaos - 3);
    this.game.progression.addXP(100);
    this.game.hud.banner('PERFECT SETLIST', '+100 XP · order restored');
    this._newSetlist();
  }

  _groceryShelved(item) {
    if (!item.hazard) return;
    const o = this.game.run.branchObjective;
    if (o) o.progress = o.target;
    this.game.run.chaos = Math.max(0, this.game.run.chaos - 1.5);
    this.game.progression.addXP(25);
    this.game.hud.toast(`Safety bonus: ${item.hazard.name} contained`);
  }

  _colorName() { return ITEM_COLORS[this.targetColor]?.name ?? this.targetColor; }

  dispose() { if (this.game.run) this.game.run.branchObjective = null; }
}
