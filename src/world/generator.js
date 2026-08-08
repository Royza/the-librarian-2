import { RNG } from '../core/rng.js';
import { ITEM_COLORS } from '../data/themes.js';
import { SHELF_STYLES } from '../data/shelfStyles.js';

// ---------------------------------------------------------------------------
// Procedural floor-plan generator.
//
// A run's building is grown in four passes:
//   1. BSP-partition the hall into districts, carving a corridor at every split.
//   2. Force two grand boulevards through the middle so the space stays legible
//      and you always have a long sight line to run down.
//   3. Give each district an archetype (stacks / rotunda / reading room / …)
//      and let that archetype furnish itself.
//   4. Rasterise everything into a nav grid and an OBB collider list.
//
// Output is pure data. `level.js` turns it into meshes; nothing here touches
// three.js, which keeps generation fast and testable.
// ---------------------------------------------------------------------------

export const ARCHETYPES = {
  STACKS: 'stacks',
  ROTUNDA: 'rotunda',
  READING: 'reading',
  ATRIUM: 'atrium',
  CARRELS: 'carrels',
  CHILDREN: 'children',
  ARCHIVE: 'archive',
  GALLERY: 'gallery',
};

const BAY_WIDTH = 1.0;
const NAV_CELL = 1.0;

class Rect {
  constructor(x, z, w, d) { this.x = x; this.z = z; this.w = w; this.d = d; }
  get cx() { return this.x + this.w / 2; }
  get cz() { return this.z + this.d / 2; }
  get x2() { return this.x + this.w; }
  get z2() { return this.z + this.d; }
  get area() { return this.w * this.d; }
  shrink(m) { return new Rect(this.x + m, this.z + m, this.w - m * 2, this.d - m * 2); }
  contains(px, pz) { return px >= this.x && px <= this.x2 && pz >= this.z && pz <= this.z2; }
}

export function generateLayout(seedInput, theme, options = {}) {
  const rng = new RNG(seedInput);
  const size = options.size ?? 172;
  const width = size, depth = size;
  const margin = 6;                       // wall thickness + walkway
  const interior = new Rect(margin, margin, width - margin * 2, depth - margin * 2);

  const layout = {
    seed: rng.seed,
    theme: theme.id,
    width, depth,
    ceilingHeight: theme.ceilingHeight,
    zones: [],
    shelfRuns: [],
    props: [],
    lamps: [],
    chandeliers: [],
    pillars: [],
    rugs: [],
    windows: [],
    colliders: [],
    landmarks: [],
    corridors: [],
    spawn: { x: width / 2, z: depth / 2 },
    navCell: NAV_CELL,
    navW: Math.ceil(width / NAV_CELL),
    navD: Math.ceil(depth / NAV_CELL),
  };
  layout.nav = new Uint8Array(layout.navW * layout.navD);

  // --- Pass 1 & 2: partition -------------------------------------------------
  const boulevardW = rng.range(7, 9.5);
  const crossX = interior.cx + rng.range(-10, 10);
  const crossZ = interior.cz + rng.range(-10, 10);

  const quadrants = [
    new Rect(interior.x, interior.z, crossX - boulevardW / 2 - interior.x, crossZ - boulevardW / 2 - interior.z),
    new Rect(crossX + boulevardW / 2, interior.z, interior.x2 - (crossX + boulevardW / 2), crossZ - boulevardW / 2 - interior.z),
    new Rect(interior.x, crossZ + boulevardW / 2, crossX - boulevardW / 2 - interior.x, interior.z2 - (crossZ + boulevardW / 2)),
    new Rect(crossX + boulevardW / 2, crossZ + boulevardW / 2, interior.x2 - (crossX + boulevardW / 2), interior.z2 - (crossZ + boulevardW / 2)),
  ];

  layout.corridors.push(
    { x: interior.x, z: crossZ - boulevardW / 2, w: interior.w, d: boulevardW, grand: true },
    { x: crossX - boulevardW / 2, z: interior.z, w: boulevardW, d: interior.d, grand: true },
  );

  const leaves = [];
  for (const q of quadrants) bsp(q, rng, leaves, layout, 0);

  // --- Pass 3: assign archetypes & furnish -----------------------------------
  const sorted = leaves.slice().sort((a, b) => b.area - a.area);
  const forced = new Map();
  // The two biggest districts always become showpieces: one rotunda, one atrium.
  if (sorted[0]) forced.set(sorted[0], ARCHETYPES.ATRIUM);
  if (sorted[1]) forced.set(sorted[1], ARCHETYPES.ROTUNDA);
  // Guarantee one children's corner — it is where the worst offenders live.
  const kidZone = rng.pick(sorted.slice(2, Math.max(3, Math.floor(sorted.length * 0.7))));
  if (kidZone) forced.set(kidZone, ARCHETYPES.CHILDREN);

  const palette = theme.colors;

  for (const leaf of leaves) {
    const type = forced.get(leaf) ?? rng.weighted([
      { w: 40, v: ARCHETYPES.STACKS },
      { w: 12, v: ARCHETYPES.READING },
      { w: 9, v: ARCHETYPES.CARRELS },
      { w: 9, v: ARCHETYPES.ARCHIVE },
      { w: 8, v: ARCHETYPES.GALLERY },
      { w: 7, v: ARCHETYPES.ROTUNDA },
      { w: 6, v: ARCHETYPES.CHILDREN },
    ]).v;

    // Regional identity: one dominant colour per district, the rest sprinkled.
    const dominant = rng.pick(palette);
    const secondary = rng.pick(palette.filter((c) => c !== dominant));
    const zone = {
      id: layout.zones.length,
      type, rect: leaf,
      dominant, secondary,
      name: districtName(rng, type),
    };
    layout.zones.push(zone);

    switch (type) {
      case ARCHETYPES.STACKS: furnishStacks(layout, zone, rng, theme); break;
      case ARCHETYPES.ARCHIVE: furnishStacks(layout, zone, rng, theme, { dense: true }); break;
      case ARCHETYPES.ROTUNDA: furnishRotunda(layout, zone, rng, theme); break;
      case ARCHETYPES.ATRIUM: furnishAtrium(layout, zone, rng, theme); break;
      case ARCHETYPES.READING: furnishReading(layout, zone, rng, theme); break;
      case ARCHETYPES.CARRELS: furnishCarrels(layout, zone, rng, theme); break;
      case ARCHETYPES.CHILDREN: furnishChildren(layout, zone, rng, theme); break;
      case ARCHETYPES.GALLERY: furnishGallery(layout, zone, rng, theme); break;
    }
  }

  // --- Perimeter dressing ----------------------------------------------------
  buildPerimeter(layout, rng, theme);
  buildBoulevardDressing(layout, rng, theme, crossX, crossZ, boulevardW);

  // --- Pass 4: bake nav ------------------------------------------------------
  for (const c of layout.colliders) rasteriseCollider(layout, c);
  sealBorders(layout);

  // Spawn just off the crossing so the player doesn't start inside the desk,
  // but still with the landmark in frame.
  layout.spawn = { x: crossX, z: crossZ + boulevardW * 0.9 + 2.5 };
  layout.crossing = { x: crossX, z: crossZ, w: boulevardW };

  buildBayIndex(layout);
  return layout;
}

