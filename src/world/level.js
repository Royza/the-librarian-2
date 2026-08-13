import * as THREE from 'three';
import { SHELF_STYLES } from '../data/shelfStyles.js';
import { ITEM_COLORS } from '../data/themes.js';
import { BAY_WIDTH } from './generator.js';
import { buildProp, box, cyl, mergeParts, ensureColorAttr } from './props.js';
import * as TX from '../render/textures.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

const VARIANTS = 2;

// ---------------------------------------------------------------------------
// Turns a generated layout into scene geometry.
//
// Everything repeated is an InstancedMesh, and instanced meshes are grouped by
// district so the frustum can throw away whole wings of the building at once.
// ---------------------------------------------------------------------------

export class Level {
  constructor(scene, layout, theme, mats, quality = 'high') {
    this.scene = scene;
    this.layout = layout;
    this.theme = theme;
    this.mats = mats;
    this.quality = quality;

    this.root = new THREE.Group();
    this.root.name = 'level';
    scene.add(this.root);

    this.disposables = [];
    this.time = 0;

    this._buildFloor();
    this._buildCeiling();
    this._buildWalls();
    this._buildRugs();
    this._buildShelves();
    this._buildProps();
    this._buildPillars();
    this._buildFixtures();
    this._buildLighting();
    this._buildAtmosphere();
  }

  // --- Floor & ceiling ------------------------------------------------------

  _buildFloor() {
    const { width, depth } = this.layout;
    const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(width / 2, 0, depth / 2);
    const mesh = new THREE.Mesh(geo, this.mats.floor);
    mesh.receiveShadow = true;
    mesh.name = 'floor';
    this.root.add(mesh);
    this.disposables.push(geo);

    // Branch-specific floor landmarks make the opening camera shot readable
    // before the player reaches any distant fixture.
    const accents = [];
    for (const lm of this.layout.landmarks) {
      if (lm.central) accents.push({ x: lm.x, z: lm.z, r: 9, central: true });
    }
    for (const z of this.layout.zones) {
      if (z.type === 'rotunda' || z.type === 'atrium') {
        accents.push({ x: z.rect.cx, z: z.rect.cz, r: Math.min(z.rect.w, z.rect.d) * 0.46 });
      }
    }
    for (const d of accents) {
      const g = this.theme.id === 'library' || this.theme.id === 'recordstore'
        ? new THREE.CircleGeometry(d.r, 48)
        : new THREE.PlaneGeometry(d.central ? d.r * 2.2 : d.r * 1.65, d.central ? d.r * 1.05 : d.r * 1.3);
      g.rotateX(-Math.PI / 2);
      g.translate(d.x, 0.008, d.z);
      const m = new THREE.Mesh(g, this.mats.accentFloor);
      m.receiveShadow = true;
      this.root.add(m);
      this.disposables.push(g);
    }

    if (this.layout.outdoor) {
      for (const p of this.layout.paths || []) {
        const g = new THREE.PlaneGeometry(p.w, p.d);
        g.rotateX(-Math.PI / 2);
        g.rotateY(p.angle || 0);
        g.translate(p.x, 0.012, p.z);
        const m = new THREE.Mesh(g, this.mats.accentFloor);
        m.receiveShadow = true;
        this.root.add(m);
        this.disposables.push(g);
      }
    }
  }

  _buildCeiling() {
    if (this.layout.outdoor) return;
    const { width, depth, ceilingHeight: H } = this.layout;
    const geo = new THREE.PlaneGeometry(width, depth, 1, 1);
    geo.rotateX(Math.PI / 2);
    geo.translate(width / 2, H, depth / 2);
    const mesh = new THREE.Mesh(geo, this.mats.ceiling);
    this.root.add(mesh);
    this.disposables.push(geo);

    // The ceiling silhouette is part of each branch's architecture: carved
    // coffers, black rental-store grid, exposed record-shop rafters, or the
    // supermarket's tight acoustic-tile lattice.
    const beamGeo = [];
    const ceilingStyle = this.theme.worldIdentity.ceiling;
    const step = ceilingStyle === 'coffered' ? 8
      : ceilingStyle === 'black-drop-grid' ? 4.2
        : ceilingStyle === 'exposed-rafters' ? 6.4 : 3.2;
    const beamW = ceilingStyle === 'coffered' ? 0.5
      : ceilingStyle === 'exposed-rafters' ? 0.24 : 0.065;
    const beamH = ceilingStyle === 'coffered' ? 0.55
      : ceilingStyle === 'exposed-rafters' ? 0.34 : 0.11;
    for (let x = step; x < width; x += step) {
      beamGeo.push(box(beamW, beamH, depth, x, H - beamH / 2, depth / 2));
    }
    const crossStep = ceilingStyle === 'exposed-rafters' ? step * 2 : step;
    for (let z = crossStep; z < depth; z += crossStep) {
      beamGeo.push(box(width, beamH, beamW, width / 2, H - beamH / 2, z));
    }
    const merged = mergeParts(beamGeo);
    if (merged) {
      const fixtureMat = ceilingStyle === 'black-drop-grid' || ceilingStyle === 'acoustic-tile-grid'
        ? this.mats.metal : this.mats.darkWood;
      const bm = new THREE.Mesh(merged, fixtureMat);
      bm.receiveShadow = true;
      this.root.add(bm);
      this.disposables.push(merged);
    }

    // Skylights above atriums.
    for (const z of this.layout.zones) {
      if (!z.skylight) continue;
      const r = Math.min(z.rect.w, z.rect.d) * 0.3;
      const g = new THREE.CircleGeometry(r, 40);
      g.rotateX(Math.PI / 2);
      g.translate(z.rect.cx, H - 0.05, z.rect.cz);
      const m = new THREE.Mesh(g, this.mats.windowPane);
      this.root.add(m);
      this.disposables.push(g);
      this._addSkyShaft(z.rect.cx, z.rect.cz, r, H);
    }
  }

  _addSkyShaft(x, z, r, H) {
    const g = new THREE.CylinderGeometry(r * 0.35, r * 0.95, H, 24, 1, true);
    g.translate(x, H / 2, z);
    const m = new THREE.Mesh(g, this.mats.shaft.clone());
    m.material.opacity = 0.028;
    m.renderOrder = 5;
    this.root.add(m);
    this.disposables.push(g);
    (this.shafts ||= []).push(m);
  }

