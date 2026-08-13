import { THEMES, THEME_ORDER } from '../data/themes.js';
import { META_LIST, metaCost, metaPresentation } from '../data/meta.js';
import { SIGNATURE_POWER_IDS, UPGRADES } from '../data/upgrades.js';
import { CHARACTER_LIST } from '../data/characters.js';
import { QUALITY, autoDetectQuality } from '../render/renderer.js';
import { DEFAULT_BINDINGS, REMAP_ACTIONS, formatKeyCode, gamepadLabelFor, isEditableTarget } from '../core/input.js';
import { dailyId, dailySeedForDay } from '../core/daily.js';
import { clearPlaytestHistory, getPlaytestHistory } from '../systems/telemetry.js';

const LOADING_COPY = {
  cemetery: {
    lines: ['Opening the cemetery gates…', 'Checking the fresh graves…', 'Waiting for something to rise…', 'Sharpening the stakes…'],
    subtitle: 'GENERATING A CEMETERY THAT HAS NEVER EXISTED BEFORE',
  },
  library: {
    lines: [
      'Shelving the shelves…',
      'Alphabetizing the alphabet…',
      'Warning the children…',
      'Laminating something…',
      'Consulting the Dewey Decimal System…',
      'Waxing the parquet…',
      'Hiding the good chair…',
      'Checking under the beanbags…',
    ],
    subtitle: 'GENERATING A LIBRARY THAT HAS NEVER EXISTED BEFORE',
  },
  videostore: {
    lines: ['Rewinding the tapes…', 'Restocking New Releases…', 'Checking the return slot…'],
    subtitle: 'OPENING A VIDEO STORE THAT HAS NEVER EXISTED BEFORE',
  },
  recordstore: {
    lines: ['Alphabetizing by artist…', 'Testing the turntables…', 'Flipping through the crates…'],
    subtitle: 'OPENING A RECORD STORE THAT HAS NEVER EXISTED BEFORE',
  },
  grocery: {
    lines: ['Opening the checkout lanes…', 'Misting the produce…', 'Facing the grocery shelves…'],
    subtitle: 'OPENING A SUPERMARKET THAT HAS NEVER EXISTED BEFORE',
  },
};

const TIPS = [
  '<b>WASD</b> to move · <b>Shift</b> to sprint · <b>Space</b> to dash',
  '<b>Q</b> attacks with your stake · <b>E</b> delivers a powerful Slayer kick.',
  'Dodge through danger with <b>Space</b>; the Slayer is briefly invulnerable.',
  'Vampires raise Hellmouth Activity while they remain active.',
  'Slay vampires in quick succession to build a combo and earn more XP.',
  'Keep supernatural activity controlled until sunrise.',
];