// --- BSP --------------------------------------------------------------------

function bsp(rect, rng, out, layout, depthLevel) {
  const MIN = 19;
  const MAX = 40;
  const canSplitW = rect.w > MIN * 2 + 4;
  const canSplitD = rect.d > MIN * 2 + 4;
  const mustSplit = rect.w > MAX || rect.d > MAX;

  if ((!canSplitW && !canSplitD) || (!mustSplit && (depthLevel >= 3 || rng.bool(0.28)))) {
    if (rect.w >= 10 && rect.d >= 10) out.push(rect);
    return;
  }

  let vertical;
  if (canSplitW && canSplitD) vertical = rect.w / rect.d > 1.15 ? true : rect.d / rect.w > 1.15 ? false : rng.bool();
  else vertical = canSplitW;

  const corridorW = rng.range(3.4, 5.4);
  if (vertical) {
    const cut = rng.range(rect.x + MIN, rect.x2 - MIN);
    layout.corridors.push({ x: cut - corridorW / 2, z: rect.z, w: corridorW, d: rect.d, grand: false });
    bsp(new Rect(rect.x, rect.z, cut - corridorW / 2 - rect.x, rect.d), rng, out, layout, depthLevel + 1);
    bsp(new Rect(cut + corridorW / 2, rect.z, rect.x2 - (cut + corridorW / 2), rect.d), rng, out, layout, depthLevel + 1);
  } else {
    const cut = rng.range(rect.z + MIN, rect.z2 - MIN);
    layout.corridors.push({ x: rect.x, z: cut - corridorW / 2, w: rect.w, d: corridorW, grand: false });
    bsp(new Rect(rect.x, rect.z, rect.w, cut - corridorW / 2 - rect.z), rng, out, layout, depthLevel + 1);
    bsp(new Rect(rect.x, cut + corridorW / 2, rect.w, rect.z2 - (cut + corridorW / 2)), rng, out, layout, depthLevel + 1);
  }
}

// --- Shelf run helper -------------------------------------------------------

