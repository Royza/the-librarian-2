import { RNG } from '../core/rng.js';

const NAV_CELL = 1;

/**
 * Pure-data outdoor cemetery layout. Wide crossing paths are kept free while
 * graves and landmarks are varied inside quadrants, giving combat room without
 * sacrificing the old collision/pathfinding contract.
 */
export function generateCemeteryLayout(seedInput, theme, options = {}) {
  const rng = new RNG(seedInput);
  const size = options.size ?? 116;
  const layout = {
    seed: rng.seed,
    theme: theme.id,
    width: size,
    depth: size,
    ceilingHeight: theme.ceilingHeight,
    identity: {
      architecture: theme.worldIdentity.architecture,
      boulevardName: theme.worldIdentity.boulevardName,
      ceiling: theme.worldIdentity.ceiling,
      perimeter: theme.worldIdentity.perimeter,
      shelfContents: theme.worldIdentity.shelfContents,
      looseItems: [...theme.worldIdentity.looseItems],
      counter: theme.worldIdentity.counter.kind,
      sign: theme.worldIdentity.sign,
    },
    outdoor: true,
    zones: [], shelfRuns: [], allBays: [], props: [], lamps: [], chandeliers: [],
    pillars: [], rugs: [], windows: [], colliders: [], landmarks: [], corridors: [],
    paths: [], vampireSpawns: [],
    spawn: { x: size / 2, z: size - 12 },
    crossing: { x: size / 2, z: size / 2, w: 8 },
    navCell: NAV_CELL,
    navW: Math.ceil(size / NAV_CELL),
    navD: Math.ceil(size / NAV_CELL),
    bayIndexCell: 8,
    bayIndex: new Map(),
  };
  layout.nav = new Uint8Array(layout.navW * layout.navD);

  const pathW = 7.5;
  layout.paths.push(
    { x: size / 2, z: size / 2, w: pathW, d: size - 8, angle: 0 },
    { x: size / 2, z: size / 2, w: size - 8, d: pathW, angle: 0 },
    { x: size / 2, z: size / 2, w: 5, d: size * 0.72, angle: Math.PI / 4 },
  );
  layout.corridors.push(...layout.paths.map((p) => ({ x: p.x - p.w / 2, z: p.z - p.d / 2, w: p.w, d: p.d, grand: p.w > 7 })));

  const quadrants = [
    [6, 6, size / 2 - 11, size / 2 - 11, 'OLD NORTH GROUNDS'],
    [size / 2 + 5, 6, size / 2 - 11, size / 2 - 11, 'ANGEL HILL'],
    [6, size / 2 + 5, size / 2 - 11, size / 2 - 11, 'RESTFIELD'],
    [size / 2 + 5, size / 2 + 5, size / 2 - 11, size / 2 - 11, 'CRYPT WALK'],
  ];

  for (let q = 0; q < quadrants.length; q++) {
    const [x, z, w, d, name] = quadrants[q];
    const rect = {
      x, z, w, d, x2: x + w, z2: z + d,
      cx: x + w / 2, cz: z + d / 2,
      contains(px, pz) { return px >= x && px <= x + w && pz >= z && pz <= z + d; },
    };
    layout.zones.push({ id: q, type: 'graveyard', name, dominant: q % 2 ? 'slate' : 'forest', secondary: 'plum', rect });
    const rows = Math.max(3, Math.floor(d / 7));
    const cols = Math.max(4, Math.floor(w / 4.2));
    for (let rz = 0; rz < rows; rz++) {
      for (let cx = 0; cx < cols; cx++) {
        if (rng.bool(0.13)) continue;
        const px = x + 2.2 + cx * ((w - 4.4) / Math.max(1, cols - 1)) + rng.range(-0.35, 0.35);
        const pz = z + 2.2 + rz * ((d - 4.4) / Math.max(1, rows - 1)) + rng.range(-0.3, 0.3);
        const kind = rng.next() < 0.72 ? 'headstone' : rng.next() < 0.82 ? 'crossMarker' : 'graveSlab';
        layout.props.push({ kind, x: px, z: pz, angle: rng.range(-0.12, 0.12), scale: rng.range(0.82, 1.16) });
        if ((cx + rz) % 3 === 0) layout.vampireSpawns.push({ x: px, z: pz, kind: 'grave' });
      }
    }
  }

  // Large readable landmarks. Their conservative colliders leave the broad
  // paths and several open lawns available for melee encounters.
  addSolid(layout, { kind: 'mausoleum', x: 18, z: 19, angle: 0.12, scale: 1.15 }, 3.4, 2.8, 4.2);
  addSolid(layout, { kind: 'crypt', x: size - 19, z: size - 22, angle: -0.18, scale: 1.1 }, 3.0, 2.5, 3.4);
  addSolid(layout, { kind: 'obelisk', x: size - 20, z: 21, angle: 0, scale: 1.15 }, 0.8, 0.8, 5.2);
  addSolid(layout, { kind: 'stoneAngel', x: 21, z: size - 22, angle: 2.4, scale: 1.05 }, 1.0, 0.8, 2.8);

  const treePlaces = [
    [10, 35], [34, 10], [size - 10, 34], [size - 35, 10],
    [10, size - 35], [35, size - 10], [size - 10, size - 36], [size - 34, size - 10],
  ];
  for (const [x, z] of treePlaces) addSolid(layout, { kind: 'gnarledTree', x: x + rng.range(-2, 2), z: z + rng.range(-2, 2), angle: rng.range(0, Math.PI * 2), scale: rng.range(0.85, 1.2) }, 0.75, 0.75, 5);
  for (let i = 0; i < 28; i++) {
    const side = i % 4;
    const t = 9 + rng.next() * (size - 18);
    const x = side === 0 ? 6 : side === 1 ? size - 6 : t;
    const z = side === 2 ? 6 : side === 3 ? size - 6 : t;
    layout.props.push({ kind: 'shrub', x, z, angle: rng.range(0, 6.28), scale: rng.range(0.7, 1.25) });
  }

  layout.props.push({ kind: 'cemeteryGate', x: size / 2, z: size - 4.4, angle: 0, scale: 1.1 });
  layout.landmarks.push({ kind: 'cemeteryGate', name: theme.worldIdentity.counter.name, x: size / 2, z: size - 4.4, central: true });
  for (const [x, z] of [[size / 2 - 5, size - 16], [size / 2 + 5, size - 16], [size / 2 - 5, size / 2], [size / 2 + 5, size / 2], [size / 2, 16]]) {
    layout.props.push({ kind: 'cemeteryLamp', x, z, angle: 0, scale: 1 });
    layout.lamps.push({ kind: 'post', x, y: 3.2, z, color: 'amber' });
  }

  // Outer collision envelope retains camera containment and pathfinder safety.
  const wall = 1.2;
  layout.walls = [
    { x: size / 2, z: wall / 2, w: size, d: wall },
    { x: size / 2, z: size - wall / 2, w: size, d: wall },
    { x: wall / 2, z: size / 2, w: wall, d: size },
    { x: size - wall / 2, z: size / 2, w: wall, d: size },
  ];
  for (const w of layout.walls) layout.colliders.push({ x: w.x, z: w.z, angle: 0, hw: w.w / 2, hd: w.d / 2, height: 2.5, kind: 'wall' });
  for (const c of layout.colliders) rasterize(layout, c);
  sealBorders(layout);
  layout.stats = {
    zones: layout.zones.length,
    shelves: 0,
    bays: 0,
    capacity: 0,
    props: layout.props.length,
    vampireSpawns: layout.vampireSpawns.length,
    generationAttempt: 0,
  };
  layout.generationAttempt = 0;
  return layout;
}

