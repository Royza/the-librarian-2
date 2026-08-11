import { META, META_LIST, metaCost } from '../data/meta.js';
import { THEMES, THEME_ORDER } from '../data/themes.js';

const KEY = 'librarian2.save.v1';
const SETTINGS_REVISION = 2;

// These identifiers shipped before the UI standardized on American English.
// Keep the one-way aliases here so existing purchases survive the spelling
// change, while every current definition and newly written save uses the new ID.
const LEGACY_META_IDS = Object.freeze({
  beamLicence: 'beamLicense',
  boomerangLicence: 'boomerangLicense',
  colourTheory: 'colorTheory',
});

const DEFAULT = {
  settingsRevision: SETTINGS_REVISION,
  lifetimeXP: 0,
  cards: 0,
  runs: 0,
  wins: 0,
  bestScore: 0,
  bestByTheme: {},
  dailyBests: {},
  meta: {},
  settings: {
    quality: null,
    music: 0.5,
    sfx: 0.85,
    master: 0.8,
    tutorials: true,
    colorLabels: false,
    reducedMotion: false,
    invertCameraY: true,
    textScale: 1,
    keyBindings: {},
  },
  tutorial: { introComplete: false, seen: {} },
  lastCharacter: 'marion',
  seen: {},
};

const freshDefault = () => JSON.parse(JSON.stringify(DEFAULT));