function addShelfRun(layout, zone, rng, theme, { x, z, angle, length, style = 'tall' }) {
  // Dimensions come from the style preset, never from the caller — that is what
  // keeps every bookcase instanceable.
  const preset = SHELF_STYLES[style] || SHELF_STYLES.tall;
  const { tiers, height, depth, doubleSided } = preset;

  const bayCount = Math.max(1, Math.round(length / BAY_WIDTH));
  const trueLength = bayCount * BAY_WIDTH;
  const run = {
    id: layout.shelfRuns.length,
    zoneId: zone.id,
    x, z, angle,
    length: trueLength,
    height, depth, tiers, style,
    doubleSided,
    bays: [],
  };

  const sides = doubleSided ? [1, -1] : [1];
  for (const side of sides) {
    for (let i = 0; i < bayCount; i++) {
      // 55% dominant, 20% secondary, rest spread — regional identity without
      // stranding the player when they're holding an off-colour item.
      const r = rng.next();
      const color = r < 0.55 ? zone.dominant
        : r < 0.75 ? zone.secondary
          : rng.pick(theme.colors);
      const slots = Math.max(6, Math.min(16, Math.round(BAY_WIDTH / (theme.itemSize.w * 1.55))));
      run.bays.push({
        runId: run.id,
        index: run.bays.length,
        side, i,
        color,
        capacity: slots * tiers,
        filled: slots * tiers,
        tiers, slots,
      });
    }
  }

  layout.shelfRuns.push(run);
  layout.colliders.push({
    x, z, angle,
    hw: trueLength / 2, hd: depth / 2,
    height,
    kind: 'shelf', runId: run.id,
  });
  return run;
}

function addProp(layout, prop) {
  layout.props.push(prop);
  if (prop.solid !== false) {
    layout.colliders.push({
      x: prop.x, z: prop.z, angle: prop.angle || 0,
      hw: prop.hw, hd: prop.hd, height: prop.height || 1,
      kind: prop.kind, soft: prop.soft || false,
    });
  }
}

// --- Archetype furnishers ---------------------------------------------------

function furnishStacks(layout, zone, rng, theme, { dense = false } = {}) {
  const r = zone.rect.shrink(1.6);
  if (r.w < 6 || r.d < 6) return;

  const alongZ = r.d >= r.w;
  const style = dense ? 'archive' : 'tall';
  const runDepth = SHELF_STYLES[style].depth;
  const height = SHELF_STYLES[style].height;
  const aisle = dense ? rng.range(2.2, 2.7) : rng.range(3.0, 4.0);
  const pitch = aisle + runDepth;

  const span = alongZ ? r.w : r.d;
  const rowCount = Math.max(1, Math.floor(span / pitch));
  const used = rowCount * pitch - aisle;
  const start = (alongZ ? r.x : r.z) + (span - used) / 2 + runDepth / 2;

  // Occasional cross-cut break so rows aren't monotonous walls.
  const breakEvery = rng.int(3, 6);

  for (let i = 0; i < rowCount; i++) {
    const cross = start + i * pitch;
    const lengthAxis = alongZ ? r.d : r.w;
    const axisStart = alongZ ? r.z : r.x;

    // Split each row into 1–2 segments with a gap, and jitter the ends.
    const segments = (i % breakEvery === breakEvery - 1 && lengthAxis > 16 && rng.bool(0.7)) ? 2 : 1;
    if (segments === 1) {
      const inset = rng.range(0, Math.min(3, lengthAxis * 0.12));
      const len = lengthAxis - inset * 2;
      if (len < 2) continue;
      const centre = axisStart + inset + len / 2;
      addShelfRun(layout, zone, rng, theme, {
        x: alongZ ? cross : centre,
        z: alongZ ? centre : cross,
        angle: alongZ ? Math.PI / 2 : 0,
        length: len, style,
      });
    } else {
      const gap = rng.range(2.4, 4.0);
      const half = (lengthAxis - gap) / 2 - rng.range(0.4, 1.6);
      for (const s of [-1, 1]) {
        if (half < 2) continue;
        const centre = axisStart + lengthAxis / 2 + s * (gap / 2 + half / 2);
        addShelfRun(layout, zone, rng, theme, {
          x: alongZ ? cross : centre,
          z: alongZ ? centre : cross,
          angle: alongZ ? Math.PI / 2 : 0,
          length: half, style,
        });
      }
    }
  }

  // Aisle lighting + the odd step stool / book cart to break up the floor.
  const lampRows = Math.max(1, Math.floor((alongZ ? r.d : r.w) / 9));
  for (let i = 0; i < rowCount; i += 2) {
    for (let j = 0; j < lampRows; j++) {
      const cross = start + i * pitch + pitch / 2;
      const along = (alongZ ? r.z : r.x) + ((j + 0.5) / lampRows) * (alongZ ? r.d : r.w);
      layout.lamps.push({
        x: alongZ ? cross : along,
        z: alongZ ? along : cross,
        y: Math.min(theme.ceilingHeight - 1.2, height + 1.9),
        // Strip lighting for anywhere that would really have it.
        kind: (theme.fluorescent || dense) ? 'strip' : 'pendant',
      });
    }
  }

  const clutter = rng.int(1, 4);
  for (let i = 0; i < clutter; i++) {
    const px = rng.range(r.x + 1, r.x2 - 1);
    const pz = rng.range(r.z + 1, r.z2 - 1);
    if (isBlockedApprox(layout, px, pz, 1.0)) continue;
    const kind = rng.pick(['cart', 'stool', 'stack', 'stack']);
    addProp(layout, {
      kind, x: px, z: pz, angle: rng.range(0, Math.PI * 2),
      hw: kind === 'cart' ? 0.45 : 0.28, hd: kind === 'cart' ? 0.28 : 0.28,
      height: kind === 'cart' ? 0.95 : 0.5, color: zone.dominant, soft: true,
    });
  }
}