  _buildWalls() {
    if (this.layout.outdoor) {
      this._buildCemeteryPerimeter();
      return;
    }
    const { width, depth, ceilingHeight: H } = this.layout;
    const parts = [];
    const t = 1.2;
    parts.push(box(width, H, t, width / 2, H / 2, t / 2));
    parts.push(box(width, H, t, width / 2, H / 2, depth - t / 2));
    parts.push(box(t, H, depth, t / 2, H / 2, depth / 2));
    parts.push(box(t, H, depth, width - t / 2, H / 2, depth / 2));
    const merged = mergeParts(parts);
    const wall = new THREE.Mesh(merged, this.mats.wall);
    wall.receiveShadow = true;
    this.root.add(wall);
    this.disposables.push(merged);

    // Windows: an emissive pane, a stone surround, and a volumetric shaft.
    const paneGeos = [];
    const frameGeos = [];
    const shaftGeos = [];
    const yaw = (w) => Math.atan2(w.normal[0], w.normal[1]);

    for (const w of this.layout.windows) {
      const g = new THREE.PlaneGeometry(w.w, w.h);
      g.rotateY(yaw(w));
      g.translate(w.x + w.normal[0] * 0.09, w.y, w.z + w.normal[1] * 0.09);
      paneGeos.push(g);

      // Surround built as four bars so it frames the pane instead of hiding it.
      const jamb = 0.3, head = 0.36;
      const bars = [
        box(w.w + jamb * 2, head, 0.34, 0, w.h / 2 + head / 2, 0),
        box(w.w + jamb * 2, head, 0.34, 0, -w.h / 2 - head / 2, 0),
        box(jamb, w.h, 0.34, -w.w / 2 - jamb / 2, 0, 0),
        box(jamb, w.h, 0.34, w.w / 2 + jamb / 2, 0, 0),
        // Mullions
        box(0.07, w.h, 0.12, 0, 0, 0.1),
        box(w.w, 0.07, 0.12, 0, w.h * 0.16, 0.1),
        box(w.w, 0.07, 0.12, 0, -w.h * 0.18, 0.1),
      ];
      for (const b of bars) {
        b.rotateY(yaw(w));
        b.translate(w.x + w.normal[0] * 0.05, w.y, w.z + w.normal[1] * 0.05);
        frameGeos.push(b);
      }

      shaftGeos.push(...this._windowShaftGeometries(w));
    }

    const panes = mergeParts(paneGeos);
    if (panes) {
      this.windowPaneMaterial = makeWindowPaneMaterial(this.theme);
      const pm = new THREE.Mesh(panes, this.windowPaneMaterial);
      pm.name = 'windowPanes';
      this.root.add(pm);
      this.disposables.push(panes, this.windowPaneMaterial);
      this.windowPanes = pm;
    }
    const frames = mergeParts(frameGeos);
    if (frames) {
      const fm = new THREE.Mesh(frames, this.mats.marble);
      fm.castShadow = true;
      fm.receiveShadow = true;
      this.root.add(fm);
      this.disposables.push(frames);
    }

    const shafts = mergeParts(shaftGeos);
    if (shafts) {
      this.windowShaftMaterial = makeWindowShaftMaterial(this.theme);
      const sm = new THREE.Mesh(shafts, this.windowShaftMaterial);
      sm.name = 'windowLightVolumes';
      sm.renderOrder = 5;
      this.root.add(sm);
      this.disposables.push(shafts, this.windowShaftMaterial);
      this.windowShaftMesh = sm;
    }
  }

  _buildCemeteryPerimeter() {
    const { width, depth } = this.layout;
    const stone = mergeParts([
      box(width, 0.42, 0.72, width / 2, 0.21, 0.36),
      box(width, 0.42, 0.72, width / 2, 0.21, depth - 0.36),
      box(0.72, 0.42, depth, 0.36, 0.21, depth / 2),
      box(0.72, 0.42, depth, width - 0.36, 0.21, depth / 2),
    ]);
    const base = new THREE.Mesh(stone, this.mats.marble);
    base.castShadow = true; base.receiveShadow = true;
    this.root.add(base); this.disposables.push(stone);

    const bars = [];
    const addRail = (x, z, horizontal) => {
      bars.push(box(horizontal ? 2.02 : 0.055, 0.055, horizontal ? 0.055 : 2.02, x, 1.45, z));
      bars.push(box(horizontal ? 2.02 : 0.055, 0.055, horizontal ? 0.055 : 2.02, x, 2.25, z));
      for (let i = -2; i <= 2; i++) {
        const ox = horizontal ? i * 0.46 : 0;
        const oz = horizontal ? 0 : i * 0.46;
        bars.push(box(0.055, 2.15, 0.055, x + ox, 1.45, z + oz));
        bars.push(cyl(0, 0.09, 0.25, 4, x + ox, 2.65, z + oz, 0, Math.PI / 4));
      }
    };
    for (let x = 1.2; x < width - 1; x += 2.05) { addRail(x, 0.55, true); addRail(x, depth - 0.55, true); }
    for (let z = 1.2; z < depth - 1; z += 2.05) { addRail(0.55, z, false); addRail(width - 0.55, z, false); }
    const iron = mergeParts(bars);
    const fence = new THREE.Mesh(iron, this.mats.metal);
    fence.castShadow = true;
    this.root.add(fence); this.disposables.push(iron);
  }

