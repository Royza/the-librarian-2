import { META, META_LIST, metaCost } from '../data/meta.js';
import { THEMES, THEME_ORDER } from '../data/themes.js';

const KEY = 'librarian2.save.v1';

const DEFAULT = {
  lifetimeXP: 0,
  cards: 0,
  runs: 0,
  wins: 0,
  bestScore: 0,
  bestByTheme: {},
  meta: {},
  settings: { quality: null, music: 0.5, sfx: 0.85, master: 0.8 },
  lastCharacter: 'marion',
  seen: {},
};

/** localStorage-backed profile: unlocks, meta upgrades, settings, records. */
export class SaveData {
  constructor() {
    this.data = { ...DEFAULT };
    this.load();
    this.cardMultiplierHint = 1;
  }

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.data = { ...DEFAULT, ...parsed, settings: { ...DEFAULT.settings, ...(parsed.settings || {}) } };
      }
    } catch { /* corrupt save — start fresh rather than hard-fail */ }
  }

  save() {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* private mode */ }
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(DEFAULT));
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
    player.metaBonus = { carry: 0 };
    for (const def of META_LIST) {
      const l = this.metaLevel(def.id);
      if (l > 0) def.apply(player, l, progression);
    }
    if (this.metaLevel('tenure') > 0) player.metaBonus.carry = 2 * this.metaLevel('tenure');
    player.health = player.stats.maxHealth;
    player.stamina = player.stats.maxStamina;
  }

  unlockedThemes() {
    return THEME_ORDER.filter((id) => this.data.lifetimeXP >= THEMES[id].xpToUnlock);
  }

  nextUnlock() {
    for (const id of THEME_ORDER) {
      if (this.data.lifetimeXP < THEMES[id].xpToUnlock) {
        return { theme: THEMES[id], remaining: THEMES[id].xpToUnlock - this.data.lifetimeXP };
      }
    }
    return null;
  }

  addLifetime(xp, score, themeId, won) {
    const before = this.unlockedThemes().length;
    this.data.lifetimeXP += xp;
    // Cards are the meta currency; roughly one per 40 XP, plus a win bonus.
    const cards = Math.round(xp / 40) + (won ? 25 : 0);
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

  setLastCharacter(id) {
    if (this.data.lastCharacter === id) return;
    this.data.lastCharacter = id;
    this.save();
  }

  get settings() { return this.data.settings; }
  setSetting(k, v) { this.data.settings[k] = v; this.save(); }
}
