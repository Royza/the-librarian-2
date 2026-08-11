// In-run upgrade draft. On level-up you're offered three (four with Rolodex),
// and every pick has to feel like it changes how the next minute plays.

export const SIGNATURE_POWER_IDS = Object.freeze(['gravityGun', 'bookerang', 'colorPulse']);

export const UPGRADES = {
  // --- Signature powers -----------------------------------------------------
  gravityGun: {
    id: 'gravityGun', name: 'Dewey Decimal Beam', icon: '🔫', kind: 'power',
    tag: 'Q',
    desc: (l) => (l === 1
      ? 'Fire a tractor beam that drags loose books to you from across the room. Rips them out of small hands, too.'
      : l < 3
        ? `Range +3 m, cooldown −18%, now pulls ${2 + l} books at once.`
        : `Range +3 m, cooldown −18%, pulls ${2 + l} books, and holds your combo open 1.5 s longer after a successful beam.`),
    maxLevel: 6,
    apply: (p, l) => { p.game.powers.setLevel('gravityGun', l); },
  },
  bookerang: {
    id: 'bookerang', name: 'Bookerang', icon: '🪃', kind: 'power',
    tag: 'E',
    desc: (l) => (l === 1
      ? 'Hurl two carried books in visible spinning arcs to matching shelves across the room. No walking required.'
      : `Throw range +4.5 m, cooldown −15%, and now files ${1 + l} books per throw.`),
    maxLevel: 6,
    apply: (p, l) => { p.game.powers.setLevel('bookerang', l); },
  },
  colorPulse: {
    id: 'colorPulse', name: 'Chromatic Shush', icon: '🌈', kind: 'power',
    tag: 'F',
    minDraftLevel: 4,
    desc: (l) => (l === 1
      ? 'A shockwave that sends every nearby book of one color flying back to its shelf at once.'
      : l === 2
        ? 'Radius +4 m, cooldown −14%, and now shushes 2 colors at once.'
        : l < 4
          ? 'Radius +4 m, cooldown −14%; still shushes 2 colors at once.'
          : `Radius +4 m, cooldown −14%, shushes ${Math.min(4, 1 + Math.floor(l / 2))} colors, and leaves a temporary zone that auto-files stray books.`),
    maxLevel: 7,
    apply: (p, l) => { p.game.powers.setLevel('colorPulse', l); },
  },
  backpack: {
    id: 'backpack', name: 'Cavernous Backpack', icon: '🎒', kind: 'passive',
    desc: (l) => (l >= 3
      ? `Carry ${2 * l} more books, and auto-sort from ${(0.9 * (l - 2)).toFixed(1)} m further out.`
      : `Carry ${2 * l} more books. At level 3 it starts auto-sorting.`),
    maxLevel: 5,
  },

  // --- Passives -------------------------------------------------------------
  comfyShoes: {
    id: 'comfyShoes', name: 'Comfy Shoes', icon: '👟', kind: 'passive',
    desc: (l) => `+${8 * l}% movement speed.`,
    maxLevel: 6,
  },
  longArms: {
    id: 'longArms', name: 'Improbably Long Arms', icon: '🤲', kind: 'passive',
    desc: (l) => `Pickup radius +${(0.55 * l).toFixed(2)} m.`,
    maxLevel: 6,
  },
  shelfSense: {
    id: 'shelfSense', name: 'Shelf Sense', icon: '📐', kind: 'passive',
    desc: (l) => `File books from ${(0.7 * l).toFixed(1)} m further away.`,
    maxLevel: 5,
  },
  zenFocus: {
    id: 'zenFocus', name: 'Zen Focus', icon: '🧘', kind: 'passive',
    desc: (l) => `Chaos accumulates ${5 * l}% slower.`,
    maxLevel: 6,
  },
  readingGlasses: {
    id: 'readingGlasses', name: 'Reading Glasses', icon: '👓', kind: 'passive',
    desc: (l) => `+${10 * l}% XP.`,
    maxLevel: 5,
  },
  fitness: {
    id: 'fitness', name: 'Stair Workouts', icon: '💪', kind: 'passive',
    desc: (l) => `+${25 * l} stamina, and it comes back ${15 * l}% faster.`,
    maxLevel: 5,
  },
  sprintCoach: {
    id: 'sprintCoach', name: 'Track Coach', icon: '🏃', kind: 'passive',
    desc: (l) => `Sprint is ${10 * l}% faster and drains ${10 * l}% less.`,
    maxLevel: 4,
  },
  dashTraining: {
    id: 'dashTraining', name: 'Emergency Scoot', icon: '💨', kind: 'passive',
    desc: (l) => `Dash cooldown −${18 * l}%, and it goes further.`,
    maxLevel: 4,
  },
  laminator: {
    id: 'laminator', name: 'Laminated Badge', icon: '🪪', kind: 'passive',
    desc: (l) => `+${25 * l} max health. Blocks the first hit in every 60-second shift wave.`,
    maxLevel: 4,
  },
  teaBreak: {
    id: 'teaBreak', name: 'Tea Trolley', icon: '🍵', kind: 'passive',
    desc: (l) => `Every ${12 - l * 2} books filed restores 6 health.`,
    maxLevel: 4,
    apply: (p, l) => { p.game.progression.teaEvery = 12 - l * 2; },
  },
  quietPlease: {
    id: 'quietPlease', name: '“QUIET PLEASE” Sign', icon: '🤫', kind: 'passive',
    desc: (l) => `Every ${Math.round(60 - l * 8)} s, chaos freezes for ${3 + l} s and nearby kids scatter.`,
    maxLevel: 4,
    apply: (p, l) => { p.game.powers.setLevel('quietPlease', l); },
  },
  kidWhisperer: {
    id: 'kidWhisperer', name: 'Kid Whisperer', icon: '🫧', kind: 'passive',
    desc: (l) => `Kids flee from ${(1.8 + l * 0.6).toFixed(1)} m away and move ${6 * l}% slower near you.`,
    maxLevel: 4,
    apply: (p, l) => { p.game.kids.repelRadius = 1.8 + l * 0.6; p.game.kids.auraSlow = 0.06 * l; },
  },
  janitor: {
    id: 'janitor', name: 'Janitor’s Keys', icon: '🧹', kind: 'passive',
    desc: (l) => `Clean messes ${30 * l}% faster${l >= 3 ? '; standing in a mess now cleans it automatically' : ''}.`,
    maxLevel: 3,
  },
  overdueFines: {
    id: 'overdueFines', name: 'Overdue Fines', icon: '💰', kind: 'passive',
    desc: (l) => `Earn ${20 * l}% more XP, and combos last ${(0.4 * l).toFixed(1)} s longer.`,
    maxLevel: 4,
    apply: (p, l) => { p.game.progression.comboBonus = 1 + 0.2 * l; p.game.progression.comboTime = 3.2 + 0.4 * l; },
  },
  cartography: {
    id: 'cartography', name: 'Cartographer’s Eye', icon: '🗺️', kind: 'passive',
    desc: (l) => `Minimap coverage +${14 * l} m, revealing more distant clutter and routes at once. Core objective markers remain visible for everyone.`,
    maxLevel: 3,
    apply: (p, l) => { p.game.hud.setCartography(l); },
  },
  fireDrill: {
    id: 'fireDrill', name: 'Fire Drill Training', icon: '🧯', kind: 'passive',
    desc: (l) => `Disasters last ${15 * l}% less time and hit ${12 * l}% softer.`,
    maxLevel: 4,
  },
};

export const UPGRADE_LIST = Object.values(UPGRADES);

/** Draft `count` options, biased toward leveling up what you already own. */
export function draftUpgrades(rng, levels, count = 3, exclude = new Set(), runLevel = Infinity) {
  const pool = [];
  for (const u of UPGRADE_LIST) {
    const cur = levels[u.id] || 0;
    if (cur >= u.maxLevel) continue;
    if (exclude.has(u.id)) continue;
    // Chromatic Shush is a late-run power unless a paid permanent license has
    // already granted it. Once owned, its follow-up levels remain eligible.
    if (cur === 0 && runLevel < (u.minDraftLevel || 1)) continue;
    // Owned upgrades weigh more so builds converge instead of smearing.
    let w = cur > 0 ? 3.2 : 1;
    // Guarantee the signature powers show up early.
    if (u.kind === 'power' && cur === 0) w *= 2.0;
    pool.push({ w, v: u });
  }
  const out = [];
  const used = new Set();
  while (out.length < count && pool.length) {
    const available = pool.filter((e) => !used.has(e.v.id));
    if (!available.length) break;
    const pick = rng.weighted(available);
    used.add(pick.v.id);
    out.push(pick.v);
  }
  return out;
}