function addSolid(layout, prop, hw, hd, height) {
  layout.props.push(prop);
  layout.colliders.push({ x: prop.x, z: prop.z, angle: prop.angle || 0, hw: hw * (prop.scale || 1), hd: hd * (prop.scale || 1), height, kind: prop.kind });
  layout.vampireSpawns.push({ x: prop.x + Math.cos(prop.angle || 0) * (hw + 2), z: prop.z + Math.sin(prop.angle || 0) * (hw + 2), kind: prop.kind });
}

function rasterize(layout, c) {
  const ext = Math.hypot(c.hw, c.hd) + 0.45;
  const x0 = Math.max(0, Math.floor((c.x - ext) / layout.navCell));
  const x1 = Math.min(layout.navW - 1, Math.ceil((c.x + ext) / layout.navCell));
  const z0 = Math.max(0, Math.floor((c.z - ext) / layout.navCell));
  const z1 = Math.min(layout.navD - 1, Math.ceil((c.z + ext) / layout.navCell));
  const co = Math.cos(-c.angle), si = Math.sin(-c.angle);
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const wx = (x + 0.5) * layout.navCell - c.x;
    const wz = (z + 0.5) * layout.navCell - c.z;
    const lx = wx * co - wz * si;
    const lz = wx * si + wz * co;
    if (Math.abs(lx) <= c.hw + 0.4 && Math.abs(lz) <= c.hd + 0.4) layout.nav[z * layout.navW + x] = 1;
  }
}

function sealBorders(layout) {
  for (let x = 0; x < layout.navW; x++) { layout.nav[x] = 1; layout.nav[(layout.navD - 1) * layout.navW + x] = 1; }
  for (let z = 0; z < layout.navD; z++) { layout.nav[z * layout.navW] = 1; layout.nav[z * layout.navW + layout.navW - 1] = 1; }
}