/** localStorage-backed profile: unlocks, meta upgrades, settings, records. */
export class SaveData {
  constructor() {
    this.data = freshDefault();
    this.lastCardsEarned = 0;
    this.lastUnlockedTheme = null;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const priorSettingsRevision = Number(parsed.settingsRevision) || 0;
        const meta = migrateMetaIds(parsed.meta);
        this.data = {
          ...freshDefault(),
          ...parsed,
          bestByTheme: { ...DEFAULT.bestByTheme, ...(parsed.bestByTheme || {}) },
          dailyBests: { ...DEFAULT.dailyBests, ...(parsed.dailyBests || {}) },
          meta: { ...DEFAULT.meta, ...meta },
          settings: {
            ...DEFAULT.settings,
            ...(parsed.settings || {}),
            keyBindings: {
              ...DEFAULT.settings.keyBindings,
              ...(parsed.settings?.keyBindings || {}),
            },
          },
          tutorial: {
            ...DEFAULT.tutorial,
            ...(parsed.tutorial || {}),
            seen: { ...DEFAULT.tutorial.seen, ...(parsed.tutorial?.seen || {}) },
          },
          seen: { ...DEFAULT.seen, ...(parsed.seen || {}) },
        };
        // Revision 2 changed the vertical camera default from standard to
        // inverted. Older profiles serialized the old `false` even when the
        // player never made a choice, so adopt the new default exactly once.
        // Any setting saved after this migration keeps revision 2 and is
        // therefore respected on every subsequent load.
        if (priorSettingsRevision < SETTINGS_REVISION) {
          this.data.settings.invertCameraY = true;
          this.data.settingsRevision = SETTINGS_REVISION;
          this.save();
        }
      }
    } catch { /* corrupt save — start fresh rather than hard-fail */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  }

  reset() {
    this.data = freshDefault();
    this.lastCardsEarned = 0;
    this.lastUnlockedTheme = null;
    this.save();
  }

  get lifetimeXP() { return this.data.lifetimeXP; }
  get cards() { return this.data.cards; }

  metaLevel(id) { return this.data.meta[id] || 0; }

  canAfford(id) {
    const def = META[id];
    const l = this.metaLevel(id);
    if (!def || l >= def.max) return false;
    return this.data.cards >= metaCost(def, l);
  }

  buyMeta(id) {
    const def = META[id];
    const l = this.metaLevel(id);
    if (!def || l >= def.max) return false;
    const cost = metaCost(def, l);
    if (this.data.cards < cost) return false;
    this.data.cards -= cost;
    this.data.meta[id] = l + 1;
    this.save();
    return true;
  }

  /** Push every purchased perk into a fresh run. */
  applyMeta(player, progression) {
    player.setMetaLevels(this.data.meta);
    for (const def of META_LIST) {
      const l = this.metaLevel(def.id);
      if (l > 0) def.apply?.(player, l, progression);
    }
    // Side-effect perks (starting powers, rerolls, etc.) run above; one final
    // rebuild mirrors derived disaster stats after every permanent level is set.
    player.refreshDerivedStats();
    player.health = player.stats.maxHealth;
    player.stamina = player.stats.maxStamina;
  }

  isThemeUnlocked(id) {
    const theme = THEMES[id];
    if (!theme) return false;
    return this.data.lifetimeXP >= theme.xpToUnlock || this.data.wins >= (theme.winsToUnlock ?? Infinity);
  }

  unlockedThemes() {
    return THEME_ORDER.filter((id) => this.isThemeUnlocked(id));
  }

  nextUnlock() {
    for (const id of THEME_ORDER) {
      if (this.isThemeUnlocked(id)) continue;
      const theme = THEMES[id];
      const xpRemaining = Math.max(0, theme.xpToUnlock - this.data.lifetimeXP);
      const winsRemaining = Math.max(0, (theme.winsToUnlock ?? Infinity) - this.data.wins);
      const xpProgress = theme.xpToUnlock > 0 ? this.data.lifetimeXP / theme.xpToUnlock : 1;
      const winProgress = Number.isFinite(winsRemaining) && theme.winsToUnlock > 0
        ? this.data.wins / theme.winsToUnlock
        : -1;
      const route = winProgress >= xpProgress ? 'wins' : 'xp';
      return {
        theme,
        // `remaining` remains as a compatibility alias for existing XP copy.
        remaining: xpRemaining,
        xpRemaining,
        winsRemaining,
        route,
        remainingText: route === 'wins'
          ? `${winsRemaining} more win${winsRemaining === 1 ? '' : 's'}`
          : `${Math.ceil(xpRemaining).toLocaleString()} more lifetime XP`,
      };
    }
    return null;
  }

  addLifetime(xp, score, themeId, won, cardMultiplier = 1) {
    const before = this.unlockedThemes().length;
    this.data.lifetimeXP += xp;
    // Cards are the meta currency; roughly one per 40 XP, plus a win bonus.
    const baseCards = Math.round(xp / 40) + (won ? 25 : 0);
    const payoutMultiplier = Math.max(0, Number(cardMultiplier) || 1);
    const cards = Math.round(baseCards * payoutMultiplier);
    this.data.cards += cards;
    this.data.runs++;
    if (won) this.data.wins++;
    this.data.bestScore = Math.max(this.data.bestScore, score);
    const b = this.data.bestByTheme[themeId] || 0;
    this.data.bestByTheme[themeId] = Math.max(b, score);
    this.save();
    const after = this.unlockedThemes().length;
    this.lastCardsEarned = cards;
    this.lastUnlockedTheme = after > before ? THEME_ORDER[after - 1] : null;
    return cards;
  }

  /** Keep the best local result for one calendar day and branch. */
  recordDaily(day, themeId, score, won) {
    const key = `${day}/${themeId}`;
    const previous = this.data.dailyBests[key] || { score: 0, won: false, attempts: 0 };
    const record = {
      day,
      themeId,
      score: Math.max(previous.score || 0, Math.round(Number(score) || 0)),
      won: !!previous.won || !!won,
      attempts: (previous.attempts || 0) + 1,
    };
    this.data.dailyBests[key] = record;
    this.save();
    return record;
  }

  setLastCharacter(id) {
    if (this.data.lastCharacter === id) return;
    this.data.lastCharacter = id;
    this.save();
  }

  get settings() { return this.data.settings; }
  setSetting(k, v) { this.data.settings[k] = v; this.save(); }

  get tutorialsEnabled() { return this.data.settings.tutorials !== false; }
  shouldShowIntroTutorial() { return this.tutorialsEnabled && !this.data.tutorial.introComplete; }

  beginIntroTutorial() {
    this.data.tutorial.introComplete = true;
    this.save();
  }

  hasSeenTutorial(id) { return !!this.data.tutorial.seen[id]; }

  markTutorialSeen(id) {
    if (this.data.tutorial.seen[id]) return;
    this.data.tutorial.seen[id] = true;
    this.save();
  }

  resetTutorials() {
    this.data.tutorial = { introComplete: false, seen: {} };
    this.data.settings.tutorials = true;
    this.save();
  }
}

function migrateMetaIds(source = {}) {
  const meta = { ...source };
  for (const [legacyId, currentId] of Object.entries(LEGACY_META_IDS)) {
    if (meta[legacyId] != null) {
      meta[currentId] = Math.max(Number(meta[currentId]) || 0, Number(meta[legacyId]) || 0);
      delete meta[legacyId];
    }
  }
  return meta;
}
