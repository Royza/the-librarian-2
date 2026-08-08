// Playable librarians. Purely cosmetic — both handle identically, so picking
// one is a wardrobe decision, not a build decision.

export const CHARACTERS = {
  marion: {
    id: 'marion',
    name: 'Marion',
    title: 'Head Librarian',
    icon: '👓',
    blurb: 'Twenty-two years in this building. She has seen every kind of child there is.',
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
    height: 1.8,
    chunk: 1.05,
    style: { hair: 'short', beard: 'full', hat: 'cap', sleeves: 'long' },
    colors: {
      skin: 0xe0a878,
      // The shirt and sleeves render the plaid weave, so they stay white and
      // let the texture supply the colour.
      shirt: 0xffffff,
      pants: 0x3f5f8c,
      hair: 0x4a2f1c,
      beard: 0x4a2f1c,
      hat: 0x8e2b2b,
      badge: 0xf0e6d2,
      shoe: 0x3a2a20,
    },
    matMap: { torso: 'flannel', armU: 'flannel', armL: 'flannel' },
    swatch: ['#9e2b28', '#3f5f8c', '#4a2f1c'],
  },
};

export const CHARACTER_LIST = Object.values(CHARACTERS);
export const DEFAULT_CHARACTER = 'marion';

export function getCharacter(id) {
  return CHARACTERS[id] || CHARACTERS[DEFAULT_CHARACTER];
}