function furnishRotunda(layout, zone, rng, theme) {
  const r = zone.rect;
  const cx = r.cx, cz = r.cz;
  const maxR = Math.min(r.w, r.d) / 2 - 1.4;
  if (maxR < 5) return furnishStacks(layout, zone, rng, theme);

  const rings = rng.int(2, 3);
  for (let ring = 0; ring < rings; ring++) {
    const radius = maxR * (1 - ring * 0.31);
    if (radius < 3.2) break;
    const circumference = 2 * Math.PI * radius;
    const arcs = Math.max(4, Math.floor(circumference / rng.range(6, 9)));
    const gapFrac = rng.range(0.16, 0.3);
    for (let a = 0; a < arcs; a++) {
      const a0 = (a / arcs) * Math.PI * 2 + ring * 0.4;
      const a1 = a0 + (1 - gapFrac) * (Math.PI * 2 / arcs);
      // Approximate the arc with a few long straight runs. Long segments are
      // what make the ring read as one sweeping wall of books rather than a
      // scattering of loose bookcases.
      const segs = Math.max(1, Math.round(radius * (a1 - a0) / 5.5));
      for (let s = 0; s < segs; s++) {
        const t0 = a0 + (s / segs) * (a1 - a0);
        const t1 = a0 + ((s + 1) / segs) * (a1 - a0);
        const mx = cx + Math.cos((t0 + t1) / 2) * radius;
        const mz = cz + Math.sin((t0 + t1) / 2) * radius;
        const len = radius * (t1 - t0);
        if (len < 1) continue;
        addShelfRun(layout, zone, rng, theme, {
          x: mx, z: mz,
          angle: (t0 + t1) / 2 + Math.PI / 2,
          length: len,
          style: ring === rings - 1 ? 'island' : 'curved',
        });
      }
    }
  }

  // Centrepiece + columns
  const centre = rng.pick(['globe', 'statue', 'fountain', 'cardcatalog']);
  addProp(layout, {
    kind: centre, x: cx, z: cz, angle: rng.range(0, Math.PI * 2),
    hw: 1.2, hd: 1.2, height: centre === 'statue' ? 3.2 : 1.5,
  });
  layout.landmarks.push({ x: cx, z: cz, kind: centre, name: zone.name });

  const cols = rng.int(6, 10);
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * Math.PI * 2 + 0.2;
    const px = cx + Math.cos(a) * (maxR + 0.9);
    const pz = cz + Math.sin(a) * (maxR + 0.9);
    if (!zone.rect.contains(px, pz)) continue;
    layout.pillars.push({ x: px, z: pz, radius: 0.42, height: theme.ceilingHeight });
    layout.colliders.push({ x: px, z: pz, angle: 0, hw: 0.42, hd: 0.42, height: theme.ceilingHeight, kind: 'pillar' });
  }

  layout.chandeliers.push({ x: cx, z: cz, y: theme.ceilingHeight - 1.6, radius: Math.min(3.2, maxR * 0.5), grand: true });
  layout.rugs.push({ x: cx, z: cz, w: maxR * 1.2, d: maxR * 1.2, angle: 0, round: true });
}

function furnishAtrium(layout, zone, rng, theme) {
  const r = zone.rect.shrink(1.2);
  const cx = r.cx, cz = r.cz;

  // Wall-hugging shelving only — the middle stays gloriously open.
  const wallInset = 0.9;
  // Angles are chosen so each run's outward face (its +z in local space) points
  // into the room, not into the wall behind it.
  const edges = [
    { x: cx, z: r.z + wallInset, angle: 0, len: r.w - 4 },
    { x: cx, z: r.z2 - wallInset, angle: Math.PI, len: r.w - 4 },
    { x: r.x + wallInset, z: cz, angle: -Math.PI / 2, len: r.d - 4 },
    { x: r.x2 - wallInset, z: cz, angle: Math.PI / 2, len: r.d - 4 },
  ];
  for (const e of edges) {
    if (e.len < 3) continue;
    addShelfRun(layout, zone, rng, theme, {
      x: e.x, z: e.z, angle: e.angle, length: e.len, style: 'wall',
    });
  }

  // Island display shelves scattered through the middle.
  const islands = rng.int(2, 5);
  for (let i = 0; i < islands; i++) {
    const px = rng.range(r.x + 5, r.x2 - 5);
    const pz = rng.range(r.z + 5, r.z2 - 5);
    if (Math.hypot(px - cx, pz - cz) < 5) continue;
    addShelfRun(layout, zone, rng, theme, {
      x: px, z: pz, angle: rng.range(0, Math.PI),
      length: rng.range(3, 6), style: 'island',
    });
  }

  const centre = rng.pick(['fountain', 'globe', 'statue']);
  addProp(layout, { kind: centre, x: cx, z: cz, angle: 0, hw: 1.6, hd: 1.6, height: 2.4 });
  layout.landmarks.push({ x: cx, z: cz, kind: centre, name: zone.name });

  // Seating ring
  const seats = rng.int(4, 8);
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2;
    const px = cx + Math.cos(a) * 4.4, pz = cz + Math.sin(a) * 4.4;
    addProp(layout, { kind: 'armchair', x: px, z: pz, angle: a + Math.PI, hw: 0.45, hd: 0.45, height: 0.9, soft: true });
  }

  layout.chandeliers.push({ x: cx, z: cz, y: theme.ceilingHeight - 1.2, radius: 4.2, grand: true, skylight: true });
  layout.rugs.push({ x: cx, z: cz, w: 12, d: 12, angle: 0, round: true });
  zone.skylight = true;
}