  _windowShaftGeometries(w) {
    // Two softly crossed ribbons form a view-independent light volume. Their
    // shader fades every edge and both ends, so walking through one never
    // reveals a hard translucent plane.
    const len = Math.min(11, w.y / 0.55);
    const sheets = [];
    for (const tilt of [-0.075, 0.075]) {
      const g = new THREE.PlaneGeometry(w.w * 1.12, len, 1, 6);
      const pos = g.attributes.position;
      const uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) {
        const t = 1 - uv.getY(i);
        const along = t * len;
        // Splay the beam as it travels so it fans across the floor.
        const across = pos.getX(i) * (1 + t * 0.82);
        pos.setXYZ(
          i,
          across * Math.cos(tilt),
          -along * 0.55 + across * Math.sin(tilt),
          along,
        );
      }
      g.computeVertexNormals();
      g.rotateY(Math.atan2(w.normal[0], w.normal[1]));
      g.translate(w.x + w.normal[0] * 0.1, w.y, w.z + w.normal[1] * 0.1);
      sheets.push(g);
    }
    return sheets;
  }

  _buildRugs() {
    const geos = [];
    for (const r of this.layout.rugs) {
      const g = r.round
        ? new THREE.CircleGeometry(r.w / 2, 40)
        : new THREE.PlaneGeometry(r.w, r.d);
      g.rotateX(-Math.PI / 2);
      if (r.angle) g.rotateY(r.angle);
      g.translate(r.x, 0.012, r.z);
      geos.push(g);
    }
    const merged = mergeParts(geos);
    if (!merged) return;
    const m = new THREE.Mesh(merged, this.mats.rug);
    m.receiveShadow = true;
    this.root.add(m);
    this.disposables.push(merged);
  }

  // --- Shelving -------------------------------------------------------------

  _buildShelves() {
    const layout = this.layout;
    const theme = this.theme;

    // Bucket every bay by (zone, style) — and every tier row additionally by a
    // texture variant, so neighboring shelves never repeat spine-for-spine.
    const carcassBuckets = new Map();  // key -> [{run, i}]
    const rowBuckets = new Map();      // key -> [{bay, tier}]
    const glowBuckets = new Map();     // key -> [bay]

    for (const run of layout.shelfRuns) {
      const bayCount = run.bays.length / (run.doubleSided ? 2 : 1);
      const ck = `${run.zoneId}|${run.style}`;
      let cb = carcassBuckets.get(ck);
      if (!cb) carcassBuckets.set(ck, (cb = []));
      for (let i = 0; i < bayCount; i++) cb.push({ run, i, end: i === bayCount - 1 });
    }

    for (const bay of layout.allBays) {
      const run = bay.run;
      const gk = `${run.zoneId}|${run.style}`;
      let gb = glowBuckets.get(gk);
      if (!gb) glowBuckets.set(gk, (gb = []));
      bay.glowSlot = gb.length;
      gb.push(bay);

      bay.tierRefs = [];
      for (let t = 0; t < run.tiers; t++) {
        const variant = (bay.globalIndex * 7 + t * 5) % VARIANTS;
        const rk = `${run.zoneId}|${run.style}|${variant}`;
        let rb = rowBuckets.get(rk);
        if (!rb) rowBuckets.set(rk, (rb = []));
        bay.tierRefs.push({ key: rk, idx: rb.length });
        rb.push({ bay, tier: t });
      }
    }

    this.shelfMeshes = [];
    this.rowMeshes = new Map();
    this.glowMeshes = new Map();

    // --- carcasses
    const carcassGeoCache = new Map();
    for (const [key, items] of carcassBuckets) {
      const style = key.split('|')[1];
      let geo = carcassGeoCache.get(style);
      if (!geo) {
        geo = buildCarcassGeometry(SHELF_STYLES[style], theme);
        carcassGeoCache.set(style, geo);
        this.disposables.push(geo);
      }
      const mesh = new THREE.InstancedMesh(geo, this.mats.wood, items.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
      mesh.instanceColor = colorAttr;

      items.forEach((it, i) => {
        placeBay(_m, it.run, it.i, 0, 0);
        mesh.setMatrixAt(i, _m);
        // Subtle per-bay wood tone variation so a long run isn't one flat plank.
        const v = 0.86 + ((it.run.id * 31 + it.i * 17) % 100) / 100 * 0.28;
        colorAttr.setXYZ(i, v, v * 0.985, v * 0.96);
      });
      mesh.instanceMatrix.needsUpdate = true;
      colorAttr.needsUpdate = true;
      mesh.computeBoundingSphere();
      this.root.add(mesh);
      this.shelfMeshes.push(mesh);
    }

    // --- item rows
    const rowGeoCache = new Map();

    for (const [key, entries] of rowBuckets) {
      const [, style, variantStr] = key.split('|');
      const st = SHELF_STYLES[style];
      const variant = Number(variantStr);
      const gk = `${style}|${variant}`;
      let geo = rowGeoCache.get(gk);
      if (!geo) {
        const gap = tierGap(st);
        geo = buildShelfItemRowGeometry(theme, BAY_WIDTH - st.sideT - 0.02, gap * ROW_HEIGHT, itemRowDepth(st, theme), variant / VARIANTS + 0.05);
        rowGeoCache.set(gk, geo);
        this.disposables.push(geo);
      }
      const mesh = new THREE.InstancedMesh(geo, this.mats.item, entries.length);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(entries.length * 3), 3);
      mesh.userData.entries = entries;
      this.root.add(mesh);
      this.rowMeshes.set(key, mesh);
      this.shelfMeshes.push(mesh);
    }

    // --- empty-slot glow (one quad per bay, additive, color = bay color)
    const glowGeoCache = new Map();
    for (const [key, bays] of glowBuckets) {
      const style = key.split('|')[1];
      const st = SHELF_STYLES[style];
      let geo = glowGeoCache.get(style);
      if (!geo) {
        const h = st.height - st.toe - st.crown;
        geo = ensureColorAttr(new THREE.PlaneGeometry(BAY_WIDTH - st.sideT, h * 0.94));
        glowGeoCache.set(style, geo);
        this.disposables.push(geo);
      }
      const mesh = new THREE.InstancedMesh(geo, this.mats.glowStrip, bays.length);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bays.length * 3), 3);
      mesh.userData.bays = bays;
      mesh.renderOrder = 3;
      mesh.frustumCulled = true;
      this.root.add(mesh);
      this.glowMeshes.set(key, mesh);
    }

    // Initial fill state
    for (const bay of layout.allBays) this.refreshBay(bay);
    for (const m of this.rowMeshes.values()) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }
    for (const m of this.glowMeshes.values()) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }
  }

  /** Re-sync a bay's visuals after items are removed or returned. */
  refreshBay(bay) {
    const run = bay.run;
    const st = SHELF_STYLES[run.style];
    const gap = tierGap(st);
    const itemD = itemRowDepth(st, this.theme);
    const innerW = BAY_WIDTH - st.sideT - 0.02;
    const perTier = bay.slots;

    for (let t = 0; t < run.tiers; t++) {
      const ref = bay.tierRefs[t];
      const mesh = this.rowMeshes.get(ref.key);
      if (!mesh) continue;
      // Fill from the bottom tier up, so shelves empty top-down like real ones.
      const remaining = bay.filled - t * perTier;
      const frac = Math.max(0, Math.min(1, remaining / perTier));   // overflow clamps

      // Deterministic per-(bay,tier) jitter. Rows sit at slightly different
      // depths and heights, so a run of shelving stops reading as one slab.
      const h = hash2(bay.globalIndex, t);
      const recess = 0.035 + h * 0.075;
      const y = st.toe + t * gap + st.boardT + (gap * ROW_HEIGHT) / 2;
      const across = bay.side * (st.depth / 2 - itemD / 2 - recess);
      // Left-anchored: the gap opens on the right as items leave.
      const along = -innerW / 2 + (innerW * frac) / 2;
      // A partly-emptied row leans, exactly like a real shelf does.
      const lean = frac > 0 && frac < 0.92 ? (1 - frac) * 0.06 : 0;

      composeLocal(_m, run, bay.i, along, y, across, frac, 0.94 + h * 0.1, 1, 0, lean);
      mesh.setMatrixAt(ref.idx, _m);

      const base = ITEM_COLORS[bay.color]?.hex ?? 0x888888;
      _c.setHex(base);
      // Lightness and a touch of hue drift so a color block has life in it.
      _c.offsetHSL((h - 0.5) * 0.045, (h - 0.5) * 0.18, (h - 0.5) * 0.16);
      _c.multiplyScalar(0.8 + h * 0.42);
      mesh.instanceColor.setXYZ(ref.idx, _c.r, _c.g, _c.b);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }

    // Glow quad sits just proud of the face, brightness = how empty the bay is.
    const gk = `${run.zoneId}|${run.style}`;
    const gm = this.glowMeshes.get(gk);
    if (gm) {
      const empty = Math.max(0, 1 - bay.filled / bay.capacity);
      const h = st.height - st.toe - st.crown;
      const y = st.toe + h / 2;
      const across = bay.side * (st.depth / 2 + 0.012);
      composeLocal(_m, run, bay.i, 0, y, across, 1, 1, 1, bay.side);
      gm.setMatrixAt(bay.glowSlot, _m);
      const c = ITEM_COLORS[bay.color]?.ui ?? '#888888';
      _c.set(c).multiplyScalar(Math.pow(empty, 1.5) * 0.55);
      gm.instanceColor.setXYZ(bay.glowSlot, _c.r, _c.g, _c.b);
      gm.instanceMatrix.needsUpdate = true;
      gm.instanceColor.needsUpdate = true;
    }
  }

  // --- Props ----------------------------------------------------------------

  _buildProps() {
    const byKind = new Map();
    for (const p of this.layout.props) {
      let arr = byKind.get(p.kind);
      if (!arr) byKind.set(p.kind, (arr = []));
      arr.push(p);
    }

    this.propMeshes = [];
    for (const [kind, list] of byKind) {
      const parts = buildProp(kind);
      for (const [matKey, geo] of Object.entries(parts)) {
        const mat = this.mats[matKey] || this.mats.wood;
        const mesh = new THREE.InstancedMesh(geo, mat, list.length);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        if (mat.vertexColors) {
          mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 3), 3);
        }
        list.forEach((p, i) => {
          const scale = p.scale ?? 1;
          _q.setFromAxisAngle(UP, p.angle || 0);
          _m.compose(_v.set(p.x, 0, p.z), _q, _s.set(scale, scale, scale));
          mesh.setMatrixAt(i, _m);
          if (mesh.instanceColor) {
            if (p.color && ITEM_COLORS[p.color] && (matKey === 'fabric' || matKey === 'leather' || matKey === 'item')) {
              _c.setHex(ITEM_COLORS[p.color].hex);
            } else {
              const v = 0.88 + ((i * 37) % 100) / 100 * 0.24;
              _c.setRGB(v, v * 0.99, v * 0.97);
            }
            mesh.instanceColor.setXYZ(i, _c.r, _c.g, _c.b);
          }
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        this.root.add(mesh);
        this.propMeshes.push(mesh);
      }
    }
  }

  _buildPillars() {
    const list = this.layout.pillars;
    if (!list.length) return;
    const H = this.layout.ceilingHeight;
    const parts = [
      cyl(0.42, 0.44, H - 0.9, 16, 0, (H - 0.9) / 2 + 0.35, 0),
      cyl(0.56, 0.62, 0.35, 16, 0, 0.175, 0),
      cyl(0.6, 0.5, 0.4, 16, 0, H - 0.35, 0),
      box(1.34, 0.18, 1.34, 0, H - 0.09, 0),
    ];
    const geo = mergeParts(parts);

    // Columns are the one thing tall enough to stand between the camera and the
    // hero, so they get a dithered fade-out material (see makeFadeMaterial).
    const mat = makeFadeMaterial(this.mats.marble);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(list.length).fill(1), 1);
    fade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFade', fade);

    list.forEach((p, i) => {
      _q.setFromAxisAngle(UP, (i * 0.7) % Math.PI);
      const sc = p.radius / 0.42;
      _m.compose(_v.set(p.x, 0, p.z), _q, _s.set(sc, (p.height || H) / H, sc));
      mesh.setMatrixAt(i, _m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.root.add(mesh);
    this.disposables.push(geo);

    this.pillarMesh = mesh;
    this.pillarFade = fade;
    this.pillarMat = mat;
    this._fadeState = new Float32Array(list.length).fill(1);
  }

  /**
   * Dissolve any column standing on the line between the camera and the player.
   * Without this the hero regularly vanishes behind a colonnade.
   */
  _updateOcclusion(dt, player) {
    if (!this.pillarMesh) return;
    const camPos = this._camPos;
    if (!camPos) return;

    const list = this.layout.pillars;
    const ax = camPos.x, az = camPos.z;
    const bx = player.x, bz = player.z;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz || 1;
    let dirty = false;

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      // Closest approach of the column to the camera→player segment, in plan.
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.z - az) * dz) / len2));
      const cx = ax + dx * t, cz = az + dz * t;
      const d = Math.hypot(p.x - cx, p.z - cz);
      // Only fade the stretch actually in front of the player.
      const blocking = t > 0.05 && t < 0.995 && d < p.radius + 1.5;
      const want = blocking ? 0.12 : 1;
      const cur = this._fadeState[i];
      if (Math.abs(want - cur) > 0.004) {
        const next = cur + (want - cur) * (1 - Math.exp(-dt * 11));
        this._fadeState[i] = next;
        this.pillarFade.setX(i, next);
        dirty = true;
      }
    }
    if (dirty) this.pillarFade.needsUpdate = true;
  }

  _buildFixtures() {
    const lampColor = new THREE.Color(this.theme.lampColor);

    // Pendant lamps: brass shade, a bulb that hangs proud of the opening, a
    // halo so they read as light sources from the game's high camera, and a
    // per-instance-scaled cord that actually reaches the ceiling.
    const pendants = this.layout.lamps.filter((l) => l.kind === 'pendant' || l.kind === 'globe' || l.kind === 'spot');
    if (pendants.length) {
      const H = this.layout.ceilingHeight;
      const shade = mergeParts([
        cyl(0.06, 0.42, 0.34, 18, 0, -0.17, 0),
        cyl(0.13, 0.13, 0.07, 12, 0, 0.03, 0),
      ]);
      const cord = mergeParts([cyl(0.018, 0.018, 1, 6, 0, 0.5, 0)]);
      const bulb = ensureColorAttr(new THREE.SphereGeometry(0.13, 14, 10).translate(0, -0.3, 0));
      // A downward-facing disc inside the shade: from the game's high camera you
      // can't see the bulb, but you can see the lit interior and its bloom.
      const dish = ensureColorAttr(new THREE.CircleGeometry(0.37, 20).rotateX(Math.PI / 2).translate(0, -0.28, 0));

      const mkInst = (geo, mat, shadow = false) => {
        const m = new THREE.InstancedMesh(geo, mat, pendants.length);
        m.castShadow = shadow;
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(pendants.length * 3).fill(1), 3);
        return m;
      };
      const shadeMesh = mkInst(shade, this.mats.brassLamp, true);
      const cordMesh = mkInst(cord, this.mats.metal);
      const bulbMesh = mkInst(bulb, this.mats.lampGlow);
      const dishMesh = mkInst(dish, this.mats.lampGlow);

      pendants.forEach((l, i) => {
        _q.identity();
        _m.compose(_v.set(l.x, l.y, l.z), _q, _s.set(1, 1, 1));
        shadeMesh.setMatrixAt(i, _m);
        bulbMesh.setMatrixAt(i, _m);
        dishMesh.setMatrixAt(i, _m);
        _m.compose(_v.set(l.x, l.y, l.z), _q, _s.set(1, Math.max(0.2, H - l.y), 1));
        cordMesh.setMatrixAt(i, _m);

        const col = l.color ? new THREE.Color(ITEM_COLORS[l.color]?.hex ?? this.theme.lampColor) : lampColor;
        bulbMesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
        dishMesh.instanceColor.setXYZ(i, col.r, col.g, col.b);
        cordMesh.instanceColor.setXYZ(i, 0.35, 0.32, 0.3);
        shadeMesh.instanceColor.setXYZ(i, 1, 1, 1);
      });
      for (const m of [shadeMesh, cordMesh, bulbMesh, dishMesh]) {
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
        m.computeBoundingSphere();
        this.root.add(m);
      }
      this.disposables.push(shade, cord, bulb, dish);
    }

    // Fluorescent / strip lights for archive stacks and carrels.
    const strips = this.layout.lamps.filter((l) => l.kind === 'strip');
    if (strips.length) {
      const g = mergeParts([box(0.3, 0.12, 2.4, 0, 0, 0)]);
      const tube = mergeParts([box(0.22, 0.05, 2.3, 0, -0.07, 0)]);
      const housing = new THREE.InstancedMesh(g, this.mats.metal, strips.length);
      housing.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(strips.length * 3).fill(0.6), 3);
      const glow = new THREE.InstancedMesh(tube, this.mats.lampGlow, strips.length);
      strips.forEach((l, i) => {
        _q.setFromAxisAngle(UP, (i % 2) * Math.PI / 2);
        _m.compose(_v.set(l.x, l.y, l.z), _q, _s.set(1, 1, 1));
        housing.setMatrixAt(i, _m);
        glow.setMatrixAt(i, _m);
      });
      housing.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      housing.computeBoundingSphere(); glow.computeBoundingSphere();
      this.root.add(housing, glow);
      this.disposables.push(g, tube);
    }

    // Chandeliers.
    if (this.layout.chandeliers.length) {
      const arms = [];
      const bulbs = [];
      arms.push(cyl(0.04, 0.04, 2.2, 6, 0, 1.1, 0));
      arms.push(new THREE.TorusGeometry(1, 0.045, 6, 28).rotateX(Math.PI / 2));
      arms.push(new THREE.TorusGeometry(0.6, 0.04, 6, 22).rotateX(Math.PI / 2).translate(0, 0.45, 0));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        arms.push(cyl(0.03, 0.03, 0.28, 6, Math.cos(a), 0.14, Math.sin(a)));
        bulbs.push(new THREE.SphereGeometry(0.09, 10, 8).translate(Math.cos(a), 0.3, Math.sin(a)));
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.3;
        bulbs.push(new THREE.SphereGeometry(0.08, 10, 8).translate(Math.cos(a) * 0.6, 0.72, Math.sin(a) * 0.6));
      }
      const armGeo = mergeParts(arms);
      const bulbGeo = mergeParts(bulbs);
      const list = this.layout.chandeliers;
      const armMesh = new THREE.InstancedMesh(armGeo, this.mats.brass, list.length);
      const bulbMesh = new THREE.InstancedMesh(bulbGeo, this.mats.lampGlow, list.length);
      armMesh.castShadow = true;
      list.forEach((c, i) => {
        const sc = (c.radius || 1.6) / 1.0;
        _q.setFromAxisAngle(UP, i * 0.4);
        _m.compose(_v.set(c.x, c.y - 1.1, c.z), _q, _s.set(sc, sc * 0.9, sc));
        armMesh.setMatrixAt(i, _m);
        bulbMesh.setMatrixAt(i, _m);
      });
      armMesh.instanceMatrix.needsUpdate = true;
      bulbMesh.instanceMatrix.needsUpdate = true;
      armMesh.computeBoundingSphere(); bulbMesh.computeBoundingSphere();
      this.root.add(armMesh, bulbMesh);
      this.disposables.push(armGeo, bulbGeo);
    }
  }

  // --- Lighting -------------------------------------------------------------

  _buildLighting() {
    const t = this.theme;
    const H = this.layout.ceilingHeight;

    this.hemi = new THREE.HemisphereLight(0xbcd4f0, new THREE.Color(t.ambient.color), t.ambient.intensity * 0.9);
    this.root.add(this.hemi);

    this.sun = new THREE.DirectionalLight(t.sun.color, t.sun.intensity);
    this.sun.castShadow = true;
    const S = 26;
    this.sun.shadow.camera.left = -S;
    this.sun.shadow.camera.right = S;
    this.sun.shadow.camera.top = S;
    this.sun.shadow.camera.bottom = -S;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 80;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.root.add(this.sun);
    this.root.add(this.sun.target);

    // A small pooled set of real spotlights supplies the light spill that an
    // emissive pane cannot: window frames, nearby furniture, and the floor now
    // brighten directionally as the player approaches. Pooling keeps the
    // shader cost bounded even though a generated floor may have many windows.
    const windowLightCount = { low: 1, medium: 2, high: 3, ultra: 4 }[this.quality] ?? 2;
    this.windowLightPool = [];
    for (let i = 0; i < windowLightCount; i++) {
      const target = new THREE.Object3D();
      const light = new THREE.SpotLight(t.sun.color, 0, 18, 0.58, 0.76, 1.65);
      light.castShadow = false;
      light.target = target;
      this.root.add(light, target);
      this.windowLightPool.push({ light, target });
    }

    // A pool of real point lights that chase the player and latch onto whatever
    // fixtures are nearest. Everywhere else, emissive geometry + the env probe
    // carry the look.
    const poolSize = this.quality === 'low' ? 3 : this.quality === 'medium' ? 5 : 8;
    this.lightPool = [];
    for (let i = 0; i < poolSize; i++) {
      const l = new THREE.PointLight(t.lampColor, 0, 16, 2);
      l.castShadow = false;
      this.root.add(l);
      this.lightPool.push(l);
    }
    this._fixtures = [
      ...this.layout.lamps.map((l) => ({ x: l.x, y: l.y, z: l.z, power: l.kind === 'strip' ? 9 : 14, color: l.color })),
      ...this.layout.chandeliers.map((c) => ({ x: c.x, y: c.y, z: c.z, power: 30 })),
    ];

    // A dedicated warm key light on the player keeps the hero readable.
    this.keyLight = new THREE.PointLight(0xffd7a8, 12, 12, 2);
    this.root.add(this.keyLight);
  }

  _buildAtmosphere() {
    const count = { low: 300, medium: 700, high: 1400, ultra: 2400 }[this.quality] ?? 900;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const scale = new Float32Array(count);
    this._moteSeed = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = Math.random() * 6 + 0.4;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 44;
      scale[i] = 0.4 + Math.random() * 1.4;
      this._moteSeed[i * 3] = Math.random() * 100;
      this._moteSeed[i * 3 + 1] = 0.2 + Math.random() * 0.6;
      this._moteSeed[i * 3 + 2] = Math.random() * 6.28;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));

    const mat = new THREE.PointsMaterial({
      size: 0.055,
      map: TX.moteSprite(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      toneMapped: false,
      color: 0xffe9c4,
    });
    this.motes = new THREE.Points(g, mat);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 6;
    this.root.add(this.motes);
    this.disposables.push(g);
    this._motePos = pos;
    this._moteCount = count;

    if (this.layout.outdoor) {
      const fogGeo = new THREE.PlaneGeometry(18, 10);
      const fogMat = new THREE.MeshBasicMaterial({
        map: TX.radialAlpha({ size: 128, power: 1.4, inner: 0.7 }),
        color: 0x9db7c9, transparent: true, opacity: 0.12,
        depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      this.groundFog = [];
      for (let i = 0; i < 22; i++) {
        const fog = new THREE.Mesh(fogGeo, fogMat);
        fog.rotation.x = -Math.PI / 2;
        fog.rotation.z = Math.random() * Math.PI;
        fog.position.set(Math.random() * this.layout.width, 0.16 + Math.random() * 0.18, Math.random() * this.layout.depth);
        fog.scale.set(0.7 + Math.random(), 0.7 + Math.random(), 1);
        fog.userData.phase = Math.random() * 6.28;
        this.root.add(fog); this.groundFog.push(fog);
      }
      this.disposables.push(fogGeo, fogMat);
    }
  }

  // --- Per-frame ------------------------------------------------------------

  update(dt, player, cameraPos = null) {
    this.time += dt;
    const px = player.x, pz = player.z;
    if (cameraPos) this._camPos = cameraPos;

    // Sun / shadow frustum rides with the player.
    this.sun.position.set(px - 24, 42, pz - 30);
    this.sun.target.position.set(px, 0, pz);
    this.sun.target.updateMatrixWorld();
    this.sun.shadow.camera.updateProjectionMatrix();

    this.keyLight.position.set(px, 2.6, pz + 0.4);

    // Re-latch point lights onto the nearest fixtures.
    this._retargetLights(px, pz);
    this._retargetWindowLights(px, pz);

    // Dust drifts and stays boxed around the camera.
    const pos = this._motePos;
    const seed = this._moteSeed;
    const t = this.time;
    for (let i = 0; i < this._moteCount; i++) {
      const i3 = i * 3;
      pos[i3 + 1] += seed[i3 + 1] * 0.06 * dt;
      pos[i3] += Math.sin(t * 0.4 + seed[i3 + 2]) * 0.05 * dt * 8;
      pos[i3 + 2] += Math.cos(t * 0.33 + seed[i3]) * 0.05 * dt * 8;
      if (pos[i3 + 1] > 7.5) pos[i3 + 1] = 0.2;
      // Wrap into a box centered on the player.
      const dx = pos[i3] - px;
      const dz = pos[i3 + 2] - pz;
      if (dx > 22) pos[i3] -= 44; else if (dx < -22) pos[i3] += 44;
      if (dz > 22) pos[i3 + 2] -= 44; else if (dz < -22) pos[i3 + 2] += 44;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;

    if (this.groundFog) for (let i = 0; i < this.groundFog.length; i++) {
      const fog = this.groundFog[i];
      fog.position.x += Math.sin(this.time * 0.08 + fog.userData.phase) * dt * 0.12;
      fog.material.opacity = 0.1 + Math.sin(this.time * 0.2 + i) * 0.025;
    }

    // Shafts breathe very slightly. Each keeps its own base opacity — the
    // skylight column is far subtler than a window beam.
    if (this.shafts) {
      const pulse = 1 + Math.sin(this.time * 0.35) * 0.16;
      for (const s of this.shafts) {
        if (s.userData.baseOpacity === undefined) s.userData.baseOpacity = s.material.opacity;
        s.material.opacity = s.userData.baseOpacity * pulse;
      }
    }
    if (this.windowShaftMaterial) {
      this.windowShaftMaterial.uniforms.uPulse.value = 0.97 + Math.sin(this.time * 0.22) * 0.03;
    }

    // Empty-shelf glow pulse.
    this.mats.glowStrip.opacity = 0.42 + Math.sin(this.time * 2.4) * 0.16;

    this._updateOcclusion(dt, player);
  }

  _retargetLights(px, pz) {
    const fixtures = this._fixtures;
    if (!fixtures.length) return;
    // Cheap partial scan: check a rolling window each frame instead of all.
    this._scanCursor = (this._scanCursor || 0);
    const best = this._bestFixtures || (this._bestFixtures = []);
    if (this.time - (this._lastScan || -1) > 0.25) {
      this._lastScan = this.time;
      best.length = 0;
      for (const f of fixtures) {
        const d = (f.x - px) ** 2 + (f.z - pz) ** 2;
        if (d > 400) continue;
        best.push({ f, d });
      }
      best.sort((a, b) => a.d - b.d);
    }
    for (let i = 0; i < this.lightPool.length; i++) {
      const l = this.lightPool[i];
      const e = best[i];
      if (!e) { l.intensity = 0; continue; }
      l.position.set(e.f.x, e.f.y - 0.25, e.f.z);
      const fade = 1 - Math.min(1, Math.sqrt(e.d) / 20);
      l.intensity = e.f.power * fade;
      l.distance = 15;
      if (e.f.color && ITEM_COLORS[e.f.color]) l.color.setHex(ITEM_COLORS[e.f.color].hex);
      else l.color.setHex(this.theme.lampColor);
    }
  }

  _retargetWindowLights(px, pz) {
    if (!this.windowLightPool?.length || !this.layout.windows.length) return;
    if (this.time - (this._lastWindowScan || -1) > 0.22) {
      this._lastWindowScan = this.time;
      this._bestWindows = this.layout.windows
        .map((w, index) => ({ w, index, d: (w.x - px) ** 2 + (w.z - pz) ** 2 }))
        .filter((entry) => entry.d < 26 * 26)
        .sort((a, b) => a.d - b.d || a.index - b.index)
        .slice(0, this.windowLightPool.length);
    }

    const baseIntensity = 56 * Math.max(0.7, this.theme.sun.intensity);
    for (let i = 0; i < this.windowLightPool.length; i++) {
      const { light, target } = this.windowLightPool[i];
      const entry = this._bestWindows?.[i];
      if (!entry) { light.intensity = 0; continue; }
      const { w, d } = entry;
      const distance = Math.sqrt(d);
      const fade = THREE.MathUtils.smoothstep(26 - distance, 0, 20);
      light.position.set(
        w.x + w.normal[0] * 0.38,
        w.y + w.h * 0.08,
        w.z + w.normal[1] * 0.38,
      );
      target.position.set(
        w.x + w.normal[0] * 7.2,
        0.12,
        w.z + w.normal[1] * 7.2,
      );
      target.updateMatrixWorld();
      light.intensity = baseIntensity * fade;
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.isInstancedMesh) { o.dispose?.(); }
    });
    this.scene.remove(this.root);
    for (const d of this.disposables) d.dispose?.();
    this.disposables.length = 0;
  }
}

