// Shelving comes in a fixed set of carcass types. Locking the dimensions lets
// every bookcase in the building render from a handful of InstancedMeshes —
// the whole library is a few draw calls instead of a thousand.

export const SHELF_STYLES = {
  tall: { tiers: 5, height: 2.55, depth: 0.62, doubleSided: true, boardT: 0.07, sideT: 0.085, crown: 0.14, toe: 0.13 },
  archive: { tiers: 6, height: 2.9, depth: 0.72, doubleSided: true, boardT: 0.06, sideT: 0.07, crown: 0.09, toe: 0.11 },
  wall: { tiers: 5, height: 2.8, depth: 0.46, doubleSided: false, boardT: 0.07, sideT: 0.09, crown: 0.2, toe: 0.14 },
  kids: { tiers: 3, height: 1.22, depth: 0.55, doubleSided: true, boardT: 0.07, sideT: 0.085, crown: 0.12, toe: 0.11 },
  island: { tiers: 3, height: 1.36, depth: 0.7, doubleSided: true, boardT: 0.07, sideT: 0.09, crown: 0.14, toe: 0.12 },
  curved: { tiers: 5, height: 2.45, depth: 0.6, doubleSided: true, boardT: 0.07, sideT: 0.085, crown: 0.14, toe: 0.13 },
};

export const STYLE_KEYS = Object.keys(SHELF_STYLES);
