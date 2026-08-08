import { THEMES, THEME_ORDER } from '../data/themes.js';
import { META_LIST, metaCost } from '../data/meta.js';
import { UPGRADES } from '../data/upgrades.js';
import { CHARACTER_LIST } from '../data/characters.js';
import { QUALITY } from '../render/renderer.js';

const LOADING_LINES = [
  'Shelving the shelves…',
  'Alphabetising the alphabet…',
  'Warning the children…',
  'Laminating something…',
  'Consulting the Dewey Decimal System…',
  'Waxing the parquet…',
  'Hiding the good chair…',
  'Rewinding the tapes…',
  'Checking under the beanbags…',
];

const TIPS = [
  '<b>WASD</b> to move · <b>Shift</b> to sprint · <b>Space</b> to dash',
  'Books vacuum in automatically — just get close.',
  'Stand near a shelf of the matching colour to file what you carry.',
  'Chaos falls fastest when the floor is completely clear.',
  '<b>Q</b> beams distant books to you · <b>E</b> throws them home · <b>F</b> shushes a whole colour',
  'Combos multiply XP. Keep filing without pausing.',
  'Bullies must be chased down. Karens must be obeyed.',
  '<b>R</b> mops up whatever a poorly child leaves behind.',
];

/** Every full-screen overlay: menu, level select, shop, draft, pause, results. */
export class Menus {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.innerHTML =
      '<button class="overlay-back" type="button">\u2190 BACK <span class="esc">ESC</span></button>' +
      '<div class="sheet"></div>';
    game.uiRoot.appendChild(this.root);
    this.sheet = this.root.querySelector('.sheet');
    this.backBtn = this.root.querySelector('.overlay-back');
    this.current = null;
    this.onBack = null;

    this.backBtn.addEventListener('click', () => {
      this.game.audio.play('ui');
      this.onBack?.();
    });

