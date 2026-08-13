// Permanent progression. Runs pay out Library Cards; cards buy the perks below,
// which make the *next* run start stronger. Costs scale so the tree stays
// meaningful for a long time.

export const META = {
  tenure: {
    id: 'tenure', name: 'Tenure', icon: '📜', max: 5,
    cemeteryName: "Slayer's Arsenal", cemeteryIcon: '🗡️',
    cemeteryDesc: (l) => `+${6 * l}% stake and kick damage on every patrol.`,
    desc: (l) => `Carry ${2 * l} more books in every run.`,
    cost: (l) => 20 + l * 25,
  },
  goodShoes: {
    id: 'goodShoes', name: 'Orthopedic Insoles', icon: '👟', max: 5,
    cemeteryName: 'Patrol Boots', cemeteryDesc: (l) => `+${4 * l}% base movement speed, permanently.`,
    desc: (l) => `+${4 * l}% base movement speed, permanently.`,
    cost: (l) => 25 + l * 30,
  },
  sturdySpine: {
    id: 'sturdySpine', name: 'Sturdy Spine', icon: '🦴', max: 5,
    cemeteryName: 'Slayer Resilience', cemeteryDesc: (l) => `+${20 * l} max health.`,
    desc: (l) => `+${20 * l} max health.`,
    cost: (l) => 22 + l * 26,
  },
  espresso: {
    id: 'espresso', name: 'Staff Room Espresso', icon: '☕', max: 4,
    cemeteryName: 'Watcher’s Thermos', cemeteryDesc: (l) => `+${20 * l} stamina and ${12 * l}% faster recovery.`,
    desc: (l) => `+${20 * l} stamina and ${12 * l}% faster recovery.`,
    cost: (l) => 18 + l * 22,
  },
  longReach: {
    id: 'longReach', name: 'Grabber Stick', icon: '🦯', max: 4,
    cemeteryName: 'Extended Lunge', cemeteryIcon: '🤺',
    cemeteryDesc: (l) => `Stake range +${(0.12 * l).toFixed(2)} m from the start.`,
    desc: (l) => `Pickup radius +${(0.3 * l).toFixed(1)} m from the start.`,
    cost: (l) => 24 + l * 28,
  },

  // --- Start-with-a-power unlocks
  beamLicense: {
    id: 'beamLicense', name: 'Beam License', icon: '🔫', max: 3,
    desc: (l) => `Begin each run with the Dewey Decimal Beam at level ${l}.`,
    cost: (l) => 60 + l * 70,
    cemeteryName: 'Sharpened Stakes', cemeteryIcon: '🪵',
    cemeteryDesc: (l) => `Begin each patrol with Stake Craft at level ${l}.`,
    apply: (p, l, prog) => prog.grantStarting(p.game?.theme?.id === 'cemetery' ? 'stakeDamage' : 'gravityGun', l),
  },
  boomerangLicense: {
    id: 'boomerangLicense', name: 'Bookerang Permit', icon: '🪃', max: 3,
    desc: (l) => `Begin each run with the Bookerang at level ${l}.`,
    cost: (l) => 60 + l * 70,
    cemeteryName: 'Combat Forms', cemeteryIcon: '🥋',
    cemeteryDesc: (l) => `Begin each patrol with Wide Arc at level ${l}.`,
    apply: (p, l, prog) => prog.grantStarting(p.game?.theme?.id === 'cemetery' ? 'wideArc' : 'bookerang', l),
  },
  colorTheory: {
    id: 'colorTheory', name: 'Color Theory', icon: '🌈', max: 3,
    desc: (l) => `Begin each run with Chromatic Shush at level ${l}.`,
    cost: (l) => 70 + l * 80,
    cemeteryName: 'Anatomy of a Vampire', cemeteryIcon: '🎯',
    cemeteryDesc: (l) => `Begin each patrol with Critical Stake at level ${l}.`,
    apply: (p, l, prog) => prog.grantStarting(p.game?.theme?.id === 'cemetery' ? 'criticalStake' : 'colorPulse', l),
  },

  // --- Run-shaping
  unionRep: {
    id: 'unionRep', name: 'Union Representation', icon: '✊', max: 4,
    cemeteryName: 'Watcher’s Research', cemeteryIcon: '📖', cemeteryDesc: (l) => `Hellmouth Activity rises ${4 * l}% slower.`,
    desc: (l) => `Chaos rises ${4 * l}% slower for the whole run.`,
    cost: (l) => 35 + l * 40,
  },
  overtime: {
    id: 'overtime', name: 'Overtime Pay', icon: '💵', max: 5,
    cemeteryName: 'Field Experience', cemeteryDesc: (l) => `+${8 * l}% XP and +${8 * l}% to Watcher Token payouts.`,
    desc: (l) => `+${8 * l}% XP and +${8 * l}% to Library Card payouts.`,
    cost: (l) => 30 + l * 35,
    apply: (p, l, prog) => { prog.cardMultiplier = 1 + 0.08 * l; },
  },
  rolodex: {
    id: 'rolodex', name: 'Rolodex', icon: '🗂️', max: 1,
    cemeteryName: 'Watcher’s Council', cemeteryIcon: '🔮', cemeteryDesc: () => 'Level-ups offer a fourth Slayer upgrade choice.',
    desc: () => 'Level-ups offer a fourth upgrade choice.',
    cost: () => 150,
    apply: (p, l, prog) => { prog.draftCount = 4; },
  },
  rerolls: {
    id: 'rerolls', name: 'Second Opinions', icon: '🔄', max: 3,
    cemeteryName: 'Research Again', cemeteryDesc: (l) => `${l} free reroll${l > 1 ? 's' : ''} per patrol at level-up.`,
    desc: (l) => `${l} free reroll${l > 1 ? 's' : ''} per run at level-up.`,
    cost: (l) => 55 + l * 55,
    apply: (p, l, prog) => { prog.rerolls = l; },
  },
  secondWind: {
    id: 'secondWind', name: 'Second Wind', icon: '💗', max: 1,
    cemeteryName: 'Slayer’s Second Wind', cemeteryDesc: () => 'Survive one run-ending Hellmouth spike per patrol, dropping back to 60%.',
    desc: () => 'Survive one run-ending chaos spike per run, dropping back to 60%.',
    cost: () => 220,
    apply: (p, l, prog) => { prog.secondWind = true; },
  },
  insurance: {
    id: 'insurance', name: 'Buildings Insurance', icon: '🏛️', max: 3,
    cemeteryName: 'Protective Charms', cemeteryIcon: '🧿', cemeteryDesc: (l) => `Vampire attacks deal ${10 * l}% less damage.`,
    desc: (l) => `Natural disasters are ${15 * l}% less destructive.`,
    cost: (l) => 45 + l * 50,
  },
  headStart: {
    id: 'headStart', name: 'Head Start', icon: '🚀', max: 3,
    cemeteryName: 'Chosen One', cemeteryDesc: (l) => `Begin each patrol at level ${1 + l} with ${l} upgrade${l > 1 ? 's' : ''} already drafted.`,
    desc: (l) => `Begin each run at level ${1 + l} with ${l} upgrade${l > 1 ? 's' : ''} already drafted.`,
    cost: (l) => 80 + l * 90,
    apply: (p, l, prog) => { prog.headStart = l; },
  },
  janitorial: {
    id: 'janitorial', name: 'Janitorial Contract', icon: '🧽', max: 3,
    cemeteryName: 'Ritual Conditioning', cemeteryIcon: '🔥', cemeteryDesc: (l) => `Recover stamina ${8 * l}% faster.`,
    desc: (l) => `Messes are cleaned ${20 * l}% faster from the start.`,
    cost: (l) => 30 + l * 30,
  },
};

export const META_LIST = Object.values(META);

export function metaCost(def, currentLevel) {
  return def.cost(currentLevel + 1);
}

export function metaPresentation(def, themeId = 'cemetery') {
  if (themeId !== 'cemetery') return { name: def.name, icon: def.icon, desc: def.desc };
  return {
    name: def.cemeteryName || def.name,
    icon: def.cemeteryIcon || def.icon,
    desc: def.cemeteryDesc || def.desc,
  };
}
