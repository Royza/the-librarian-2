// Playable librarians. Their small, explicit trade-offs create a real loadout
// choice without turning either character into the objectively correct pick.

export const CHARACTERS = {
  buffy: {
    id: 'buffy',
    name: 'Buffy Summers',
    title: 'The Slayer',
    icon: '🗡️',
    blurb: 'Chosen to stand against the vampires, the demons, and the forces of darkness.',
    trait: 'Slayer Strength — fast, resilient, and deadly at close range.',
    bonuses: { pickupRadius: 0, returnRadius: 0, carrySlots: 0, moveSpeedMul: 1.08 },
    height: 1.68,
    chunk: 0.9,
    style: { hair: 'long', sleeves: 'long', cardigan: false, eyeDetail: true },
    colors: {
      skin: 0xe7b58f, shirt: 0x6f2736, innerShirt: 0x202126, pants: 0x171b25,
      hair: 0xc18b45, eye: 0x66869a, shoe: 0x2a211d,
    },
    matMap: { torso: 'leather', armU: 'leather', armL: 'leather' },
    swatch: ['#c18b45', '#6f2736', '#171b25'],
  },

  marion: {
    id: 'marion',
    name: 'Marion',
    title: 'Head Librarian',
    icon: '👓',
    blurb: 'Twenty-two years in this building. She has seen every kind of child there is.',
    trait: 'Precision Filing — longer reach, but one fewer carrying slot.',
    bonuses: { pickupRadius: 0.35, returnRadius: 0.2, carrySlots: -1, moveSpeedMul: 1 },
    height: 1.74,
    chunk: 1.0,
    style: { hair: 'bun', glasses: true, cardigan: true, sleeves: 'short' },
    colors: {
      skin: 0xdda882, shirt: 0x7a4a6a, pants: 0x2c3040,
      hair: 0x4a2c1a, shoe: 0x231d1a,
    },
    // Swatches for the select screen.
    swatch: ['#7a4a6a', '#2c3040', '#4a2c1a'],
  },

  wolfe: {
    id: 'wolfe',
    name: 'Wolfe',
    title: 'Weekend Shift',
    icon: '🧢',
    blurb: 'Flannel, beard, and strong opinions about the Dewey Decimal System.',
    trait: 'Bulk Returns — carries two extra items, but moves 3% slower.',
    bonuses: { pickupRadius: 0, returnRadius: 0, carrySlots: 2, moveSpeedMul: 0.97 },
    height: 1.82,
    chunk: 1.12,
    // Wolfe's silhouette and face deliberately carry the reference's strongest
    // identifying cues so he stays recognizable from both the select portrait
    // and the elevated gameplay camera.
    style: {
      hair: 'underCap',
      beard: 'saltPepper',
      hat: 'flatCap',
      hatLogo: 'geometric',
      sleeves: 'long',
      face: 'broad',
      eyeDetail: true,
      brows: 'thick',
      overshirt: true,
    },
    colors: {
      skin: 0xe4ad88,
      // The shirt and sleeves render the charcoal plaid weave, so they stay
      // white and let the texture supply the color.
      shirt: 0xffffff,
      innerShirt: 0x17191d,
      pants: 0x263b53,
      hair: 0x211f1e,
      beard: 0x292421,
      beardAccent: 0x81766d,
      brow: 0x211f1e,
      eyeWhite: 0xf3eee6,
      eye: 0x8da8b4,
      pupil: 0x11151a,
      hat: 0x101216,
      badge: 0xf4f1e8,
      button: 0x8e949a,
      shoe: 0x29231f,
    },
    matMap: { torso: 'charcoalFlannel', armU: 'charcoalFlannel', armL: 'charcoalFlannel' },
    swatch: ['#17191d', '#263b53', '#81766d'],
  },
};

export const CHARACTER_LIST = Object.values(CHARACTERS);
export const DEFAULT_CHARACTER = 'buffy';

export function getCharacter(id) {
  return CHARACTERS[id] || CHARACTERS[DEFAULT_CHARACTER];
}