/** Every full-screen overlay: menu, level select, shop, draft, pause, results. */
export class Menus {
  constructor(game) {
    this.game = game;
    this.root = document.createElement('div');
    this.root.className = 'overlay';
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.innerHTML =
      '<button class="overlay-back" type="button">\u2190 BACK <span class="esc">ESC</span></button>' +
      '<div class="sheet"></div>';
    game.uiRoot.appendChild(this.root);
    this.sheet = this.root.querySelector('.sheet');
    this.backBtn = this.root.querySelector('.overlay-back');
    this.current = null;
    this.onBack = null;
    this._settingsReturnScreen = 'main';
    this._settingsMessage = '';
    this._captureCleanup = null;
    this.game.input.setBindings(this.game.save.settings.keyBindings || {});
    this._applyAccessibilitySettings();

    this.backBtn.addEventListener('click', () => {
      this.game.audio.play('ui');
      this.onBack?.();
    });

    // Escape always gets you off a sub-screen. Pause has its own handler in
    // Game, so only act when this overlay owns a back action.
    window.addEventListener('keydown', (e) => this._handleOverlayBackKey(e));

    window.addEventListener('keydown', (e) => {
      if (!this.root.classList.contains('on') || this._captureCleanup) return;
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) return;
      const active = document.activeElement;
      if (active?.matches('input[type="range"]')) return;
      const direction = e.code.replace('Arrow', '').toLowerCase();
      if (active?.matches('select')) {
        e.preventDefault();
        if (stepSelect(active, direction)) return;
      }
      // Text fields keep native caret/selection behavior. This matters for
      // correcting a copied seed without reaching for a mouse.
      if (isEditableTarget(active)) return;
      e.preventDefault();
      this._moveFocus(direction);
    });
    window.addEventListener('librarian:menu-nav', (e) => this._onControllerCommand(e.detail?.command));
  }

  /**
   * @param {Function|null} onBack shows the pinned escape hatch when provided.
   */
  _show(html, name, onBack = null) {
    // A remap listener belongs to the Settings markup that started it. Cancel
    // it before any menu-to-menu transition (including mouse/controller Back)
    // so it cannot steal the next key on the destination screen.
    this._captureCleanup?.();
    this._captureCleanup = null;
    this.sheet.innerHTML = html;
    this.root.inert = false;
    this.root.setAttribute('aria-hidden', 'false');
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
    this._applyAccessibilitySettings();
    requestAnimationFrame(() => {
      if (!this.root.classList.contains('on') || this.current !== name) return;
      if (!this.root.contains(document.activeElement)) this._focusables()[0]?.focus();
    });
  }

  hideAll() {
    const active = document.activeElement;
    if (active && this.root.contains(active)) active.blur?.();
    // Loading text replaces the control that started a run, which can leave
    // focus on <body> before this method runs. Whenever an overlay closes into
    // live play, explicitly hand focus to the gameplay surface regardless of
    // where the replaced control left it.
    if (this.game.state === 'playing') {
      this.game.canvas?.focus?.({ preventScroll: true });
    }
    this.root.inert = true;
    this.root.setAttribute('aria-hidden', 'true');
    this.root.classList.remove('on');
    this.current = null;
    this.onBack = null;
    this.backBtn.classList.remove('show');
    this._captureCleanup?.();
    this._captureCleanup = null;
    // Detach the draft's number-key shortcuts, or they stay live in-game.
    this._keyHandler?.();
    this._keyHandler = null;
  }

  _handleOverlayBackKey(event) {
    if (event.code !== 'Escape') return false;
    if (!this.root.classList.contains('on') || !this.onBack) return false;
    // Menus registers before Game's global pause shortcut. Stop the same
    // keydown from also reaching that listener when Settings was opened
    // from a paused run, or Escape would both go back and resume the game.
    event.stopImmediatePropagation();
    this.game.audio.play('ui');
    this.onBack();
    return true;
  }

  _click(sel, fn) {
    this.sheet.querySelectorAll(sel).forEach((el) => {
      el.classList.add('clickable');
      if (!el.matches('button, input, select, textarea, a[href]')) {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.textContent.replace(/\s+/g, ' ').trim());
      }
      el.addEventListener('click', (e) => {
        this.game.audio.play('ui');
        fn(el, e);
      });
      el.addEventListener('keydown', (e) => {
        if (el.matches('button, input, select, textarea, a[href]')) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        el.click();
      });
      el.addEventListener('mouseenter', () => this.game.audio.play('ui', { volume: 0.25, rate: 1.6 }));
    });
  }

  _applyAccessibilitySettings() {
    const s = this.game.save.settings;
    const scale = Math.max(0.9, Math.min(1.3, Number(s.textScale) || 1));
    this.game.uiRoot.style.setProperty('--ui-text-scale', String(scale));
    document.documentElement.classList.toggle('reduce-motion', !!s.reducedMotion);
    document.documentElement.classList.toggle('color-labels', !!s.colorLabels);
    this.game.render.setReducedMotion?.(!!s.reducedMotion);
    this.game.camera.setReducedMotion?.(!!s.reducedMotion);
    if (this.game.applyCameraSettings) this.game.applyCameraSettings();
    else this.game.camera.setInvertY?.(!!s.invertCameraY);
  }

  _focusables() {
    return [...this.root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')]
      .filter((el) => el.offsetParent !== null && !el.closest('.locked'));
  }

  _moveFocus(direction) {
    const els = this._focusables();
    if (!els.length) return;
    const active = this.root.contains(document.activeElement) ? document.activeElement : null;
    if (!active || !els.includes(active)) { els[0].focus(); return; }
    const from = active.getBoundingClientRect();
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    let best = null, score = Infinity;
    for (const el of els) {
      if (el === active) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - fx, dy = r.top + r.height / 2 - fy;
      if (direction === 'left' && dx >= -2) continue;
      if (direction === 'right' && dx <= 2) continue;
      if (direction === 'up' && dy >= -2) continue;
      if (direction === 'down' && dy <= 2) continue;
      const primary = (direction === 'left' || direction === 'right') ? Math.abs(dx) : Math.abs(dy);
      const cross = (direction === 'left' || direction === 'right') ? Math.abs(dy) : Math.abs(dx);
      const nextScore = primary + cross * 2.4;
      if (nextScore < score) { score = nextScore; best = el; }
    }
    if (!best) {
      const i = els.indexOf(active);
      best = els[(i + (direction === 'left' || direction === 'up' ? -1 : 1) + els.length) % els.length];
    }
    this.root.querySelectorAll('.controller-focus').forEach((el) => el.classList.remove('controller-focus'));
    best.classList.add('controller-focus');
    best.focus({ preventScroll: false });
  }

  _onControllerCommand(command) {
    if (!this.root.classList.contains('on') || !command) return;
    if (['up', 'down', 'left', 'right'].includes(command)) {
      const active = document.activeElement;
      if ((command === 'left' || command === 'right') && active?.matches('input[type="range"]')) {
        const step = Number(active.step) || 0.05;
        const sign = command === 'left' ? -1 : 1;
        active.value = String(Math.max(Number(active.min), Math.min(Number(active.max), Number(active.value) + step * sign)));
        active.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (active?.matches('select') && stepSelect(active, command)) {
        // Select changes are announced through the same event as mouse input.
      } else this._moveFocus(command);
      return;
    }
    if (command === 'activate') {
      this.game.input.suppressGamepadAction('dash');
      const active = this.root.contains(document.activeElement) ? document.activeElement : this._focusables()[0];
      active?.click?.();
      return;
    }
    if (command === 'back') {
      this.game.input.suppressGamepadAction('mop');
      if (this.onBack) this.onBack();
      else if (this.current === 'pause') this.game.resume();
      return;
    }
    if (command === 'start' && this.current === 'pause') {
      this.game.input.suppressGamepadAction('pause');
      this.game.resume();
    }
  }

  // --- main menu ------------------------------------------------------------

  showMain() {
    const s = this.game.save;
    const next = s.nextUnlock();
    const daily = dailySeedInfo();
    this._show(`
      <div class="title-block">
        <div class="kicker">SUNNYDALE, CALIFORNIA · 1999</div>
        <h1>BUFFY<br><span style="font-size:.62em">CEMETERY PATROL</span></h1>
        <div class="sub">Into every generation, a Slayer is born.</div>
      </div>
      <div class="rule"></div>
      <div class="menu-actions">
        <button class="btn primary" data-a="play">BEGIN PATROL</button>
        <button class="btn daily" data-a="daily">🌙 DAILY PATROL<small>${daily.label} · SAME CEMETERY FOR EVERYONE</small></button>
        <button class="btn" data-a="seed">PLAY A SEED<small>REPLAY A COPIED FLOOR OR SHARE ONE WITH A FRIEND</small></button>
        <button class="btn" data-a="levels">CHOOSE A LOCATION<small>${s.unlockedThemes().length} of ${THEME_ORDER.length} unlocked</small></button>
        <button class="btn" data-a="shop">SLAYER TRAINING<small>${s.cards} watcher tokens to spend</small></button>
        <button class="btn ghost" data-a="settings">SETTINGS</button>
      </div>
      <div class="stats-strip">
        <div class="stat"><div class="v">${s.data.runs}</div><div class="k">PATROLS</div></div>
        <div class="stat"><div class="v">${s.data.wins}</div><div class="k">SURVIVED</div></div>
        <div class="stat"><div class="v">${s.data.bestScore.toLocaleString()}</div><div class="k">BEST SCORE</div></div>
        <div class="stat"><div class="v">${Math.floor(s.lifetimeXP).toLocaleString()}</div><div class="k">LIFETIME XP</div></div>
      </div>
      ${next ? `<div class="unlock-note">${next.theme.icon} <b>${next.theme.name}</b> unlocks in ${next.remainingText ?? `${Math.ceil(next.remaining).toLocaleString()} more lifetime XP`}</div>` : ''}
      <div class="hint-row">${randomTip(this.game)}</div>
    `, 'main');

    this._click('[data-a]', (el) => {
      const a = el.dataset.a;
      if (a === 'play') this.showCharacterSelect('cemetery');
      if (a === 'daily') this.showLevels(capturedDailyRunOptions(daily));
      if (a === 'seed') this.showSeedSetup();
      if (a === 'levels') this.showLevels();
      if (a === 'shop') this.showShop();
      if (a === 'settings') this.showSettings(null, 'main');
    });
  }

  showSeedSetup(initial = {}) {
    const themes = this.game.save.unlockedThemes();
    const selected = themes.includes(initial.themeId) ? initial.themeId : themes[0];
    this._show(`
      <div class="section-title">PLAY A SEED</div>
      <div class="section-sub">RECREATE THE SAME FLOOR AND SEEDED OFFER STREAM WITH THE SAME PROFILE AND CHOICES</div>
      <div class="seed-setup">
        <label for="seed-value">SEED CODE</label>
        <input id="seed-value" type="text" maxlength="160" autocomplete="off" spellcheck="false" value="${escapeAttr(initial.seed || '')}" placeholder="Paste or type a seed">
        <label for="seed-theme">BRANCH</label>
        <select id="seed-theme">
          ${themes.map((id) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${THEMES[id].icon} ${THEMES[id].name}</option>`).join('')}
        </select>
        <div class="seed-error" role="alert"></div>
        <button class="btn primary" data-a="continue-seed">CHOOSE A LIBRARIAN</button>
      </div>
    `, 'seed', () => this.showMain());

    const input = this.sheet.querySelector('#seed-value');
    const submit = () => {
      const seed = input.value.trim();
      if (!seed) {
        this.sheet.querySelector('.seed-error').textContent = 'Enter a seed code first.';
        input.focus();
        return;
      }
      const themeId = this.sheet.querySelector('#seed-theme').value;
      this.showCharacterSelect(themeId, { seed, fromSeed: true });
    };
    this._click('[data-a="continue-seed"]', submit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    });
  }

  showLevels(runOptions = {}) {
    const s = this.game.save;
    const challengeDay = runOptions.challenge === 'daily' ? (runOptions.dailyDay || dailyId()) : null;
    const resolvedRunOptions = challengeDay ? { ...runOptions, dailyDay: challengeDay } : runOptions;
    const cards = THEME_ORDER.map((id) => {
      const t = THEMES[id];
      const unlocked = s.isThemeUnlocked(id);
      const dailyRecord = runOptions.challenge === 'daily' ? s.data.dailyBests?.[`${challengeDay}/${id}`] : null;
      const best = runOptions.challenge === 'daily' ? (dailyRecord?.score || 0) : (s.data.bestByTheme[id] || 0);
      return `
        <div class="level-card ${unlocked ? '' : 'locked'}" data-theme="${id}">
          <div class="ico">${t.icon}</div>
          <h3>${t.name}</h3>
          <p>${t.blurb}</p>
          <div class="best">${best ? `${dailyRecord ? 'DAY BEST' : 'BEST'} ${best.toLocaleString()}${dailyRecord ? ` · ${dailyRecord.attempts} ATTEMPT${dailyRecord.attempts === 1 ? '' : 'S'}` : ''}` : runOptions.challenge === 'daily' ? 'NO DAILY ATTEMPT YET' : 'NOT YET PLAYED'}</div>
          ${unlocked ? '' : `<div class="lock">🔒 ${t.xpToUnlock.toLocaleString()} XP${Number.isFinite(t.winsToUnlock) ? ` OR ${t.winsToUnlock} WINS` : ''}</div>`}
        </div>`;
    }).join('');

    this._show(`
      <div class="section-title">${runOptions.challenge === 'daily' ? `📅 DAILY SHIFT ${challengeDay} — CHOOSE A BRANCH` : 'CHOOSE A BRANCH'}</div>
      <div class="section-sub">${runOptions.challenge === 'daily' ? `SHARED ${challengeDay} FLOOR AND LOCAL DAY BEST PER BRANCH` : 'EVERY VISIT GENERATES A COMPLETELY NEW FLOOR PLAN'}</div>
      <div class="levels">${cards}</div>
    `, 'levels', () => resolvedRunOptions.fromResults ? this._returnToMain() : this.showMain());

    this._click('.level-card:not(.locked)', (el) => {
      const themeId = el.dataset.theme;
      this.showCharacterSelect(themeId, dailyRunOptionsForTheme(resolvedRunOptions, themeId));
    });
  }

  showCharacterSelect(themeId, runOptions = {}) {
    const last = this.game.save.data.lastCharacter;
    const theme = THEMES[themeId];
    const availableCharacters = themeId === 'cemetery'
      ? CHARACTER_LIST.filter((ch) => ch.id === 'buffy')
      : CHARACTER_LIST.filter((ch) => ch.id !== 'buffy');
    const cards = availableCharacters.map((ch) => `
      <div class="char-card ${ch.id === last ? 'last' : ''}" data-char="${ch.id}">
        ${ch.id === last ? '<div class="last-tag">LAST PLAYED</div>' : ''}
        <div class="char-stage"><canvas data-portrait="${ch.id}"></canvas></div>
        <h3>${ch.name}</h3>
        <div class="char-role">${ch.icon} ${ch.title}</div>
        <p>${ch.blurb}</p>
        <div class="char-trait">${ch.trait || 'Ready for patrol.'}</div>
        <div class="swatches">${ch.swatch.map((c) => `<i style="background:${c}"></i>`).join('')}</div>
      </div>`).join('');

    this._show(`
      <div class="section-title">WHO IS ON PATROL?</div>
      <div class="section-sub">${theme.icon} ${theme.name.toUpperCase()}${runOptions.challenge === 'daily' ? ' &nbsp;·&nbsp; 📅 DAILY CHALLENGE' : ''}</div>
      <div class="chars">${cards}</div>
    `, 'character', () => {
      if (runOptions.challenge === 'daily') this.showLevels(runOptions);
      else if (runOptions.fromSeed) this.showSeedSetup({ seed: runOptions.seed, themeId });
      else if (runOptions.fromResults) this._returnToMain();
      else this.showMain();
    });

    this._renderPortraits();
    this._click('.char-card', (el) => {
      this.game.audio.play('uiBig');
      this.game.startRun({ themeId, ...runOptions, characterId: el.dataset.char });
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
      const copy = metaPresentation(def, this.game.theme?.id || 'cemetery');
      const lvl = s.metaLevel(def.id);
      const maxed = lvl >= def.max;
      const cost = maxed ? 0 : metaCost(def, lvl);
      const afford = !maxed && s.cards >= cost;
      const pips = Array.from({ length: def.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      return `
        <div class="shop-item ${afford ? 'buyable' : ''}" data-id="${def.id}">
          <div class="head"><span class="ico">${copy.icon}</span><h4>${copy.name}</h4></div>
          <p>${copy.desc(Math.min(def.max, lvl + 1))}</p>
          <div class="foot">
            <span class="pips">${pips}</span>
            <span class="price ${maxed ? 'max' : afford ? '' : 'cant'}">${maxed ? 'MAXED' : `${cost} 🎟`}</span>
          </div>
        </div>`;
    }).join('');

    this._show(`
      <div class="section-title">SLAYER TRAINING</div>
      <div class="section-sub">PERMANENT PERKS — THEY CARRY INTO EVERY FUTURE PATROL</div>
      <div class="wallet">🎟 ${s.cards} WATCHER TOKENS</div>
      <div class="shop">${items}</div>
    `, 'shop', () => {
      this._returnToMain();
    });

    this._click('.shop-item.buyable', (el) => {
      if (this.game.save.buyMeta(el.dataset.id)) {
        this.game.audio.play('powerup');
        this.showShop();
      } else {
        this.game.audio.play('error');
      }
    });
  }

  showSettings(focusSelector = null, returnScreen = null) {
    // Rerenders and nested Settings screens must retain their original route.
    // In particular, a paused run stays paused while changing options and Back
    // returns to the pause sheet rather than dropping into the main menu.
    if (returnScreen === 'pause' || returnScreen === 'main') {
      this._settingsReturnScreen = returnScreen;
    } else if (this.current !== 'settings' && this.current !== 'playtest-history') {
      this._settingsReturnScreen = this.current === 'pause' ? 'pause' : 'main';
    }
    const s = this.game.save.settings;
    const q = this.game.render.quality;
    const settingsMessage = this._settingsMessage;
    this._settingsMessage = '';
    const bindings = REMAP_ACTIONS.map(([action, label]) => `
      <div class="binding-row">
        <label>${label}</label>
        <button type="button" class="binding-button" data-bind="${action}" aria-label="Change ${label} key">${formatKeyCode(this.game.input.bindingFor(action))}</button>
      </div>`).join('');
    this._show(`
      <div class="section-title">SETTINGS</div>
      ${this._settingsReturnScreen === 'pause' ? '<div class="section-sub settings-paused-note">SHIFT REMAINS PAUSED</div>' : ''}
      ${settingsMessage ? `<div class="settings-notice" role="status">${settingsMessage}</div>` : ''}
      <div style="max-width:720px;margin:0 auto">
        <div class="settings-group-title">DISPLAY &amp; AUDIO</div>
        <div class="settings-row">
          <label>GRAPHICS</label>
          <div class="seg" data-seg="quality">
            ${Object.values(QUALITY).map((v) => `<button data-v="${v}" class="${v === q ? 'on' : ''}" aria-pressed="${v === q}">${v.toUpperCase()}</button>`).join('')}
          </div>
        </div>
        <div class="settings-row"><label>MASTER VOLUME</label><input aria-label="Master volume" type="range" min="0" max="1" step="0.05" value="${s.master}" data-set="master"></div>
        <div class="settings-row"><label>MUSIC</label><input aria-label="Music volume" type="range" min="0" max="1" step="0.05" value="${s.music}" data-set="music"></div>
        <div class="settings-row"><label>SOUND EFFECTS</label><input aria-label="Sound effects volume" type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-set="sfx"></div>

        <div class="settings-group-title">CAMERA</div>
        <div class="settings-row">
          <span><label>INVERT VERTICAL DRAG</label><div class="settings-copy">Reverses up and down while left-dragging to orbit the camera.</div></span>
          ${boolSegment('invertCameraY', !!s.invertCameraY)}
        </div>

        <div class="settings-group-title">ACCESSIBILITY &amp; GUIDANCE</div>
        <div class="settings-row">
          <span><label>TUTORIALS</label><div class="settings-copy">Show first-shift training and first-time event briefs.</div></span>
          ${boolSegment('tutorials', s.tutorials !== false)}
        </div>
        <div class="settings-row">
          <span><label>RESTART TUTORIALS</label><div class="settings-copy">Makes the guided shift and every event brief available again.</div></span>
          <button class="btn ghost" data-a="reset-tutorials" style="padding:8px 16px;font-size:calc(11px * var(--ui-text-scale))">RESET TUTORIAL STATE</button>
        </div>
        <div class="settings-row">
          <span><label>COLOR LABELS &amp; SHAPES</label><div class="settings-copy">Adds initials to carried items and distinct shapes on the map.</div></span>
          ${boolSegment('colorLabels', !!s.colorLabels)}
        </div>
        <div class="settings-row">
          <span><label>REDUCED MOTION</label><div class="settings-copy">Minimizes interface motion, camera shake, and distortion.</div></span>
          ${boolSegment('reducedMotion', !!s.reducedMotion)}
        </div>
        <div class="settings-row">
          <label>UI TEXT SIZE</label>
          <div class="seg" data-seg="textScale">
            ${[[1, '100%'], [1.15, '115%'], [1.3, '130%']].map(([v, label]) => {
              const selected = Math.abs((Number(s.textScale) || 1) - v) < 0.01;
              return `<button data-v="${v}" class="${selected ? 'on' : ''}" aria-pressed="${selected}">${label}</button>`;
            }).join('')}
          </div>
        </div>

        <div class="settings-group-title">KEYBOARD CONTROLS</div>
        <div class="bindings">${bindings}</div>
        <div class="settings-row">
          <span><label>DEFAULT CONTROLS</label><div class="settings-copy">Arrow keys and controller navigation always remain available.</div></span>
          <button class="btn ghost" data-a="reset-controls" style="padding:8px 16px;font-size:calc(11px * var(--ui-text-scale))">RESET KEYS</button>
        </div>

        <div class="settings-group-title">SAVE DATA</div>
        <div class="settings-row">
          <span><label>LOCAL PLAYTEST HISTORY</label><div class="settings-copy">Compare up to 20 run summaries or copy the full samples as JSON.</div></span>
          <button class="btn ghost" data-a="playtest-history" style="padding:8px 16px;font-size:calc(11px * var(--ui-text-scale))">VIEW HISTORY</button>
        </div>
        <div class="settings-row">
          <label>ERASE ALL PROGRESS</label>
          <button class="btn ghost" data-a="wipe" style="padding:8px 16px;font-size:calc(11px * var(--ui-text-scale))">RESET SAVE</button>
        </div>
      </div>
    `, 'settings', () => this._returnFromSettings());
    this._focusAfterRender(focusSelector, 'settings');

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
      this.showSettings(`[data-seg="quality"] [data-v="${el.dataset.v}"]`);
    });
    this._click('[data-setting-bool] button', (el) => {
      const k = el.closest('[data-setting-bool]').dataset.settingBool;
      const v = el.dataset.v === 'true';
      this._applyBooleanSetting(k, v);
      this.showSettings(`[data-setting-bool="${k}"] [data-v="${v}"]`);
    });
    this._click('[data-seg="textScale"] button', (el) => {
      this.game.save.setSetting('textScale', Number(el.dataset.v));
      this._applyAccessibilitySettings();
      this.showSettings(`[data-seg="textScale"] [data-v="${el.dataset.v}"]`);
    });
    this._click('[data-a="reset-tutorials"]', () => {
      this.game.save.resetTutorials();
      this._settingsMessage = '✓ Tutorial state reset. Your next regular shift will include training.';
      this.showSettings('[data-a="reset-tutorials"]');
    });
    this._click('[data-bind]', (el) => this._captureBinding(el));
    this._click('[data-a="reset-controls"]', () => {
      this.game.save.setSetting('keyBindings', {});
      this.game.input.setBindings({});
      this._settingsMessage = '✓ Keyboard controls restored to defaults.';
      this.showSettings('[data-a="reset-controls"]');
    });
    this._click('[data-a="playtest-history"]', () => this.showPlaytestHistory());
    this._click('[data-a="wipe"]', () => this._resetSave());
  }

  _applyBooleanSetting(key, value) {
    this.game.save.setSetting(key, value);
    this._applyAccessibilitySettings();
  }

  _returnFromSettings() {
    const canReturnToPause = this._settingsReturnScreen === 'pause'
      && this.game.state === 'paused'
      && this.game.run
      && this.game.progression;
    if (canReturnToPause) this.showPause();
    else this.showMain();
  }

  _resetSave() {
    if (!window.confirm('Erase all progression, records, settings, and tutorial history? This cannot be undone.')) return false;
    this.game.save.reset();
    clearPlaytestHistory();
    const s = this.game.save.settings;
    this.game.input.setBindings(s.keyBindings || {});
    this.game.render.setQuality(s.quality || autoDetectQuality());
    this.game.audio.setVolume(s.master);
    this.game.audio.setMusicVolume(s.music);
    this.game.audio.setSfxVolume(s.sfx);
    this._applyAccessibilitySettings();
    this.game.audio.play('error');
    this._returnFromSettings();
    return true;
  }

  showPlaytestHistory() {
    const value = getPlaytestHistory();
    const history = Array.isArray(value) ? value : [];
    const rows = history.map((run, index) => {
      const branch = THEMES[run.theme]?.name ?? run.theme ?? 'Unknown branch';
      const date = Number.isNaN(Date.parse(run.at)) ? 'UNKNOWN DATE' : new Date(run.at).toLocaleString();
      const result = run.won ? 'SURVIVED' : String(run.reason || 'ended').toUpperCase();
      const metersPerFile = Number.isFinite(Number(run.metersPerFile))
        ? Number(run.metersPerFile).toFixed(1)
        : '—';
      const build = Array.isArray(run.upgradeChoices) && run.upgradeChoices.length
        ? run.upgradeChoices.map((choice) => `${UPGRADES[choice.id]?.name ?? choice.id} ${choice.level ?? ''}`).join(' · ')
        : 'No upgrades recorded';
      return `
        <details class="playtest-run" ${index === 0 ? 'open' : ''}>
          <summary>
            <span><b>${escapeHTML(branch)}</b><small>${escapeHTML(date)} · ${escapeHTML(result)}</small></span>
            <strong>${Math.round(Number(run.score) || 0).toLocaleString()}</strong>
          </summary>
          <div class="playtest-metrics">
            <span><b>${Number(run.shelved) || 0}</b> filed</span>
            <span><b>${Number(run.filesPerMinute) || 0}</b> / min</span>
            <span><b>${Number(run.peakChaos) || 0}%</b> peak chaos</span>
            <span><b>${Number(run.damageTaken) || 0}</b> damage</span>
            <span><b>${metersPerFile}</b> m / file</span>
            <span><b>${Number(run.pathFailures) || 0}</b> path failures</span>
            <span><b>${Number(run.trainingSeconds) || 0}s</b> training</span>
          </div>
          <div class="playtest-build">${escapeHTML(build)}</div>
          <div class="playtest-seed">${escapeHTML(String(run.seed ?? ''))}</div>
        </details>`;
    }).join('');

    this._show(`
      <div class="section-title">LOCAL PLAYTEST HISTORY</div>
      <div class="section-sub">${history.length} OF 20 STORED RUNS · NOTHING LEAVES THIS DEVICE UNLESS YOU COPY IT</div>
      <div class="playtest-history">${rows || '<div class="empty-history">Finish a shift to create the first local playtest record.</div>'}</div>
      <div class="menu-actions" style="margin-top:18px">
        <button class="btn" data-a="copy-history" ${history.length ? '' : 'disabled'}>COPY FULL JSON</button>
        <button class="btn ghost" data-a="clear-history" ${history.length ? '' : 'disabled'}>CLEAR HISTORY</button>
      </div>
    `, 'playtest-history', () => this.showSettings());

    this._click('[data-a="copy-history"]:not(:disabled)', (el) => {
      this._copyValue(JSON.stringify(history, null, 2), el, 'HISTORY COPIED');
    });
    this._click('[data-a="clear-history"]:not(:disabled)', () => {
      if (!window.confirm('Clear all local playtest history? This does not erase progression.')) return;
      clearPlaytestHistory();
      this.showPlaytestHistory();
    });
  }

  _captureBinding(el) {
    this._captureCleanup?.();
    const action = el.dataset.bind;
    const original = el.textContent;
    el.classList.add('listening');
    el.textContent = 'PRESS A KEY';

    let finishTimer = null;
    const finish = () => {
      if (finishTimer !== null) {
        clearTimeout(finishTimer);
        finishTimer = null;
      }
      window.removeEventListener('keydown', onKey, true);
      el.classList.remove('listening');
      if (el.isConnected) el.textContent = original;
      // A delayed callback from an older capture must not erase the cleanup
      // handle belonging to a newer PRESS A KEY session.
      if (this._captureCleanup === finish) this._captureCleanup = null;
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') { finish(); return; }
      if (['Tab', 'Backquote', 'F5', 'Escape', 'KeyM', 'KeyP', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        el.textContent = 'RESERVED';
        finishTimer = setTimeout(finish, 700);
        return;
      }
      const conflict = REMAP_ACTIONS.find(([other]) => other !== action && this.game.input.bindingFor(other) === e.code);
      if (conflict) {
        el.textContent = `USED: ${conflict[1]}`;
        finishTimer = setTimeout(finish, 900);
        return;
      }
      const custom = { ...(this.game.save.settings.keyBindings || {}) };
      if (DEFAULT_BINDINGS[action] === e.code) delete custom[action];
      else custom[action] = e.code;
      this.game.save.setSetting('keyBindings', custom);
      this.game.input.setBindings(custom);
      finish();
      this.showSettings(`[data-bind="${action}"]`);
    };
    window.addEventListener('keydown', onKey, true);
    this._captureCleanup = finish;
  }

  _focusAfterRender(selector, screen) {
    if (!selector) return;
    requestAnimationFrame(() => {
      if (this.current !== screen || !this.root.classList.contains('on')) return;
      // Let the browser scroll the newly rebuilt sheet so a restored control
      // below the fold remains visibly focused for keyboard/controller users.
      this.sheet.querySelector(selector)?.focus();
    });
  }

  showLoading(themeId = 'cemetery') {
    const copy = LOADING_COPY[themeId] || LOADING_COPY.library;
    this._show(`
      <div class="loading-inner">
        <div class="spinner"></div>
        <h2>${copy.lines[Math.floor(Math.random() * copy.lines.length)]}</h2>
        <p>${copy.subtitle}</p>
      </div>
    `, 'loading');
  }

  // --- level-up draft -------------------------------------------------------

  showLevelUp(options, level, rerolls) {
    const mustChoosePower = !!this.game.run?.tutorialActive && this.game.hud?.tutorial?.step === 'upgrade';
    const cards = options.map((u, i) => {
      const cur = this.game.progression.levels[u.id] || 0;
      const isNew = cur === 0;
      const powerControl = this.game.input.usingGamepad
        ? `BUTTON ${gamepadLabelFor(u.id)}`
        : `KEY ${formatKeyCode(this.game.input.bindingFor(u.id))}`;
      return `
        <div class="card ${u.kind === 'power' ? 'power' : ''}" data-id="${u.id}">
          <div class="kbd">${i + 1}</div>
          <div class="ico">${u.icon}</div>
          <h3>${u.name}</h3>
          <div class="tier">${isNew ? 'NEW' : `LEVEL ${cur} → ${cur + 1}`}${u.kind === 'power' ? ` · ${powerControl}` : ''}</div>
          <p>${u.desc(cur + 1)}</p>
        </div>`;
    }).join('');

    this._show(`
      <div class="title-block" style="margin-bottom:18px">
        <div class="kicker">PROMOTION</div>
        <h1 style="font-size:clamp(calc(30px * var(--ui-text-scale)),calc(5vw * var(--ui-text-scale)),calc(58px * var(--ui-text-scale)))">LEVEL ${level}</h1>
        <div class="sub" style="letter-spacing:.2em">PICK ONE</div>
      </div>
      ${mustChoosePower ? '<div class="tutorial-draft-hint">TRAINING STEP: CHOOSE ONE OF THE BLUE POWER CARDS</div>' : ''}
      <div class="draft">${cards}</div>
      ${rerolls > 0 && !mustChoosePower ? `<div class="menu-actions" style="margin-top:20px"><button class="btn ghost" data-a="reroll">🔄 REROLL (${rerolls} left)</button></div>` : ''}
    `, 'levelup');

    const choose = (id) => {
      if (mustChoosePower && !SIGNATURE_POWER_IDS.includes(id)) {
        this.game.audio.play('error');
        this.game.hud.toast('Choose a blue POWER card to complete training.');
        return;
      }
      this.game.progression.choose(id);
    };
    this._click('.card', (el) => choose(el.dataset.id));
    this._click('[data-a="reroll"]', () => this.game.progression.reroll());

    this._keyHandler?.();
    const onKey = (e) => {
      if (e.repeat) return;
      if (!this.game.progression.currentOffer) return;
      const n = Number(e.key);
      if (n >= 1 && n <= options.length) {
        e.preventDefault();
        choose(options[n - 1].id);
        return;
      }
      if (e.key.toLowerCase() === 'r' && rerolls > 0 && !mustChoosePower) {
        e.preventDefault();
        this.game.progression.reroll();
      }
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
      return `<span style="display:inline-block;margin:3px 5px;padding:5px 11px;border-radius:16px;background:rgba(232,182,76,.14);border:1px solid rgba(232,182,76,.3);font-size:calc(11.5px * var(--ui-text-scale));font-weight:700">${def?.icon ?? ''} ${def?.name ?? id} <b style="color:var(--gold)">${l}</b></span>`;
    }).join('') || '<span style="opacity:.5;font-size:calc(12px * var(--ui-text-scale))">Nothing drafted yet.</span>';

    this._show(`
      <div class="section-title">PAUSED</div>
      <div class="section-sub">${g.theme.name.toUpperCase()}${g.run.isDaily ? ' · 📅 DAILY SHIFT' : ''}</div>
      <div class="seed-row"><button class="seed-chip" data-copy-seed="${escapeAttr(String(g.seed))}" title="Copy full seed">SEED ${escapeHTML(String(g.seed))}</button></div>
      <div class="results-grid">
        <div class="result-stat"><div class="v">${g.theme.id === 'cemetery' ? g.run.vampiresSlain : g.run.shelved}</div><div class="k">${g.theme.id === 'cemetery' ? 'VAMPIRES SLAIN' : 'FILED'}</div></div>
        <div class="result-stat"><div class="v">${g.kids?.count ?? g.run.kidsCalmed}</div><div class="k">${g.theme.id === 'cemetery' ? 'ACTIVE THREATS' : 'CALMED'}</div></div>
        <div class="result-stat"><div class="v">${Math.floor(g.run.chaos)}%</div><div class="k">${g.theme.id === 'cemetery' ? 'HELLMOUTH' : 'CHAOS'}</div></div>
        <div class="result-stat"><div class="v">${p.level}</div><div class="k">LEVEL</div></div>
      </div>
      <div style="text-align:center;margin:16px 0">${owned}</div>
      <div class="rule"></div>
      <div class="menu-actions">
        <button class="btn primary" data-a="resume">RESUME</button>
        <button class="btn" data-a="settings">SETTINGS</button>
        <button class="btn ghost" data-a="quit">ABANDON PATROL</button>
      </div>
      <div class="hint-row">${randomTip(this.game)}</div>
    `, 'pause');

    this._click('[data-a="resume"]', () => this.game.resume());
    this._click('[data-a="settings"]', () => this.showSettings(null, 'pause'));
    this._click('[data-a="quit"]', () => this.game.endRun(false, 'quit'));
    this._click('[data-copy-seed]', (el) => this._copySeed(el));
  }

  // --- results --------------------------------------------------------------

  showResults(won, reason, r, xpGained) {
    const s = this.game.save;
    const REASONS = {
      chaos: 'Hellmouth Activity reached critical mass. Sunnydale is in serious trouble.',
      health: 'The vampires overwhelmed the Slayer before sunrise.',
      survived: 'Sunrise. The surviving vampires retreat and the cemetery falls quiet.',
      quit: 'The patrol ended early. The night is not getting any safer.',
    };
    const unlocked = s.lastUnlockedTheme ? THEMES[s.lastUnlockedTheme] : null;
    const telemetry = r.telemetry || {};
    const filesPerMinute = r.elapsed > 0 ? r.shelved / (r.elapsed / 60) : 0;
    const firstShelf = telemetry.first?.shelved;
    const damage = telemetry.damageTaken;

    this._show(`
      <div class="title-block">
        <div class="kicker">${won ? 'PATROL COMPLETE' : 'PATROL FAILED'}</div>
        <h1 style="font-size:clamp(calc(34px * var(--ui-text-scale)),calc(6vw * var(--ui-text-scale)),calc(76px * var(--ui-text-scale)))">${won ? 'SUNRISE' : 'HELLMOUTH RISING'}</h1>
        <div class="sub" style="font-style:normal;letter-spacing:.12em;font-size:calc(13px * var(--ui-text-scale));font-family:var(--ui);opacity:.7">${REASONS[reason] || ''}</div>
      </div>
      <div class="results-grid">
        <div class="result-stat"><div class="v">${r.score.toLocaleString()}</div><div class="k">SCORE</div></div>
        <div class="result-stat"><div class="v">${fmt(r.elapsed)}</div><div class="k">SURVIVED</div></div>
        <div class="result-stat"><div class="v">${r.vampiresSlain || 0}</div><div class="k">VAMPIRES SLAIN</div></div>
        <div class="result-stat"><div class="v">×${r.bestCombo}</div><div class="k">SLAY COMBO</div></div>
        <div class="result-stat"><div class="v">${r.bossesBeaten}</div><div class="k">BOSSES</div></div>
        <div class="result-stat"><div class="v">${r.disastersSurvived}</div><div class="k">DISASTERS</div></div>
        <div class="result-stat"><div class="v">×${r.bestCombo}</div><div class="k">BEST COMBO</div></div>
        <div class="result-stat"><div class="v">${Math.floor(r.peakChaos)}%</div><div class="k">PEAK HELLMOUTH</div></div>
      </div>
      <div class="unlock-note">
        ${r.unscoredTraining
          ? 'TRAINING ATTEMPT · NOT RECORDED OR REWARDED'
          : `+${Math.floor(xpGained).toLocaleString()} lifetime XP &nbsp;·&nbsp; +${s.lastCardsEarned} watcher tokens`}
      </div>
      ${unlocked ? `<div class="unlock-note" style="border-color:var(--gold)">🎉 NEW BRANCH UNLOCKED — ${unlocked.icon} <b>${unlocked.name}</b></div>` : ''}
      <div class="telemetry-panel">
        <div class="telemetry-head"><span>LOCAL PLAYTEST SUMMARY</span><small>STAYS ON THIS DEVICE</small></div>
        <div class="telemetry-grid">
          <div><b>${firstShelf === undefined ? '—' : `${firstShelf.toFixed(1)}s`}</b><span>FIRST FILE</span></div>
          <div><b>${filesPerMinute.toFixed(1)}</b><span>FILES / MIN</span></div>
          <div><b>${damage === undefined ? '—' : Math.round(damage)}</b><span>DAMAGE TAKEN</span></div>
          <div><b>${Math.floor(r.peakChaos)}%</b><span>PEAK CHAOS</span></div>
        </div>
      </div>
      <div class="seed-row"><button class="seed-chip" data-copy-seed="${escapeAttr(String(this.game.seed))}" title="Copy full seed">${r.isDaily ? '📅 DAILY · ' : ''}SEED ${escapeHTML(String(this.game.seed))}</button></div>
      <div class="rule"></div>
      <div class="menu-actions">
        <button class="btn primary" data-a="again">ANOTHER PATROL</button>
        <button class="btn" data-a="shop">SPEND ${s.cards} 🎟</button>
        <button class="btn ghost" data-a="menu">MAIN MENU</button>
      </div>
    `, 'results');

    this._click('[data-a="again"]', () => this.showCharacterSelect(
      this.game.theme.id,
      r.isDaily
        ? { seed: this.game.seed, seedTheme: this.game.theme.id, challenge: 'daily', dailyDay: r.dailyDay, fromResults: true }
        : { fromResults: true },
    ));
    this._click('[data-a="shop"]', () => this.showShop());
    this._click('[data-a="menu"]', () => {
      this.game.disposeRun();
      this.game.showMenu();
    });
    this._click('[data-copy-seed]', (el) => this._copySeed(el));
  }

  _returnToMain() {
    if (this.game.state === 'gameover' || this.game.state === 'victory') {
      this.game.disposeRun();
      this.game.showMenu();
      return;
    }
    this.showMain();
  }

  _copySeed(el) {
    const value = el.dataset.copySeed;
    return this._copyValue(value, el, 'SEED COPIED');
  }

  async _copyValue(value, el, successLabel) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed'; input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    const old = el.textContent;
    el.textContent = successLabel;
    setTimeout(() => { if (el.isConnected) el.textContent = old; }, 1200);
  }
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function stepSelect(select, direction) {
  if (!select || !['left', 'right', 'up', 'down'].includes(direction)) return false;
  const delta = direction === 'left' || direction === 'up' ? -1 : 1;
  const next = Math.max(0, Math.min(select.options.length - 1, select.selectedIndex + delta));
  if (next === select.selectedIndex) return false;
  select.selectedIndex = next;
  select.dispatchEvent(new Event('input', { bubbles: true }));
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

export function dailyRunOptionsForTheme(runOptions, themeId) {
  if (runOptions?.challenge !== 'daily') return runOptions;
  const dailyDay = runOptions.dailyDay || dailyId();
  return {
    ...runOptions,
    dailyDay,
    seedTheme: themeId,
    seed: dailySeedForDay(themeId, dailyDay),
  };
}

function dailySeedInfo(date = new Date()) {
  const id = dailyId(date);
  const display = new Date(`${id}T12:00:00.000Z`);
  return { id, label: display.toLocaleDateString(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase() };
}

export function capturedDailyRunOptions(daily) {
  return { challenge: 'daily', dailyDay: daily.id };
}

function boolSegment(setting, on) {
  return `<div class="seg" data-setting-bool="${setting}">
    <button data-v="true" class="${on ? 'on' : ''}" aria-pressed="${on}">ON</button>
    <button data-v="false" class="${!on ? 'on' : ''}" aria-pressed="${!on}">OFF</button>
  </div>`;
}

function escapeAttr(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeHTML(value) { return escapeAttr(value); }

export function formatTip(tip, game) {
  const label = (action) => game.input.usingGamepad
    ? gamepadLabelFor(action)
    : formatKeyCode(game.input.bindingFor(action));
  const movement = game.input.usingGamepad
    ? 'LEFT STICK'
    : ['up', 'left', 'down', 'right'].map((a) => formatKeyCode(game.input.bindingFor(a))).join('');
  return tip
    .replace('<b>WASD</b>', `<b>${movement}</b>`)
    .replace('<b>Shift</b>', `<b>${label('sprint')}</b>`)
    .replace('<b>Space</b>', `<b>${label('dash')}</b>`)
    .replace('<b>Q</b>', `<b>${label('gravityGun')}</b>`)
    .replace('<b>E</b>', `<b>${label('bookerang')}</b>`)
    .replace('<b>F</b>', `<b>${label('colorPulse')}</b>`)
    .replace('<b>R</b>', `<b>${label('mop')}</b>`);
}

function randomTip(game) {
  return formatTip(TIPS[Math.floor(Math.random() * TIPS.length)], game);
}
