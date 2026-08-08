// Level themes. Each unlocks at a lifetime-XP milestone and re-skins the whole
// procedural generator: materials, palettes, prop sets, item shapes, and the
// special "hazard items" that give the level its own flavour of chaos.

export const ITEM_COLORS = {
  crimson: { hex: 0x7e2229, name: 'Crimson', ui: '#e0454f' },
  cobalt: { hex: 0x24406e, name: 'Cobalt', ui: '#4a80e8' },
  forest: { hex: 0x27543a, name: 'Forest', ui: '#3fbe75' },
  amber: { hex: 0x9a6f22, name: 'Amber', ui: '#f2b73a' },
  plum: { hex: 0x4e2a5e, name: 'Plum', ui: '#a763cf' },
  teal: { hex: 0x1d5560, name: 'Teal', ui: '#33bccd' },
  rust: { hex: 0x7d4327, name: 'Rust', ui: '#d97f4d' },
  slate: { hex: 0x3a4550, name: 'Slate', ui: '#7b90a8' },
};

export const COLOR_KEYS = Object.keys(ITEM_COLORS);

export const THEMES = {
  library: {
    id: 'library',
    name: 'The Grand Library',
    blurb: 'Marble, mahogany, and forty thousand books that would very much like to be on the floor.',
    xpToUnlock: 0,
    icon: '📚',
    itemNoun: 'book',
    itemNounPlural: 'books',
    shelfNoun: 'shelf',
    colors: ['crimson', 'cobalt', 'forest', 'amber', 'plum', 'teal'],
    fog: { color: 0x2a2015, near: 26, far: 96 },
    ambient: { color: 0x4a3a28, intensity: 0.7 },
    sun: { color: 0xffe2b0, intensity: 2.0 },
    lampColor: 0xffb45c,
    floor: { kind: 'wood', base: '#6b4526', dark: '#3d2413', light: '#8f6136', repeat: 0.5 },
    accentFloor: { kind: 'marble', base: '#e8e2d6', vein: '#8a7f6d' },
    shelfWood: { base: '#4a2d18', light: '#6b4526', dark: '#2a180c' },
    wall: '#c9b79a',
    itemSize: { w: 0.052, h: 0.245, d: 0.175 },   // spine width, height, depth
    ceilingHeight: 16.0,
    envPalette: { sky: '#8fb4de', warm: '#ffb469', bounce: '#8a5f38', skyStrength: 2.6, warmStrength: 3.2 },
    hazards: [],
    music: 'warm',
  },

  videostore: {
    id: 'videostore',
    name: 'Blockbuster Nite',
    blurb: 'Be kind, rewind. Then be kind and put it BACK, Tyler.',
    xpToUnlock: 12000,
    icon: '📼',
    itemNoun: 'tape',
    itemNounPlural: 'tapes',
    shelfNoun: 'rack',
    colors: ['crimson', 'cobalt', 'amber', 'plum', 'teal', 'forest'],
    fog: { color: 0x141a2e, near: 20, far: 78 },
    ambient: { color: 0x2b3358, intensity: 0.7 },
    sun: { color: 0x9fc4ff, intensity: 1.1 },
    lampColor: 0x74e0ff,
    floor: { kind: 'carpet', base: '#1c2a4a', dark: '#101a33', light: '#2a3d66', repeat: 0.35 },
    accentFloor: { kind: 'marble', base: '#dfe6f2', vein: '#6b7fa6' },
    shelfWood: { base: '#2b2f45', light: '#3d4566', dark: '#161a2b' },
    wall: '#1b2340',
    itemSize: { w: 0.028, h: 0.19, d: 0.105 },
    ceilingHeight: 8.2,
    envPalette: { sky: '#5aa8ff', warm: '#ff5ea8', bounce: '#22305c', skyStrength: 1.8, warmStrength: 4.0 },
    neon: true,
    hazards: [
      { id: 'popcorn', chance: 0.05, name: 'Spilled Popcorn', effect: 'slip' },
    ],
    music: 'synth',
  },

  recordstore: {
    id: 'recordstore',
    name: 'Groove Merchant Records',
    blurb: 'Alphabetical by artist. Not by mood. Not by vibe. By ARTIST.',
    xpToUnlock: 34000,
    icon: '💿',
    itemNoun: 'record',
    itemNounPlural: 'records',
    shelfNoun: 'crate',
    colors: ['amber', 'rust', 'crimson', 'forest', 'teal', 'plum'],
    fog: { color: 0x2c1f16, near: 22, far: 82 },
    ambient: { color: 0x5a3f26, intensity: 0.6 },
    sun: { color: 0xffcf8a, intensity: 1.8 },
    lampColor: 0xff9b42,
    floor: { kind: 'wood', base: '#7a5330', dark: '#412a15', light: '#a3764a', repeat: 0.45 },
    accentFloor: { kind: 'marble', base: '#d8cbb4', vein: '#8a6f4d' },
    shelfWood: { base: '#5c3a1e', light: '#84582e', dark: '#33200f' },
    wall: '#b09067',
    itemSize: { w: 0.014, h: 0.31, d: 0.31 },
    ceilingHeight: 9.5,
    envPalette: { sky: '#ffb469', warm: '#ff7a3c', bounce: '#a06a3a', skyStrength: 1.5, warmStrength: 3.6 },
    hazards: [],
    music: 'funk',
  },

  grocery: {
    id: 'grocery',
    name: 'MegaMart Superstore',
    blurb: 'Cleanup on every aisle. Watch the bananas.',
    xpToUnlock: 68000,
    icon: '🛒',
    itemNoun: 'item',
    itemNounPlural: 'groceries',
    shelfNoun: 'aisle',
    colors: ['crimson', 'amber', 'forest', 'cobalt', 'plum', 'teal'],
    fog: { color: 0x22262a, near: 24, far: 88 },
    ambient: { color: 0x6e7a86, intensity: 0.9 },
    sun: { color: 0xf2f6ff, intensity: 1.0 },
    lampColor: 0xeaf4ff,
    floor: { kind: 'lino', base: '#b9b6ad', dark: '#8f8d85', light: '#cfccc4', repeat: 0.5 },
    accentFloor: { kind: 'marble', base: '#cfccc4', vein: '#9a978f' },
    shelfWood: { base: '#8f959c', light: '#b6bcc4', dark: '#5f656c' },
    wall: '#d8dde2',
    itemSize: { w: 0.09, h: 0.2, d: 0.09 },
    ceilingHeight: 9.8,
    envPalette: { sky: '#e8f2ff', warm: '#fff0d0', bounce: '#c8c4b8', skyStrength: 3.2, warmStrength: 2.2 },
    fluorescent: true,
    // The grocery store is where item identity actually changes gameplay.
    hazards: [
      { id: 'banana', chance: 0.09, name: 'Banana Peel', effect: 'slip', color: 'amber' },
      { id: 'mushroom', chance: 0.05, name: 'Super Mushroom', effect: 'grow', color: 'crimson' },
      { id: 'pepper', chance: 0.05, name: 'Ghost Pepper', effect: 'dash', color: 'crimson' },
      { id: 'melon', chance: 0.045, name: 'Watermelon', effect: 'heavy', color: 'forest' },
      { id: 'egg', chance: 0.04, name: 'Egg Carton', effect: 'fragile', color: 'slate' },
      { id: 'soda', chance: 0.04, name: 'Shaken Soda', effect: 'fizz', color: 'cobalt' },
    ],
    music: 'muzak',
  },
};

export const THEME_ORDER = ['library', 'videostore', 'recordstore', 'grocery'];

export function themeUnlocked(themeId, lifetimeXP) {
  return lifetimeXP >= (THEMES[themeId]?.xpToUnlock ?? Infinity);
}