function furnishReading(layout, zone, rng, theme) {
  const r = zone.rect.shrink(1.4);

  // Perimeter shelving
  const edges = [
    { x: r.cx, z: r.z + 0.6, angle: 0, len: r.w - 2 },
    { x: r.cx, z: r.z2 - 0.6, angle: Math.PI, len: r.w - 2 },
  ];
  for (const e of edges) {
    if (e.len < 3 || !rng.bool(0.8)) continue;
    addShelfRun(layout, zone, rng, theme, {
      x: e.x, z: e.z, angle: e.angle, length: e.len, style: 'wall',
    });
  }

  const cols = Math.max(1, Math.floor((r.w - 3) / 5.5));
  const rows = Math.max(1, Math.floor((r.d - 5) / 4.5));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const px = r.x + 2.5 + (i + 0.5) * ((r.w - 5) / cols);
      const pz = r.z + 3 + (j + 0.5) * ((r.d - 6) / rows);
      const angle = rng.bool(0.7) ? 0 : Math.PI / 2;
      addProp(layout, {
        kind: 'table', x: px, z: pz, angle,
        hw: angle === 0 ? 1.5 : 0.75, hd: angle === 0 ? 0.75 : 1.5,
        height: 0.76, soft: true, lamp: rng.bool(0.75), color: zone.dominant,
      });
      const chairs = rng.int(2, 4);
      for (let c = 0; c < chairs; c++) {
        const ca = angle + (c % 2 === 0 ? 0 : Math.PI);
        const off = (Math.floor(c / 2) - 0.5) * 0.9;
        const chx = px + Math.cos(angle) * off + Math.sin(ca) * 1.1;
        const chz = pz + Math.sin(angle) * off - Math.cos(ca) * 1.1;
        addProp(layout, { kind: 'chair', x: chx, z: chz, angle: ca, hw: 0.26, hd: 0.26, height: 0.9, soft: true });
      }
      if (rng.bool(0.5)) layout.rugs.push({ x: px, z: pz, w: 5, d: 4, angle, round: false });
      layout.lamps.push({ x: px, z: pz, y: Math.min(theme.ceilingHeight - 1.5, 3.6), kind: theme.fluorescent ? 'strip' : 'pendant' });
    }
  }
  layout.landmarks.push({ x: r.cx, z: r.cz, kind: 'reading', name: zone.name });
}

function furnishCarrels(layout, zone, rng, theme) {
  const r = zone.rect.shrink(1.8);
  const pitchX = 2.3, pitchZ = 3.0;
  const cols = Math.max(1, Math.floor(r.w / pitchX));
  const rows = Math.max(1, Math.floor(r.d / pitchZ));
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      if (rng.bool(0.12)) continue;
      const px = r.x + (i + 0.5) * (r.w / cols);
      const pz = r.z + (j + 0.5) * (r.d / rows);
      addProp(layout, {
        kind: 'carrel', x: px, z: pz, angle: (j % 2) * Math.PI,
        hw: 0.75, hd: 0.55, height: 1.35, soft: false, color: zone.dominant,
      });
      if (rng.bool(0.6)) {
        addProp(layout, { kind: 'chair', x: px, z: pz + (j % 2 ? -1.0 : 1.0), angle: (j % 2) * Math.PI, hw: 0.26, hd: 0.26, height: 0.9, soft: true });
      }
    }
  }
  // A wall of low shelving down one edge so the district still holds items.
  addShelfRun(layout, zone, rng, theme, {
    x: r.cx, z: r.z + 0.4, angle: 0, length: r.w - 1, style: 'wall',
  });
  for (let j = 0; j < Math.max(1, Math.floor(r.d / 8)); j++) {
    layout.lamps.push({ x: r.cx, z: r.z + ((j + 0.5) / Math.max(1, Math.floor(r.d / 8))) * r.d, y: 3.4, kind: 'strip' });
  }
}

