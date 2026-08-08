// In-run upgrade draft. On level-up you're offered three (four with Rolodex),
// and every pick has to feel like it changes how the next minute plays.

export const UPGRADES = {
  // --- Signature powers -----------------------------------------------------
  gravityGun: {
    id: 'gravityGun', name: 'Dewey Decimal Beam', icon: '🔫', kind: 'power',
    tag: 'Q',
    desc: (l) => (l === 1
      ? 'Fire a tractor beam that drags loose books to you from across the room. Rips them out of small hands, too.'
      : `Range +3 m, cooldown −18%, now pulls ${2 + l} books at once.`),
    maxLevel: 6,
    apply: (p, l) => { p.game.powers.setLevel('gravityGun', l); },
  },
  bookerang: {
    id: 'bookerang', name: 'Bookerang', icon: '🪃', kind: 'power',
    tag: 'E',
    desc: (l) => (l === 1
      ? 'Hurl the books you are carrying at their shelves from across the room. No walking required.'
      : `Throw range +4.5 m, and now files ${1 + l} books per throw.`),
    maxLevel: 6,
    apply: (p, l) => { p.game.powers.setLevel('bookerang', l); },
  },
  colorPulse: {
    id: 'colorPulse', name: 'Chromatic Shush', icon: '🌈', kind: 'power',
    tag: 'F',
    desc: (l) => (l === 1
      ? 'A shockwave that sends every book of one colour flying back to its shelf at once.'
      : l < 3
        ? 'Radius +4 m, cooldown −15%.'
        : `Radius +4 m, and now shushes ${Math.min(4, 1 + Math.floor(l / 2))} colours at once.`),
    maxLevel: 7,
    apply: (p, l) => { p.game.powers.setLevel('colorPulse', l); },
  },
  backpack: {
    id: 'backpack', name: 'Cavernous Backpack', icon: '🎒', kind: 'power',
    desc: (l) => (l >= 3
      ? `Carry ${2 * l} more books, and auto-sort from ${(0.9 * (l - 2)).toFixed(1)} m further out.`
      : `Carry ${2 * l} more books. At level 3 it starts auto-sorting.`),
    maxLevel: 5,
    apply: (p, l) => {
      p.stats.carrySlots = 6 + 2 * l + (p.metaBonus?.carry ?? 0);
      if (l >= 3) p.stats.returnRadius = 2.4 + (l - 2) * 0.9;
    },
  },

  // --- Passives -------------------------------------------------------------
  comfyShoes: {
    id: 'comfyShoes', name: 'Comfy Shoes', icon: '👟', kind: 'passive',
    desc: (l) => `+${8 * l}% movement speed.`,
    maxLevel: 6,
    apply: (p, l) => { p.stats.moveSpeed = p.stats.baseMoveSpeed * (1 + 0.08 * l); },
  },
  longArms: {
    id: 'longArms', name: 'Improbably Long Arms', icon: '🤲', kind: 'passive',
    desc: (l) => `Pickup radius +${(0.55 * l).toFixed(2)} m.`,
    maxLevel: 6,
    apply: (p, l) => { p.stats.pickupRadius = 2.2 + 0.55 * l; },
  },
  shelfSense: {
    id: 'shelfSense', name: 'Shelf Sense', icon: '📐', kind: 'passive',
    desc: (l) => `File books from ${(0.7 * l).toFixed(1)} m further away.`,
    maxLevel: 5,
    apply: (p, l) => { p.stats.returnRadius = 2.4 + 0.7 * l; },
  },
  zenFocus: {
    id: 'zenFocus', name: 'Zen Focus', icon: '🧘', kind: 'passive',
    desc: (l) => `Chaos accumulates ${5 * l}% slower.`,
    maxLevel: 6,
    apply: (p, l) => { p.stats.chaosDampening = 5 * l; },
  },
  readingGlasses: {
    id: 'readingGlasses', name: 'Reading Glasses', icon: '👓', kind: 'passive',
    desc: (l) => `+${10 * l}% XP.`,
    maxLevel: 5,
    apply: (p, l) => { p.stats.xpMultiplier = 1 + 0.1 * l; },
  },
  fitness: {
    id: 'fitness', name: 'Stair Workouts', icon: '💪', kind: 'passive',
    desc: (l) => `+${25 * l} stamina, and it comes back ${15 * l}% faster.`,
    maxLevel: 5,
    apply: (p, l) => {
      p.stats.maxStamina = 100 + 25 * l;
      p.stats.staminaRegen = 14 * (1 + 0.15 * l);
      p.stamina = Math.min(p.stamina + 25, p.stats.maxStamina);
    },
  },
  sprintCoach: {
    id: 'sprintCoach', name: 'Track Coach', icon: '🏃', kind: 'passive',
    desc: (l) => `Sprint is ${10 * l}% faster and drains ${10 * l}% less.`,
    maxLevel: 4,
    apply: (p, l) => {
      p.stats.sprintMul = 1.5 + 0.15 * l;
      p.stats.staminaDrain = 18 * (1 - 0.1 * l);
    },
  },
  dashTraining: {
    id: 'dashTraining', name: 'Emergency Scoot', icon: '💨', kind: 'passive',
    desc: (l) => `Dash cooldown −${18 * l}%, and it goes further.`,
    maxLevel: 4,
    apply: (p, l) => {
      p.stats.dashCooldown = 2.2 * (1 - 0.18 * l);
      p.stats.dashDistance = 5.4 + 0.7 * l;
    },
  },
  laminator: {
    id: 'laminator', name: 'Laminated Badge', icon: '🪪', kind: 'passive',
    desc: (l) => `+${25 * l} max health, and you shrug off the first hit each wave.`,
    maxLevel: 4,
    apply: (p, l) => {
      const gain = 25;
      p.stats.maxHealth = 100 + 25 * l;
      p.heal(gain);
    },
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
    desc: (l) => `Kids flee from ${(1.5 + l * 0.6).toFixed(1)} m away and move ${6 * l}% slower near you.`,
    maxLevel: 4,
    apply: (p, l) => { p.game.kids.repelRadius = 1.8 + l * 0.6; p.game.kids.auraSlow = 0.06 * l; },
  },
  janitor: {
    id: 'janitor', name: 'Janitor’s Keys', icon: '🧹', kind: 'passive',
    desc: (l) => `Clean messes ${30 * l}% faster${l >= 3 ? ', and small spills evaporate on their own' : ''}.`,
    maxLevel: 3,
    apply: (p, l) => { p.game.disasters.mopSpeed = 1 + 0.3 * l; p.game.disasters.autoClean = l >= 3; },
  },
  overdueFines: {
    id: 'overdueFines', name: 'Overdue Fines', icon: '💰', kind: 'passive',
    desc: (l) => `Combos build ${20 * l}% faster and last ${0.4 * l}s longer.`,
    maxLevel: 4,
    apply: (p, l) => { p.game.progression.comboBonus = 1 + 0.2 * l; p.game.progression.comboTime = 3.2 + 0.4 * l; },
  },
  cartography: {
    id: 'cartography', name: 'Cartographer’s Eye', icon: '🗺️', kind: 'passive',
    desc: (l) => (l === 1
      ? 'The shelf compass reaches further and points through walls.'
      : 'Also marks bosses, disasters and spills on the minimap.'),
    maxLevel: 3,
    apply: (p, l) => { p.game.hud.setCartography(l); },
  },
  fireDrill: {
    id: 'fireDrill', name: 'Fire Drill Training', icon: '🧯', kind: 'passive',
    desc: (l) => `Disasters last ${15 * l}% less time and hit ${12 * l}% softer.`,
    maxLevel: 4,
    apply: (p, l) => { p.game.disasters.mitigation = 1 - 0.12 * l; p.game.disasters.durationScale = 1 - 0.15 * l; },
  },
};

export const UPGRADE_LIST = Object.values(UPGRADES);

/** Draft `count` options, biased toward levelling up what you already own. */
export function draftUpgrades(rng, levels, count = 3, exclude = new Set()) {
  const pool = [];
  for (const u of UPGRADE_LIST) {
    const cur = levels[u.id] || 0;
    if (cur >= u.maxLevel) continue;
    if (exclude.has(u.id)) continue;
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