function makeWindowPaneMaterial(theme) {
  const zenith = new THREE.Color(theme.envPalette?.sky ?? 0xa9d4ff).multiplyScalar(1.85);
  const horizon = new THREE.Color(theme.sun.color)
    .lerp(new THREE.Color(0xfff3dc), 0.58)
    .multiplyScalar(1.55);
  return new THREE.ShaderMaterial({
    name: 'window-daylight-pane',
    uniforms: {
      uZenith: { value: zenith },
      uHorizon: { value: horizon },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      varying vec2 vUv;
      varying vec3 vWorldNormal;
      varying vec3 vWorldPosition;
      void main() {
        float vertical = smoothstep(0.04, 0.96, vUv.y);
        vec3 daylight = mix(uHorizon, uZenith, vertical);
        float edgeX = smoothstep(0.0, 0.13, vUv.x) * smoothstep(0.0, 0.13, 1.0 - vUv.x);
        float edgeY = smoothstep(0.0, 0.10, vUv.y) * smoothstep(0.0, 0.10, 1.0 - vUv.y);
        float softFrame = 0.82 + 0.18 * edgeX * edgeY;
        vec3 toEye = normalize(cameraPosition - vWorldPosition);
        float grazing = pow(1.0 - abs(dot(normalize(vWorldNormal), toEye)), 2.0);
        float skyVariation = 0.96 + 0.04 * sin(vUv.y * 18.0 + vUv.x * 5.0);
        gl_FragColor = vec4(daylight * softFrame * skyVariation * (1.0 + grazing * 0.12), 1.0);
      }
    `,
    side: THREE.DoubleSide,
    depthWrite: true,
    toneMapped: false,
  });
}

function makeWindowShaftMaterial(theme) {
  const color = new THREE.Color(theme.sun.color)
    .lerp(new THREE.Color(0xffefd2), 0.62)
    .multiplyScalar(1.2);
  return new THREE.ShaderMaterial({
    name: 'window-daylight-volume',
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: 0.092 },
      uPulse: { value: 1 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uPulse;
      varying vec2 vUv;
      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      void main() {
        float edge = smoothstep(0.0, 0.28, vUv.x) * smoothstep(0.0, 0.28, 1.0 - vUv.x);
        float farFade = smoothstep(0.0, 0.24, vUv.y);
        float nearFade = 1.0 - smoothstep(0.84, 1.0, vUv.y) * 0.54;
        float grain = mix(0.94, 1.06, hash21(floor(vUv * vec2(90.0, 150.0))));
        float alpha = uOpacity * uPulse * edge * farFade * nearFade * grain;
        if (alpha < 0.001) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

// --- Geometry helpers -------------------------------------------------------

const _v2pos = new THREE.Vector3();
const _e2 = new THREE.Euler();

// Item rows leave headroom under each board so the joinery reads.
const ROW_HEIGHT = 0.66;

function tierGap(st) {
  return (st.height - st.toe - st.crown) / st.tiers;
}

/** World matrix for bay `i` of `run`, with an optional local offset. */
function placeBay(out, run, i, dx, dz) {
  const bayCount = run.bays.length / (run.doubleSided ? 2 : 1);
  const along = (i + 0.5 - bayCount / 2) * BAY_WIDTH;
  const cos = Math.cos(run.angle), sin = Math.sin(run.angle);
  const wx = run.x + cos * (along + dx) - sin * dz;
  const wz = run.z + sin * (along + dx) + cos * dz;
  _q.setFromAxisAngle(UP, run.angle);
  out.compose(_v2pos.set(wx, 0, wz), _q, _s.set(1, 1, 1));
  return out;
}

/**
 * Compose a matrix for something sitting inside bay `i` at local (along, y,
 * across), scaled by (sx, sy, sz). `faceFlip` turns a quad to face outward.
 */
function composeLocal(out, run, i, along, y, across, sx, sy, sz, faceFlip = 0, lean = 0) {
  const bayCount = run.bays.length / (run.doubleSided ? 2 : 1);
  const base = (i + 0.5 - bayCount / 2) * BAY_WIDTH;
  const cos = Math.cos(run.angle), sin = Math.sin(run.angle);
  const lx = base + along;
  const wx = run.x + cos * lx - sin * across;
  const wz = run.z + sin * lx + cos * across;
  const yaw = run.angle + (faceFlip === -1 ? Math.PI : 0);
  if (lean) {
    _e2.set(0, yaw, lean, 'YXZ');
    _q.setFromEuler(_e2);
  } else {
    _q.setFromAxisAngle(UP, yaw);
  }
  out.compose(_v2pos.set(wx, y, wz), _q, _s.set(Math.max(sx, 0.0001), sy, sz));
  return out;
}

/** Stable 0..1 hash for per-instance variation that survives reloads. */
function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** How deep an item row is for a given carcass. */
function itemRowDepth(st, theme) {
  const avail = st.doubleSided ? st.depth / 2 - 0.02 : st.depth - 0.03;
  return Math.min(theme.itemSize.d * 1.15, avail - 0.06);
}

/** One bay of shelving: divider, plinth, boards, back, crown. */
export function buildCarcassGeometry(st, theme) {
  const w = BAY_WIDTH;
  const d = st.depth;
  const gap = tierGap(st);
  const parts = [];

  // Left divider (bays butt together to form a continuous run).
  parts.push(box(st.sideT, st.height, d, -w / 2 + st.sideT / 2, st.height / 2, 0));
  // Plinth
  parts.push(box(w, st.toe, d * 0.96, 0, st.toe / 2, 0));
  // Boards
  for (let t = 0; t <= st.tiers; t++) {
    const y = st.toe + t * gap;
    if (y > st.height - st.crown + 0.001) break;
    parts.push(box(w - st.sideT, st.boardT, d - 0.02, st.sideT / 2, y + st.boardT / 2, 0));
  }
  // Back / center divider
  if (st.doubleSided) {
    parts.push(box(w, st.height - st.toe - st.crown, 0.028, 0, st.toe + (st.height - st.toe - st.crown) / 2, 0));
  } else {
    parts.push(box(w, st.height - st.toe - st.crown, 0.024, 0, st.toe + (st.height - st.toe - st.crown) / 2, -d / 2 + 0.014));
  }
  // Crown
  parts.push(box(w, st.crown, d + 0.05, 0, st.height - st.crown / 2, 0));
  parts.push(box(w, st.crown * 0.35, d + 0.09, 0, st.height - st.crown * 1.1, 0));

  if (theme.id === 'videostore') {
    // Broad header marquees and thin wire ledges make these read as video racks.
    parts.push(box(w * 0.92, Math.min(0.22, st.crown * 1.5), d + 0.12, st.sideT / 2, st.height - st.crown * 1.75, 0, 0, 0, 0, 0.025));
    for (let t = 0; t < st.tiers; t++) {
      const y = st.toe + (t + 0.15) * gap;
      parts.push(box(w - st.sideT * 1.4, 0.035, 0.045, st.sideT / 2, y, d / 2 + 0.025));
      if (st.doubleSided) parts.push(box(w - st.sideT * 1.4, 0.035, 0.045, st.sideT / 2, y, -d / 2 - 0.025));
    }
  } else if (theme.id === 'recordstore') {
    // Deep browsable lips and dividers evoke square LP bins, not bookcases.
    for (let t = 0; t < st.tiers; t++) {
      const y = st.toe + t * gap + st.boardT + 0.055;
      parts.push(box(w - st.sideT, 0.11, 0.06, st.sideT / 2, y, d / 2 + 0.015));
      if (st.doubleSided) parts.push(box(w - st.sideT, 0.11, 0.06, st.sideT / 2, y, -d / 2 - 0.015));
      parts.push(box(0.035, gap * 0.58, d * 0.88, 0.12, y + gap * 0.28, 0));
    }
  } else if (theme.id === 'grocery') {
    // Metal price rails and a shallow top canopy define supermarket gondolas.
    parts.push(box(w, 0.2, d + 0.16, 0, st.height - st.crown * 1.6, 0, 0, 0, 0, 0.025));
    for (let t = 0; t < st.tiers; t++) {
      const y = st.toe + t * gap + st.boardT + 0.035;
      parts.push(box(w - st.sideT, 0.065, 0.045, st.sideT / 2, y, d / 2 + 0.035));
      if (st.doubleSided) parts.push(box(w - st.sideT, 0.065, 0.045, st.sideT / 2, y, -d / 2 - 0.035));
    }
  }

  return mergeParts(parts);
}

/**
 * A row of items on one tier, drawn as a single box. `uOffset` slides the spine
 * strip so neighboring rows never show the same books.
 */
export function buildShelfItemRowGeometry(theme, w, h, d, uOffset = 0.05) {
  if (theme.id === 'videostore') return buildVhsRowGeometry(w, h, d);
  if (theme.id === 'recordstore') return buildRecordRowGeometry(w, h, d);
  if (theme.id === 'grocery') return buildGroceryRowGeometry(w, h, d);

  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // Faces are ordered +X, -X, +Y, -Y, +Z, -Z with four vertices each.
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      let u = uv.getX(i);
      let v = uv.getY(i);
      if (f === 4 || f === 5) {
        v = v * 0.84;            // spine region
        u = u + uOffset;
      } else {
        v = 0.885 + v * 0.1;     // page-edge band
        u = u * 0.4 + uOffset;
      }
      uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;
  const n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  g.name = 'shelf-row-bound-books';
  g.userData.itemKind = 'book';
  return g;
}

function buildVhsRowGeometry(w, h, d) {
  const parts = [];
  const count = 6;
  const pitch = w / count;
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + pitch * (i + 0.5);
    const lean = (i % 3 - 1) * 0.025;
    parts.push(box(pitch * 0.78, h * (0.88 + (i % 2) * 0.06), d * 0.82, x, 0, 0, 0, 0, lean, 0.012));
    parts.push(box(pitch * 0.5, h * 0.48, Math.max(0.012, d * 0.08), x, 0, d * 0.46, 0, 0, lean, 0.008));
  }
  const geometry = mergeParts(parts);
  geometry.name = 'shelf-row-vhs-cases';
  geometry.userData.itemKind = 'vhs';
  return geometry;
}

function buildRecordRowGeometry(w, h, d) {
  const parts = [];
  const count = 3;
  const pitch = w / count;
  const side = Math.min(h * 0.94, pitch * 0.9);
  for (let i = 0; i < count; i++) {
    const x = -w / 2 + pitch * (i + 0.5);
    const lean = (i - 1) * 0.035;
    parts.push(box(side, side, d * 0.72, x, -h * 0.04, 0, 0, 0, lean, 0.008));
    parts.push(cyl(side * 0.31, side * 0.31, Math.max(0.012, d * 0.06), 18, x, -h * 0.04, d * 0.4, Math.PI / 2));
  }
  const geometry = mergeParts(parts);
  geometry.name = 'shelf-row-record-sleeves';
  geometry.userData.itemKind = 'record';
  return geometry;
}

function buildGroceryRowGeometry(w, h, d) {
  const parts = [];
  const pitch = w / 5;
  for (let i = 0; i < 5; i++) {
    const x = -w / 2 + pitch * (i + 0.5);
    if (i % 2 === 0) {
      const rh = h * (0.58 + i * 0.055);
      parts.push(cyl(pitch * 0.29, pitch * 0.31, rh, 10, x, -h / 2 + rh / 2, 0));
      parts.push(cyl(pitch * 0.31, pitch * 0.31, 0.018, 10, x, -h / 2 + rh, 0));
    } else {
      const bh = h * (0.76 + (i % 3) * 0.08);
      parts.push(box(pitch * 0.68, bh, d * (0.65 + i * 0.035), x, -h / 2 + bh / 2, 0, 0, 0, (i - 2) * 0.018, 0.012));
    }
  }
  const geometry = mergeParts(parts);
  geometry.name = 'shelf-row-packaged-groceries';
  geometry.userData.itemKind = 'grocery';
  return geometry;
}


/**
 * Clone a material so it dissolves per instance via an `aFade` attribute.
 *
 * A screen-space 4x4 Bayer threshold means the column breaks up into a stipple
 * rather than blinking out, which stays readable and costs nothing — no
 * transparency, no sorting, no extra draw call.
 */
function makeFadeMaterial(source) {
  const mat = source.clone();
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFade = aFade;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vFade;
const mat4 BAYER = mat4(
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vFade < 0.999) {
    ivec2 px = ivec2(mod(gl_FragCoord.xy, 4.0));
    float threshold = (BAYER[px.x][px.y] + 0.5) / 16.0;
    if (vFade < threshold) discard;
  }`);
  };
  mat.customProgramCacheKey = () => 'dither-fade';
  return mat;
}