function furnishChildren(layout, zone, rng, theme) {
  const r = zone.rect.shrink(1.6);
  // Low, friendly shelving in short scattered runs, plus a story circle.
  const runs = rng.int(5, 10);
  for (let i = 0; i < runs; i++) {
    const px = rng.range(r.x + 2, r.x2 - 2);
    const pz = rng.range(r.z + 2, r.z2 - 2);
    if (Math.hypot(px - r.cx, pz - r.cz) < 5) continue;
    if (isBlockedApprox(layout, px, pz, 2.2)) continue;
    addShelfRun(layout, zone, rng, theme, {
      x: px, z: pz, angle: rng.pick([0, Math.PI / 2, Math.PI / 4, -Math.PI / 4]),
      length: rng.range(2.5, 5.5), style: 'kids',
    });
  }
  // Story circle: rug, beanbags, a puppet theatre.
  layout.rugs.push({ x: r.cx, z: r.cz, w: 8, d: 8, angle: 0, round: true, playful: true });
  const bags = rng.int(5, 9);
  for (let i = 0; i < bags; i++) {
    const a = (i / bags) * Math.PI * 2 + rng.range(-0.2, 0.2);
    addProp(layout, {
      kind: 'beanbag', x: r.cx + Math.cos(a) * rng.range(2, 3.2), z: r.cz + Math.sin(a) * rng.range(2, 3.2),
      angle: rng.range(0, 6.28), hw: 0.5, hd: 0.5, height: 0.5, soft: true,
      color: rng.pick(theme.colors),
    });
  }
  addProp(layout, { kind: 'puppettheatre', x: r.cx, z: r.z + 1.5, angle: 0, hw: 1.2, hd: 0.4, height: 2.0, color: zone.dominant });
  layout.landmarks.push({ x: r.cx, z: r.cz, kind: 'children', name: zone.name });
  for (let i = 0; i < 4; i++) {
    layout.lamps.push({
      x: r.x + rng.range(2, r.w - 2), z: r.z + rng.range(2, r.d - 2),
      y: 3.2, kind: 'globe', color: rng.pick(theme.colors),
    });
  }
  zone.playful = true;
}

function furnishGallery(layout, zone, rng, theme) {
  const r = zone.rect.shrink(1.5);
  // Display cases down the centre, art on partition walls.
  const alongZ = r.d >= r.w;
  const n = Math.max(2, Math.floor((alongZ ? r.d : r.w) / 5));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const px = alongZ ? r.cx : r.x + t * r.w;
    const pz = alongZ ? r.z + t * r.d : r.cz;
    addProp(layout, { kind: 'vitrine', x: px, z: pz, angle: alongZ ? 0 : Math.PI / 2, hw: 1.1, hd: 0.5, height: 1.15, color: zone.dominant });
    layout.lamps.push({ x: px, z: pz, y: 3.8, kind: theme.fluorescent ? 'strip' : 'spot' });
  }
  // Partition walls with shelving on their backs.
  const parts = rng.int(2, 4);
  for (let i = 0; i < parts; i++) {
    const t = (i + 1) / (parts + 1);
    const px = alongZ ? r.x + rng.range(2, r.w - 2) : r.x + t * r.w;
    const pz = alongZ ? r.z + t * r.d : r.z + rng.range(2, r.d - 2);
    addShelfRun(layout, zone, rng, theme, {
      x: px, z: pz, angle: alongZ ? 0 : Math.PI / 2,
      length: rng.range(4, 8), style: 'tall',
    });
  }
  layout.landmarks.push({ x: r.cx, z: r.cz, kind: 'gallery', name: zone.name });
}

// --- Perimeter & boulevards -------------------------------------------------

function buildPerimeter(layout, rng, theme) {
  const { width, depth } = layout;
  const t = 1.2;
  const h = theme.ceilingHeight;
  layout.walls = [
    { x: width / 2, z: t / 2, w: width, d: t, h },
    { x: width / 2, z: depth - t / 2, w: width, d: t, h },
    { x: t / 2, z: depth / 2, w: t, d: depth, h },
    { x: width - t / 2, z: depth / 2, w: t, d: depth, h },
  ];
  for (const w of layout.walls) {
    layout.colliders.push({ x: w.x, z: w.z, angle: 0, hw: w.w / 2, hd: w.d / 2, height: h, kind: 'wall' });
  }

  // Tall arched windows, evenly spaced, skipping the corners.
  const spacing = 11;
  const windowH = Math.min(6.5, h * 0.6);
  const windowY = h * 0.42;
  for (let x = spacing; x < width - spacing * 0.5; x += spacing) {
    layout.windows.push({ x, z: t, angle: 0, w: 3.2, h: windowH, y: windowY, normal: [0, 1] });
    layout.windows.push({ x, z: depth - t, angle: Math.PI, w: 3.2, h: windowH, y: windowY, normal: [0, -1] });
  }
  for (let z = spacing; z < depth - spacing * 0.5; z += spacing) {
    layout.windows.push({ x: t, z, angle: -Math.PI / 2, w: 3.2, h: windowH, y: windowY, normal: [1, 0] });
    layout.windows.push({ x: width - t, z, angle: Math.PI / 2, w: 3.2, h: windowH, y: windowY, normal: [-1, 0] });
  }

  // Perimeter reading nooks — window seats with a lamp.
  for (const w of layout.windows) {
    if (!rng.bool(0.4)) continue;
    const nx = w.x + w.normal[0] * 1.4;
    const nz = w.z + w.normal[1] * 1.4;
    if (isBlockedApprox(layout, nx, nz, 1.2)) continue;
    addProp(layout, {
      kind: 'windowseat', x: nx, z: nz,
      angle: Math.atan2(w.normal[0], w.normal[1]),
      hw: 1.3, hd: 0.5, height: 0.55, soft: true,
    });
  }
}

