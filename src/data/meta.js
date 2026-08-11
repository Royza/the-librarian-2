// Permanent progression. Runs pay out Library Cards; cards buy the perks below,
// which make the *next* run start stronger. Costs scale so the tree stays
// meaningful for a long time.

export const META = {
  tenure: {
    id: 'tenure', name: 'Tenure', icon: '📜', max: 5,
    desc: (l) => `Carry ${2 * l} more books in every run.`,
    cost: (l) => 20 + l * 25,
  },
  goodShoes: {
    id: 'goodShoes', name: 'Orthopedic Insoles', icon: '👟', max: 5,
    desc: (l) => `+${4 * l}% base movement speed, permanently.`,
    cost: (l) => 25 + l * 30,
  },
  sturdySpine: {
    id: 'sturdySpine', name: 'Sturdy Spine', icon: '🦴', max: 5,
    desc: (l) => `+${20 * l} max health.`,
    cost: (l) => 22 + l * 26,
  },
  espresso: {
    id: 'espresso', name: 'Staff Room Espresso', icon: '☕', max: 4,
    desc: (l) => `+${20 * l} stamina and ${12 * l}% faster recovery.`,
    cost: (l) => 18 + l * 22,
  },
  longReach: {
    id: 'longReach', name: 'Grabber Stick', icon: '🦯', max: 4,
    desc: (l) => `Pickup radius +${(0.3 * l).toFixed(1)} m from the start.`,
    cost: (l) => 24 + l * 28,
  },

  // --- Start-with-a-power unlocks
  beamLicense: {
    id: 'beamLicense', name: 'Beam License', icon: '🔫', max: 3,
    desc: (l) => `Begin each run with the Dewey Decimal Beam at level ${l}.`,
    cost: (l) => 60 + l * 70,
    apply: (p, l, prog) => prog.grantStarting('gravityGun', l),
  },
  boomerangLicense: {
    id: 'boomerangLicense', name: 'Bookerang Permit', icon: '🪃', max: 3,
    desc: (l) => `Begin each run with the Bookerang at level ${l}.`,
    cost: (l) => 60 + l * 70,
    apply: (p, l, prog) => prog.grantStarting('bookerang', l),
  },
  colorTheory: {
    id: 'colorTheory', name: 'Color Theory', icon: '🌈', max: 3,
    desc: (l) => `Begin each run with Chromatic Shush at level ${l}.`,
    cost: (l) => 70 + l * 80,
    apply: (p, l, prog) => prog.grantStarting('colorPulse', l),
  },

  // --- Run-shaping
  unionRep: {
    id: 'unionRep', name: 'Union Representation', icon: '✊', max: 4,
    desc: (l) => `Chaos rises ${4 * l}% slower for the whole run.`,
    cost: (l) => 35 + l * 40,
  },
  overtime: {
    id: 'overtime', name: 'Overtime Pay', icon: '💵', max: 5,
    desc: (l) => `+${8 * l}% XP and +${8 * l}% to Library Card payouts.`,
    cost: (l) => 30 + l * 35,
    apply: (p, l, prog) => { prog.cardMultiplier = 1 + 0.08 * l; },
  },
  rolodex: {
    id: 'rolodex', name: 'Rolodex', icon: '🗂️', max: 1,
    desc: () => 'Level-ups offer a fourth upgrade choice.',
    cost: () => 150,
    apply: (p, l, prog) => { prog.draftCount = 4; },
  },
  rerolls: {
    id: 'rerolls', name: 'Second Opinions', icon: '🔄', max: 3,
    desc: (l) => `${l} free reroll${l > 1 ? 's' : ''} per run at level-up.`,
    cost: (l) => 55 + l * 55,
    apply: (p, l, prog) => { prog.rerolls = l; },
  },
  secondWind: {
    id: 'secondWind', name: 'Second Wind', icon: '💗', max: 1,
    desc: () => 'Survive one run-ending chaos spike per run, dropping back to 60%.',
    cost: () => 220,
    apply: (p, l, prog) => { prog.secondWind = true; },
  },
  insurance: {
    id: 'insurance', name: 'Buildings Insurance', icon: '🏛️', max: 3,
    desc: (l) => `Natural disasters are ${15 * l}% less destructive.`,
    cost: (l) => 45 + l * 50,
  },
  headStart: {
    id: 'headStart', name: 'Head Start', icon: '🚀', max: 3,
    desc: (l) => `Begin each run at level ${1 + l} with ${l} upgrade${l > 1 ? 's' : ''} already drafted.`,
    cost: (l) => 80 + l * 90,
    apply: (p, l, prog) => { prog.headStart = l; },
  },
  janitorial: {
    id: 'janitorial', name: 'Janitorial Contract', icon: '🧽', max: 3,
    desc: (l) => `Messes are cleaned ${20 * l}% faster from the start.`,
    cost: (l) => 30 + l * 30,
  },
};

export const META_LIST = Object.values(META);

export function metaCost(def, currentLevel) {
  return def.cost(currentLevel + 1);
}