    // Escape always gets you off a sub-screen. Pause has its own handler in
    // Game, so only act when this overlay owns a back action.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      if (!this.root.classList.contains('on') || !this.onBack) return;
      e.stopPropagation();
      this.game.audio.play('ui');
      this.onBack();
    });
  }

  /**
   * @param {Function|null} onBack shows the pinned escape hatch when provided.
   */
  _show(html, name, onBack = null) {
    this.sheet.innerHTML = html;
    this.root.classList.add('on');
    this.current = name;
    this.onBack = onBack;
    this.backBtn.classList.toggle('show', !!onBack);
    this.sheet.classList.toggle('has-back', !!onBack);
    this.sheet.scrollTop = 0;
    // Reset the entrance animation on every open.
    this.sheet.style.animation = 'none';
    void this.sheet.offsetHeight;
    this.sheet.style.animation = '';
  }

  hideAll() {
    this.root.classList.remove('on');
    this.current = null;
    this.onBack = null;
    this.backBtn.classList.remove('show');
    // Detach the draft's number-key shortcuts, or they stay live in-game.
    this._keyHandler?.();
    this._keyHandler = null;
  }

  _click(sel, fn) {
    this.sheet.querySelectorAll(sel).forEach((el) => {
      el.classList.add('clickable');
      el.addEventListener('click', (e) => {
        this.game.audio.play('ui');
        fn(el, e);
      });
      el.addEventListener('mouseenter', () => this.game.audio.play('ui', { volume: 0.25, rate: 1.6 }));
    });
  }

  // --- main menu ------------------------------------------------------------

  showMain() {
    const s = this.game.save;
    const next = s.nextUnlock();
    this._show(`
      <div class="title-block">
        <div class="kicker">THE LIBRARIAN</div>
        <h1>THE LIBRARIAN <span style="font-size:.62em">II</span></h1>
        <div class="sub">“Look, Ma, I Could Read Good”</div>
      </div>
      <div class="rule"></div>
      <div class="menu-actions">
        <button class="btn primary" data-a="play">BEGIN A SHIFT</button>
        <button class="btn" data-a="levels">CHOOSE A BRANCH<small>${s.unlockedThemes().length} of ${THEME_ORDER.length} unlocked</small></button>
        <button class="btn" data-a="shop">STAFF DEVELOPMENT<small>${s.cards} library cards to spend</small></button>
        <button class="btn ghost" data-a="settings">SETTINGS</button>
      </div>
      <div class="stats-strip">
        <div class="stat"><div class="v">${s.data.runs}</div><div class="k">SHIFTS</div></div>
        <div class="stat"><div class="v">${s.data.wins}</div><div class="k">SURVIVED</div></div>
        <div class="stat"><div class="v">${s.data.bestScore.toLocaleString()}</div><div class="k">BEST SCORE</div></div>
        <div class="stat"><div class="v">${Math.floor(s.lifetimeXP).toLocaleString()}</div><div class="k">LIFETIME XP</div></div>
      </div>
      ${next ? `<div class="unlock-note">${next.theme.icon} <b>${next.theme.name}</b> unlocks in ${Math.ceil(next.remaining).toLocaleString()} more lifetime XP</div>` : ''}
      <div class="hint-row">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>
    `, 'main');

    this._click('[data-a]', (el) => {
      const a = el.dataset.a;
      if (a === 'play') this.showCharacterSelect(this.game.save.unlockedThemes()[0]);
      if (a === 'levels') this.showLevels();
      if (a === 'shop') this.showShop();
      if (a === 'settings') this.showSettings();
    });
  }

  showLevels() {
    const s = this.game.save;
    const cards = THEME_ORDER.map((id) => {
      const t = THEMES[id];
      const unlocked = s.lifetimeXP >= t.xpToUnlock;
      const best = s.data.bestByTheme[id] || 0;
      return `
        <div class="level-card ${unlocked ? '' : 'locked'}" data-theme="${id}">
          <div class="ico">${t.icon}</div>
          <h3>${t.name}</h3>
          <p>${t.blurb}</p>
          <div class="best">${best ? `BEST ${best.toLocaleString()}` : 'NOT YET PLAYED'}</div>
          ${unlocked ? '' : `<div class="lock">🔒 ${t.xpToUnlock.toLocaleString()} LIFETIME XP</div>`}
        </div>`;
    }).join('');

    this._show(`
      <div class="section-title">CHOOSE A BRANCH</div>
      <div class="section-sub">EVERY VISIT GENERATES A COMPLETELY NEW FLOOR PLAN</div>
      <div class="levels">${cards}</div>
    `, 'levels', () => this.showMain());

    this._click('.level-card:not(.locked)', (el) => this.showCharacterSelect(el.dataset.theme));
  }

  showCharacterSelect(themeId) {
    const last = this.game.save.data.lastCharacter;
    const theme = THEMES[themeId];
    const cards = CHARACTER_LIST.map((ch) => `
      <div class="char-card ${ch.id === last ? 'last' : ''}" data-char="${ch.id}">
        ${ch.id === last ? '<div class="last-tag">LAST PLAYED</div>' : ''}
        <div class="char-stage"><canvas data-portrait="${ch.id}"></canvas></div>
        <h3>${ch.name}</h3>
        <div class="char-role">${ch.icon} ${ch.title}</div>
        <p>${ch.blurb}</p>
        <div class="swatches">${ch.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      </div>`).join('');

    this._show(`
      <div class="section-title">WHO IS ON SHIFT?</div>
      <div class="section-sub">${theme.icon} ${theme.name.toUpperCase()} &nbsp;·&nbsp; BOTH HANDLE IDENTICALLY</div>
      <div class="chars">${cards}</div>
    `, 'character', () => this.showMain());

    this._renderPortraits();
    this._click('.char-card', (el) => {
      this.game.audio.play('uiBig');
      this.game.startRun({ themeId, characterId: el.dataset.char });
    });
  }

  /**
   * Draw each librarian into their card with a throwaway three.js scene, so the
   * select screen shows the actual in-game model rather than an illustration.
   */
  _renderPortraits() {
    import('../render/portrait.js').then(({ renderPortrait }) => {
      requestAnimationFrame(() => {
        for (const ch of CHARACTER_LIST) {
          const cv = this.sheet.querySelector(`canvas[data-portrait="${ch.id}"]`);
          if (cv) renderPortrait(cv, ch);
        }
      });
    });
  }

  showShop() {
    const s = this.game.save;
    const items = META_LIST.map((def) => {
      const lvl = s.metaLevel(def.id);
      const maxed = lvl >= def.max;
      const cost = maxed ? 0 : metaCost(def, lvl);
      const afford = !maxed && s.cards >= cost;
      const pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `
        <div class="shop-item ${afford ? 'buyable' : ''}" data-id="${def.id}">
          <div class="head"><span class="ico">${def.icon}</span><h4>${def.name}</h4></div>
          <p>${def.desc(Math.min(def.max, lvl + 1))}</p>
          <div class="foot">
            <span class="pips">${pips}</span>
            <span class="price ${maxed ? 'max' : afford ? '' : 'cant'}">${maxed ? 'MAXED' : `${cost} 🎟`}</span>
          </div>
        </div>`;
    }).join('');

    this._show(`
      <div class="section-title">STAFF DEVELOPMENT</div>
      <div class="section-sub">PERMANENT PERKS — THEY CARRY INTO EVERY FUTURE SHIFT</div>
      <div class="wallet">🎟 ${s.cards} LIBRARY CARDS</div>
      <div class="shop">${items}</div>
    `, 'shop', () => this.showMain());

    this._click('.shop-item.buyable', (el) => {
      if (this.game.save.buyMeta(el.dataset.id)) {
        this.game.audio.play('powerup');
        this.showShop();
      } else {
        this.game.audio.play('error');
      }
    });
  }

  showSettings() {
    const s = this.game.save.settings;
    const q = this.game.render.quality;
    this._show(`
      <div class="section-title">SETTINGS</div>
      <div style="max-width:560px;margin:0 auto">
        <div class="settings-row">
          <label>GRAPHICS</label>
          <div class="seg" data-seg="quality">
            ${Object.values(QUALITY).map((v) => `<button data-v="${v}" class="${v === q ? 'on' : ''}">${v.toUpperCase()}</button>`).join('')}
          </div>
        </div>
        <div class="settings-row"><label>MASTER VOLUME</label><input type="range" min="0" max="1" step="0.05" value="${s.master}" data-set="master"></div>
        <div class="settings-row"><label>MUSIC</label><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-set="music"></div>
        <div class="settings-row"><label>SOUND EFFECTS</label><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-set="sfx"></div>
        <div class="settings-row">
          <label>ERASE ALL PROGRESS</label>
          <button class="btn ghost" data-a="wipe" style="padding:8px 16px;font-size:11px">RESET SAVE</button>
        </div>
      </div>
    `, 'settings', () => this.showMain());

    this.sheet.querySelectorAll('input[data-set]').forEach((el) => {
      el.classList.add('clickable');
      el.addEventListener('input', () => {
        const v = Number(el.value);
        const k = el.dataset.set;
        this.game.save.setSetting(k, v);
        if (k === 'master') this.game.audio.setVolume(v);
        if (k === 'music') this.game.audio.setMusicVolume(v);
        if (k === 'sfx') this.game.audio.setSfxVolume(v);
      });
    });
    this._click('[data-seg="quality"] button', (el) => {
      this.game.render.setQuality(el.dataset.v);
      this.game.save.setSetting('quality', el.dataset.v);
      this.showSettings();
    });
    this._click('[data-a="wipe"]', () => {
      this.game.save.reset();
      this.game.audio.play('error');
      this.showMain();
    });
  }

  showLoading() {
    this._show(`
      <div class="loading-inner">
        <div class="spinner"></div>
        <h2>${LOADING_LINES[Math.floor(Math.random() * LOADING_LINES.length)]}</h2>
        <p>GENERATING A LIBRARY THAT HAS NEVER EXISTED BEFORE</p>
      </div>
    `, 'loading');
  }

  // --- level-up draft -------------------------------------------------------

  showLevelUp(options, level, rerolls) {
    const cards = options.map((u, i) => {
      const cur = this.game.progression.levels[u.id] || 0;
      const isNew = cur === 0;
      return `
        <div class="card ${u.kind === 'power' ? 'power' : ''}" data-id="${u.id}">
          <div class="kbd">${i + 1}</div>
          <div class="ico">${u.icon}</div>
          <h3>${u.name}</h3>
          <div class="tier">${isNew ? 'NEW' : `LEVEL ${cur} → ${cur + 1}`}${u.tag ? ` · KEY ${u.tag}` : ''}</div>
          <p>${u.desc(cur + 1)}</p>
        </div>`;
    }).join('');

    this._show(`
      <div class="title-block" style="margin-bottom:18px">
        <div class="kicker">PROMOTION</div>
        <h1 style="font-size:clamp(30px,5vw,58px)">LEVEL ${level}</h1>
        <div class="sub" style="letter-spacing:.2em">PICK ONE</div>
      </div>
      <div class="draft">${cards}</div>
      ${rerolls > 0 ? `<div class="menu-actions" style="margin-top:20px"><button class="btn ghost" data-a="reroll">🔄 REROLL (${rerolls} left)</button></div>` : ''}
    `, 'levelup');

    this._click('.card', (el) => this.game.progression.choose(el.dataset.id));
    this._click('[data-a="reroll"]', () => this.game.progression.reroll());

    this._keyHandler?.();
    const onKey = (e) => {
      if (!this.game.progression.currentOffer) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) {
        this.game.progression.choose(options[n - 1].id);
      }
      if (e.key === 'r' && rerolls > 0) this.game.progression.reroll();
    };
    window.addEventListener('keydown', onKey);
    this._keyHandler = () => window.removeEventListener('keydown', onKey);
  }

  // --- pause ----------------------------------------------------------------

  showPause() {
    const g = this.game;
    const p = g.progression;
    const owned = Object.entries(p.levels).map(([id, l]) => {
      const def = UPGRADES[id];
      return `<span style="display:inline-block;margin:3px 5px;padding:5px 11px;border-radius:16px;background:rgba(232,182,76,.14);border:1px solid rgba(232,182,76,.3);font-size:11.5px;font-weight:700">${def?.icon ?? ''} ${def?.name ?? id} <b style="color:var(--gold)">${l}</b></span>`;
    }).join('') || '<span style="opacity:.5;font-size:12px">Nothing drafted yet.</span>';

    this._show(`
      <div class="section-title">PAUSED</div>
      <div class="section-sub">${g.theme.name.toUpperCase()} · SEED ${String(g.layout.seed).slice(0, 8)}</div>
      <div class="results-grid">
        <div class="result-stat"><div class="v">${g.run.shelved}</div><div class="k">FILED</div></div>
        <div class="result-stat"><div class="v">${g.run.kidsCalmed}</div><div class="k">CALMED</div></div>
        <div class="result-stat"><div class="v">${Math.floor(g.run.chaos)}%</div><div class="k">CHAOS</div></div>
        <div class="result-stat"><div class="v">${p.level}</div><div class="k">LEVEL</div></div>
      </div>
      <div style="text-align:center;margin:16px 0">${owned}</div>
      <div class="rule"></div>
      <div class="menu-actions">
        <button class="btn primary" data-a="resume">RESUME</button>
        <button class="btn ghost" data-a="quit">ABANDON SHIFT</button>
      </div>
      <div class="hint-row">${TIPS[Math.floor(Math.random() * TIPS.length)]}</div>
    `, 'pause');

    this._click('[data-a="resume"]', () => this.game.resume());
    this._click('[data-a="quit"]', () => this.game.endRun(false, 'quit'));
  }

  // --- results --------------------------------------------------------------

  showResults(won, reason, r, xpGained) {
    const s = this.game.save;
    const REASONS = {
      chaos: 'The chaos meter hit 100%. The building has been surrendered to the children.',
      health: 'You were bumped into one too many times. Take the rest of the day.',
      survived: 'Closing time. Every book accounted for. Mostly.',
      quit: 'You clocked out early. Nobody blames you.',
    };
    const unlocked = s.lastUnlockedTheme ? THEMES[s.lastUnlockedTheme] : null;

    this._show(`
      <div class="title-block">
        <div class="kicker">${won ? 'SHIFT COMPLETE' : 'SHIFT ABANDONED'}</div>
        <h1 style="font-size:clamp(34px,6vw,76px)">${won ? 'CLOSING TIME' : 'PANDEMONIUM'}</h1>
        <div class="sub" style="font-style:normal;letter-spacing:.12em;font-size:13px;font-family:var(--ui);opacity:.7">${REASONS[reason] || ''}</div>
      </div>
      <div class="results-grid">
        <div class="result-stat"><div class="v">${r.score.toLocaleString()}</div><div class="k">SCORE</div></div>
        <div class="result-stat"><div class="v">${fmt(r.elapsed)}</div><div class="k">SURVIVED</div></div>
        <div class="result-stat"><div class="v">${r.shelved}</div><div class="k">BOOKS FILED</div></div>
        <div class="result-stat"><div class="v">${r.kidsCalmed}</div><div class="k">KIDS CALMED</div></div>
        <div class="result-stat"><div class="v">${r.bossesBeaten}</div><div class="k">BOSSES</div></div>
        <div class="result-stat"><div class="v">${r.disastersSurvived}</div><div class="k">DISASTERS</div></div>
        <div class="result-stat"><div class="v">×${r.bestCombo}</div><div class="k">BEST COMBO</div></div>
        <div class="result-stat"><div class="v">${Math.floor(r.peakChaos)}%</div><div class="k">PEAK CHAOS</div></div>
      </div>
      <div class="unlock-note">
        +${Math.floor(xpGained).toLocaleString()} lifetime XP &nbsp;·&nbsp; +${s.lastCardsEarned} 🎟 library cards
      </div>
      ${unlocked ? `<div class="unlock-note" style="border-color:var(--gold)">🎉 NEW BRANCH UNLOCKED — ${unlocked.icon} <b>${unlocked.name}</b></div>` : ''}
      <div class="rule"></div>
      <div class="menu-actions">
        <button class="btn primary" data-a="again">ANOTHER SHIFT</button>
        <button class="btn" data-a="shop">SPEND ${s.cards} 🎟</button>
        <button class="btn ghost" data-a="menu">MAIN MENU</button>
      </div>
    `, 'results');

    this._click('[data-a="again"]', () => this.showCharacterSelect(this.game.theme.id));
    this._click('[data-a="shop"]', () => this.showShop());
    this._click('[data-a="menu"]', () => {
      this.game.disposeRun();
      this.game.showMenu();
    });
  }
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