function buildBoulevardDressing(layout, rng, theme, crossX, crossZ, boulevardW) {
  const { width, depth } = layout;
  // Colonnade down both grand boulevards — sparse enough to see past.
  const step = 13;
  const CLEAR = 13;   // the crossing stays open — it is the run's landmark
  for (let z = 10; z < depth - 10; z += step) {
    if (Math.abs(z - crossZ) < CLEAR) continue;
    for (const s of [-1, 1]) {
      const px = crossX + s * (boulevardW / 2 + 0.6);
      if (isBlockedApprox(layout, px, z, 1.0)) continue;
      layout.pillars.push({ x: px, z, radius: 0.3, height: theme.ceilingHeight, fluted: true });
      layout.colliders.push({ x: px, z, angle: 0, hw: 0.3, hd: 0.3, height: theme.ceilingHeight, kind: 'pillar' });
    }
  }
  for (let x = 10; x < width - 10; x += step) {
    if (Math.abs(x - crossX) < CLEAR) continue;
    for (const s of [-1, 1]) {
      const pz = crossZ + s * (boulevardW / 2 + 0.6);
      if (isBlockedApprox(layout, x, pz, 1.0)) continue;
      layout.pillars.push({ x, z: pz, radius: 0.3, height: theme.ceilingHeight, fluted: true });
      layout.colliders.push({ x, z: pz, angle: 0, hw: 0.3, hd: 0.3, height: theme.ceilingHeight, kind: 'pillar' });
    }
  }

  // Chandeliers marching down the boulevards.
  for (let z = 12; z < depth - 12; z += 14) {
    layout.chandeliers.push({ x: crossX, z, y: theme.ceilingHeight - 1.8, radius: 1.6 });
  }
  for (let x = 12; x < width - 12; x += 14) {
    if (Math.abs(x - crossX) < 8) continue;
    layout.chandeliers.push({ x, z: crossZ, y: theme.ceilingHeight - 1.8, radius: 1.6 });
  }

  // The crossing itself: the circulation desk. Home base, visually.
  addProp(layout, {
    kind: 'desk', x: crossX, z: crossZ, angle: rng.pick([0, Math.PI / 2]),
    hw: 2.4, hd: 1.0, height: 1.1, solid: true,
  });
  layout.landmarks.push({ x: crossX, z: crossZ, kind: 'desk', name: 'Circulation Desk' });
  layout.rugs.push({ x: crossX, z: crossZ, w: boulevardW * 1.6, d: boulevardW * 1.6, angle: 0, round: true, grand: true });
}

// --- Nav rasterisation ------------------------------------------------------

function rasteriseCollider(layout, c) {
  const cell = layout.navCell;
  const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
  // Pad by roughly a body radius so agents don't clip corners.
  const pad = 0.42;
  const hw = c.hw + pad, hd = c.hd + pad;
  const ext = Math.hypot(hw, hd);
  const x0 = Math.max(0, Math.floor((c.x - ext) / cell));
  const x1 = Math.min(layout.navW - 1, Math.ceil((c.x + ext) / cell));
  const z0 = Math.max(0, Math.floor((c.z - ext) / cell));
  const z1 = Math.min(layout.navD - 1, Math.ceil((c.z + ext) / cell));

  for (let gz = z0; gz <= z1; gz++) {
    for (let gx = x0; gx <= x1; gx++) {
      const wx = (gx + 0.5) * cell - c.x;
      const wz = (gz + 0.5) * cell - c.z;
      const lx = wx * cos + wz * sin;
      const lz = -wx * sin + wz * cos;
      if (Math.abs(lx) <= hw && Math.abs(lz) <= hd) {
        layout.nav[gz * layout.navW + gx] = 1;
      }
    }
  }
}

function sealBorders(layout) {
  const { navW, navD, nav } = layout;
  for (let i = 0; i < navW; i++) {
    nav[i] = 1;
    nav[(navD - 1) * navW + i] = 1;
  }
  for (let j = 0; j < navD; j++) {
    nav[j * navW] = 1;
    nav[j * navW + navW - 1] = 1;
  }
}

