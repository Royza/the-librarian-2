import * as THREE from 'three';
import * as TX from '../render/textures.js';
import { ensureColorAttr } from '../world/props.js';

const MAX_PARTICLES = 3000;
const MAX_RINGS = 24;
const MAX_DECALS = 64;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * All the sparks, dust, rings, beams and floor decals. Pools everything so a
 * volcano eruption never allocates.
 */
export class FX {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.time = 0;

    // --- particles
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pSize = new Float32Array(MAX_PARTICLES);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    geo.setDrawRange(0, 0);

    const mat = new THREE.PointsMaterial({
      size: 1.0, map: TX.moteSprite(), vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      sizeAttenuation: true, toneMapped: false, opacity: 1,
    });
    // Per-particle size: patch the one point-size line rather than write a
    // whole custom material, so fog and the standard uniforms still work.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = 'attribute float aSize;\n' + shader.vertexShader
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    };
    mat.customProgramCacheKey = () => 'fx-points-sized';
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
    this.pGeo = geo;
    this.pMat = mat;

    this.particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ a: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1, r: 1, g: 1, b: 1, grav: -6, drag: 0.98, fade: 1 });
    }
    this.pCursor = 0;

    // --- expanding rings (shockwaves, pulses, AOE telegraphs)
    const ringGeo = ensureColorAttr(new THREE.RingGeometry(0.72, 1, 64).rotateX(-Math.PI / 2));
    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: true, toneMapped: false,
    });
    this.rings = new THREE.InstancedMesh(ringGeo, this.ringMat, MAX_RINGS);
    this.rings.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_RINGS * 3), 3);
    this.rings.frustumCulled = false;
    this.rings.count = 0;
    this.rings.renderOrder = 7;
    scene.add(this.rings);
    this.ringGeo = ringGeo;
    this.ringPool = Array.from({ length: MAX_RINGS }, () => ({ a: false, x: 0, y: 0, z: 0, t: 0, dur: 1, r0: 0, r1: 6, color: new THREE.Color(1, 1, 1), thick: 1 }));

    // --- floor decals (vomit, scorch, puddles)
    const decGeo = ensureColorAttr(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
    this.decalMat = new THREE.MeshStandardMaterial({
      map: TX.radialAlpha({ power: 1.1 }),
      transparent: true, depthWrite: false, roughness: 0.35, metalness: 0,
      vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    });
    this.decals = new THREE.InstancedMesh(decGeo, this.decalMat, MAX_DECALS);
    this.decals.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DECALS * 3), 3);
    this.decals.frustumCulled = false;
    this.decals.count = 0;
    this.decals.receiveShadow = false;
    scene.add(this.decals);
    this.decGeo = decGeo;
    this.decalList = [];

    // --- beams (gravity gun, tractor beam)
    this.beamMat = new THREE.MeshBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
    this.beams = [];

    // --- world-space label sprites are DOM; see ui/hud.js
    this.popups = [];
  }

  // --- particles ------------------------------------------------------------

  emit(x, y, z, opts = {}) {
    const p = this.particles[this.pCursor];
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    p.a = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = opts.vx ?? 0; p.vy = opts.vy ?? 0; p.vz = opts.vz ?? 0;
    p.max = p.life = opts.life ?? 0.8;
    p.size = opts.size ?? 0.2;
    p.grav = opts.grav ?? -6;
    p.drag = opts.drag ?? 0.96;
    p.fade = opts.fade ?? 1;
    const col = opts.color ?? 0xffffff;
    _c.setHex(col);
    p.r = _c.r; p.g = _c.g; p.b = _c.b;
    return p;
  }

  burst(x, y, z, count, opts = {}) {
    const spd = opts.speed ?? 4;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = opts.cone ? (Math.random() * opts.cone) : Math.acos(1 - 2 * Math.random());
      const s = spd * (0.4 + Math.random() * 0.8);
      this.emit(x, y, z, {
        vx: Math.sin(e) * Math.cos(a) * s,
        vy: Math.abs(Math.cos(e)) * s * (opts.up ?? 1),
        vz: Math.sin(e) * Math.sin(a) * s,
        life: (opts.life ?? 0.7) * (0.6 + Math.random() * 0.8),
        size: (opts.size ?? 0.2) * (0.6 + Math.random() * 0.9),
        color: Array.isArray(opts.color) ? opts.color[(Math.random() * opts.color.length) | 0] : opts.color,
        grav: opts.grav ?? -6,
        drag: opts.drag ?? 0.96,
      });
    }
  }

  dashBurst(x, y, z, yaw) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    for (let i = 0; i < 22; i++) {
      this.emit(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.8, z + (Math.random() - 0.5) * 0.5, {
        vx: fx * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2,
        vy: Math.random() * 1.4,
        vz: fz * (2 + Math.random() * 3) + (Math.random() - 0.5) * 2,
        life: 0.4 + Math.random() * 0.3, size: 0.16, color: 0xfff0d0, grav: -1.5, drag: 0.9,
      });
    }
    this.ring(x, 0.05, z, { r0: 0.2, r1: 2.6, dur: 0.4, color: 0xffe0a0 });
  }

  fizz(x, y, z) {
    this.burst(x, y, z, 40, { speed: 5, color: [0xffffff, 0xbfe4ff, 0x8ec8ff], life: 0.9, size: 0.14, grav: -5 });
  }

  sparkle(x, y, z, color, n = 10) {
    this.burst(x, y, z, n, { speed: 2.2, color, life: 0.55, size: 0.13, grav: -2, up: 0.6 });
  }

  // --- rings ----------------------------------------------------------------

  ring(x, y, z, { r0 = 0.4, r1 = 6, dur = 0.6, color = 0xffffff, thick = 1 } = {}) {
    const r = this.ringPool.find((p) => !p.a);
    if (!r) return null;
    r.a = true; r.x = x; r.y = y; r.z = z; r.t = 0; r.dur = dur;
    r.r0 = r0; r.r1 = r1; r.thick = thick;
    r.color.setHex(color);
    return r;
  }

  // --- decals ---------------------------------------------------------------

  addDecal(x, z, { size = 2, color = 0x6aa02a, life = Infinity, roughness = 0.2 } = {}) {
    if (this.decalList.length >= MAX_DECALS) this.decalList.shift();
    const d = { x, z, size, color: new THREE.Color(color), life, max: life, t: 0, scale: 0 };
    this.decalList.push(d);
    return d;
  }

  removeDecal(d) {
    const i = this.decalList.indexOf(d);
    if (i >= 0) this.decalList.splice(i, 1);
  }

  // --- beams ----------------------------------------------------------------

  createBeam(color = 0x9fd8ff, radius = 0.22) {
    const geo = new THREE.CylinderGeometry(radius, radius * 0.55, 1, 12, 1, true);
    geo.translate(0, 0.5, 0);
    geo.rotateX(Math.PI / 2);
    const mat = this.beamMat.clone();
    mat.color.setHex(color);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.visible = false;
    mesh.renderOrder = 7;
    this.scene.add(mesh);
    const beam = { mesh, geo, mat };
    this.beams.push(beam);
    return beam;
  }

  setBeam(beam, from, to, intensity = 1) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.05 || intensity <= 0) { beam.mesh.visible = false; return; }
    beam.mesh.visible = true;
    beam.mesh.position.set(from.x, from.y, from.z);
    beam.mesh.lookAt(to.x, to.y, to.z);
    beam.mesh.scale.set(1 + Math.sin(this.time * 40) * 0.15, 1 + Math.cos(this.time * 33) * 0.15, len);
    beam.mat.opacity = 0.45 * intensity + Math.sin(this.time * 25) * 0.1 * intensity;
  }

  hideBeam(beam) { if (beam) beam.mesh.visible = false; }

  // --- update ---------------------------------------------------------------

  update(dt) {
    this.time += dt;

    // particles
    let n = 0;
    const pos = this.pPos, col = this.pCol, siz = this.pSize;
    for (const p of this.particles) {
      if (!p.a) continue;
      p.life -= dt;
      if (p.life <= 0) { p.a = false; continue; }
      p.vy += p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.7; p.vz *= 0.7; }

      const t = p.life / p.max;
      const i3 = n * 3;
      pos[i3] = p.x; pos[i3 + 1] = p.y; pos[i3 + 2] = p.z;
      const f = Math.pow(t, p.fade);
      col[i3] = p.r * f; col[i3 + 1] = p.g * f; col[i3 + 2] = p.b * f;
      siz[n] = p.size * (0.4 + t * 0.8);
      n++;
      if (n >= MAX_PARTICLES) break;
    }
    this.pGeo.setDrawRange(0, n);
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.color.needsUpdate = true;
    this.pGeo.attributes.aSize.needsUpdate = true;
    if (n > 0) this.pGeo.computeBoundingSphere();

    // rings
    let rc = 0;
    for (const r of this.ringPool) {
      if (!r.a) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) { r.a = false; continue; }
      const rad = r.r0 + (r.r1 - r.r0) * easeOutCubic(k);
      _q.identity();
      _m.compose(_v.set(r.x, r.y, r.z), _q, _s.set(rad, 1, rad));
      this.rings.setMatrixAt(rc, _m);
      const fade = (1 - k) * (1 - k);
      this.rings.instanceColor.setXYZ(rc, r.color.r * fade, r.color.g * fade, r.color.b * fade);
      rc++;
    }
    this.rings.count = rc;
    this.rings.instanceMatrix.needsUpdate = true;
    this.rings.instanceColor.needsUpdate = true;

    // decals
    let dc = 0;
    for (let i = this.decalList.length - 1; i >= 0; i--) {
      const d = this.decalList[i];
      d.t += dt;
      d.scale += (1 - d.scale) * (1 - Math.exp(-dt * 6));
      if (d.life !== Infinity) {
        d.life -= dt;
        if (d.life <= 0) { this.decalList.splice(i, 1); continue; }
      }
      const fade = d.life === Infinity ? 1 : Math.min(1, d.life / Math.min(1.2, d.max));
      _q.identity();
      const sc = d.size * d.scale;
      _m.compose(_v.set(d.x, 0.018, d.z), _q, _s.set(sc, 1, sc));
      this.decals.setMatrixAt(dc, _m);
      this.decals.instanceColor.setXYZ(dc, d.color.r * fade, d.color.g * fade, d.color.b * fade);
      dc++;
      if (dc >= MAX_DECALS) break;
    }
    this.decals.count = dc;
    this.decals.instanceMatrix.needsUpdate = true;
    this.decals.instanceColor.needsUpdate = true;
  }

  clear() {
    for (const p of this.particles) p.a = false;
    for (const r of this.ringPool) r.a = false;
    this.decalList.length = 0;
    for (const b of this.beams) b.mesh.visible = false;
  }

  dispose() {
    this.scene.remove(this.points, this.rings, this.decals);
    this.pGeo.dispose(); this.pMat.dispose();
    this.ringGeo.dispose(); this.ringMat.dispose();
    this.decGeo.dispose(); this.decalMat.dispose();
    for (const b of this.beams) { this.scene.remove(b.mesh); b.geo.dispose(); b.mat.dispose(); }
    this.beams.length = 0;
  }
}

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