/** Cheap overlap test against already-placed colliders (used while furnishing). */
function isBlockedApprox(layout, x, z, radius) {
  for (const c of layout.colliders) {
    const dx = x - c.x, dz = z - c.z;
    const cos = Math.cos(-c.angle), sin = Math.sin(-c.angle);
    const lx = Math.abs(dx * cos - dz * sin);
    const lz = Math.abs(dx * sin + dz * cos);
    if (lx < c.hw + radius && lz < c.hd + radius) return true;
  }
  return false;
}

// --- Bay spatial index (fast "nearest matching shelf" queries) ---------------

function buildBayIndex(layout) {
  const CELL = 8;
  const index = new Map();
  layout.bayIndexCell = CELL;
  layout.bayIndex = index;
  layout.allBays = [];

  for (const run of layout.shelfRuns) {
    const cos = Math.cos(run.angle), sin = Math.sin(run.angle);
    const bayCount = run.bays.length / (run.doubleSided ? 2 : 1);
    for (const bay of run.bays) {
      const along = (bay.i + 0.5 - bayCount / 2) * BAY_WIDTH;
      const across = bay.side * (run.depth / 2 + 0.06);
      bay.wx = run.x + cos * along - sin * across;
      bay.wz = run.z + sin * along + cos * across;
      // Facing direction: outward normal of this face.
      bay.nx = -sin * bay.side;
      bay.nz = cos * bay.side;
      bay.run = run;
      bay.globalIndex = layout.allBays.length;
      layout.allBays.push(bay);

      const key = `${Math.floor(bay.wx / CELL)},${Math.floor(bay.wz / CELL)}`;
      let arr = index.get(key);
      if (!arr) index.set(key, (arr = []));
      arr.push(bay);
    }
  }

  layout.stats = {
    runs: layout.shelfRuns.length,
    bays: layout.allBays.length,
    capacity: layout.allBays.reduce((s, b) => s + b.capacity, 0),
    zones: layout.zones.length,
  };
}

// Bays accept a little more than their nominal capacity. Without this you can
// end up holding an armful of one colour while every matching shelf nearby is
// nominally full — a softlock that reads as the game being broken. Real
// librarians squeeze them in; so do we.
export function bayHeadroom(bay) {
  return bay.capacity + Math.ceil(bay.capacity * 0.25);
}

export function bayAccepts(bay, color) {
  return bay.color === color && bay.filled < bayHeadroom(bay);
}

/** All bays within `radius` of a point, optionally filtered by colour. */
export function queryBays(layout, x, z, radius, color = null) {
  const CELL = layout.bayIndexCell;
  const out = [];
  const r2 = radius * radius;
  const gx0 = Math.floor((x - radius) / CELL), gx1 = Math.floor((x + radius) / CELL);
  const gz0 = Math.floor((z - radius) / CELL), gz1 = Math.floor((z + radius) / CELL);
  for (let gz = gz0; gz <= gz1; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const arr = layout.bayIndex.get(`${gx},${gz}`);
      if (!arr) continue;
      for (const b of arr) {
        if (color && b.color !== color) continue;
        const dx = b.wx - x, dz = b.wz - z;
        if (dx * dx + dz * dz <= r2) out.push(b);
      }
    }
  }
  return out;
}

export function nearestBay(layout, x, z, color = null, maxRadius = 140) {
  let best = null, bestD = Infinity;
  for (let r = 8; r <= maxRadius; r *= 1.8) {
    const bays = queryBays(layout, x, z, r, color);
    for (const b of bays) {
      if (b.filled >= bayHeadroom(b)) continue;
      const d = (b.wx - x) ** 2 + (b.wz - z) ** 2;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (best) break;
  }
  return best;
}

function districtName(rng, type) {
  const adj = ['East', 'West', 'North', 'South', 'Upper', 'Lower', 'Old', 'New', 'Quiet', 'Grand'];
  const nouns = {
    stacks: ['Stacks', 'Aisles', 'Rows', 'Annex'],
    archive: ['Archive', 'Vault', 'Repository', 'Deep Stacks'],
    rotunda: ['Rotunda', 'Circle', 'Ring'],
    atrium: ['Atrium', 'Great Hall', 'Concourse'],
    reading: ['Reading Room', 'Study', 'Salon'],
    carrels: ['Carrels', 'Study Cubbies', 'Quiet Zone'],
    children: ['Children’s Wing', 'Story Corner', 'Kids’ Nook'],
    gallery: ['Gallery', 'Exhibit Hall', 'Display Wing'],
  };
  return `${rng.pick(adj)} ${rng.pick(nouns[type] || nouns.stacks)}`;
}

export function colorHex(key) { return ITEM_COLORS[key]?.hex ?? 0x888888; }
export { BAY_WIDTH };
