import * as THREE from 'three';
import { box, cyl, sphere, mergeParts, ensureColorAttr } from '../world/props.js';

// ---------------------------------------------------------------------------
// Procedural humanoids.
//
// One skeleton definition drives both the hero (a real Object3D hierarchy, so
// it can carry unique props) and the crowd (InstancedMeshes, so thirty kids
// cost the same nine draw calls as one).
//
// Poses are computed on the CPU into a flat matrix list — no skinning, no
// animation clips, no asset pipeline.
// ---------------------------------------------------------------------------

export const BONE = {
  HIPS: 0, TORSO: 1, HEAD: 2, HAIR: 3,
  ARM_U_L: 4, ARM_U_R: 5, ARM_L_L: 6, ARM_L_R: 7,
  LEG_U_L: 8, LEG_U_R: 9, LEG_L_L: 10, LEG_L_R: 11,
  SHOE_L: 12, SHOE_R: 13, HAND_L: 14, HAND_R: 15,
};
export const BONE_COUNT = 16;

// Proportions are expressed as fractions of total height so one rig covers a
// 1.05 m first-grader and a 1.9 m hall monitor.
function proportions(h, chunk = 1) {
  const legU = h * 0.235, legL = h * 0.225;
  const torso = h * 0.27, neck = h * 0.035;
  const headR = h * 0.088 * (1 + (1 - Math.min(h / 1.75, 1)) * 0.5); // kids get big heads
  const armU = h * 0.175, armL = h * 0.165;
  const torsoW = h * 0.225 * chunk;
  const limbR = h * 0.046 * chunk;
  return {
    h, chunk, limbR,
    legR: h * 0.058 * chunk,
    hipY: legU + legL + h * 0.02,
    legU, legL, torso, neck, headR, armU, armL,
    // Shoulders sit just outside the ribcage, not on its centreline.
    shoulderW: torsoW * 0.5 + limbR * 0.82,
    hipW: h * 0.062 * chunk,
    torsoW,
    torsoD: h * 0.135 * chunk,
  };
}

const SPEC = [
  { i: BONE.HIPS, parent: -1 },
  { i: BONE.TORSO, parent: BONE.HIPS },
  { i: BONE.HEAD, parent: BONE.TORSO },
  { i: BONE.HAIR, parent: BONE.HEAD },
  { i: BONE.ARM_U_L, parent: BONE.TORSO },
  { i: BONE.ARM_U_R, parent: BONE.TORSO },
  { i: BONE.ARM_L_L, parent: BONE.ARM_U_L },
  { i: BONE.ARM_L_R, parent: BONE.ARM_U_R },
  { i: BONE.HAND_L, parent: BONE.ARM_L_L },
  { i: BONE.HAND_R, parent: BONE.ARM_L_R },
  { i: BONE.LEG_U_L, parent: BONE.HIPS },
  { i: BONE.LEG_U_R, parent: BONE.HIPS },
  { i: BONE.LEG_L_L, parent: BONE.LEG_U_L },
  { i: BONE.LEG_L_R, parent: BONE.LEG_U_R },
  { i: BONE.SHOE_L, parent: BONE.LEG_L_L },
  { i: BONE.SHOE_R, parent: BONE.LEG_L_R },
];

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _mtmp = new THREE.Matrix4();

/**
 * Fill `out` (array of 16 Matrix4) with world transforms for one character.
 *
 * `anim` drives everything: phase advances with distance travelled so feet
 * never skate, and the extra channels (lean, flail, hurt) layer on top.
 */
export function poseSkeleton(out, p, anim, rootMatrix) {
  const {
    phase = 0, speed = 0, lean = 0, armMode = 'swing', headYaw = 0, headPitch = 0,
    flail = 0, crouch = 0, hurt = 0, celebrate = 0, reach = 0, sit = 0,
  } = anim;

  const stride = Math.min(1, speed / 4.2);
  const sw = Math.sin(phase) * stride;
  const cw = Math.cos(phase) * stride;
  const bob = Math.abs(Math.sin(phase)) * 0.035 * stride * p.h;
  const sag = crouch * p.h * 0.12 + sit * p.h * 0.22;

  const local = [];
  const set = (i, x, y, z, rx = 0, ry = 0, rz = 0) => {
    _e.set(rx, ry, rz, 'YXZ');
    _q.setFromEuler(_e);
    local[i] = new THREE.Matrix4().compose(_v.set(x, y, z), _q, _s);
  };

  // --- Root chain
  set(BONE.HIPS, 0, p.hipY + bob - sag, 0,
    lean * 0.12 + crouch * 0.25, sw * 0.12, 0);

  set(BONE.TORSO, 0, 0, 0,
    -lean * 0.22 - crouch * 0.3 + hurt * 0.5 - celebrate * 0.25 + reach * 0.25,
    -sw * 0.16, Math.sin(phase * 2) * 0.02 * stride);

  set(BONE.HEAD, 0, p.torso + p.neck, 0,
    headPitch + celebrate * -0.3 + hurt * 0.4, headYaw, Math.sin(phase * 2 + 1) * 0.03 * stride);

  set(BONE.HAIR, 0, 0, 0, 0, 0, 0);

  // --- Arms
  let aL, aR;
  if (armMode === 'carry') {
    aL = -1.35 + Math.sin(phase * 2) * 0.05;
    aR = -1.35 - Math.sin(phase * 2) * 0.05;
  } else if (armMode === 'overhead') {
    aL = -2.6 + Math.sin(phase * 2) * 0.12;
    aR = -2.6 - Math.sin(phase * 2) * 0.12;
  } else if (armMode === 'reach') {
    aL = -1.6 - reach * 0.4;
    aR = -1.6 - reach * 0.4;
  } else if (armMode === 'panic') {
    aL = -2.2 + Math.sin(phase * 3.3) * 0.7;
    aR = -2.2 + Math.cos(phase * 3.1) * 0.7;
  } else {
    aL = -cw * 0.85;
    aR = cw * 0.85;
  }
  aL += flail * Math.sin(phase * 6) * 0.6;
  aR += flail * Math.cos(phase * 6) * 0.6;
  if (celebrate) { aL -= celebrate * 1.6; aR -= celebrate * 1.6; }

  const shoulderY = p.torso * 0.82;
  set(BONE.ARM_U_L, -p.shoulderW, shoulderY, 0, aL, 0, 0.09 + flail * 0.4);
  set(BONE.ARM_U_R, p.shoulderW, shoulderY, 0, aR, 0, -0.09 - flail * 0.4);

  // Idle arms hang almost straight; the bend only comes in on the swing.
  const elbow = armMode === 'carry' ? -1.15
    : armMode === 'overhead' ? -0.2
      : armMode === 'panic' ? -1.3
        : -0.09 - Math.max(0, cw) * 0.55;
  set(BONE.ARM_L_L, 0, -p.armU, 0, elbow, 0, 0);
  set(BONE.ARM_L_R, 0, -p.armU, 0, elbow, 0, 0);
  set(BONE.HAND_L, 0, -p.armL, 0, 0, 0, 0);
  set(BONE.HAND_R, 0, -p.armL, 0, 0, 0, 0);

  // --- Legs
  const legSwing = 0.95;
  const lU = sit ? -1.5 : sw * legSwing;
  const rU = sit ? -1.5 : -sw * legSwing;
  set(BONE.LEG_U_L, -p.hipW, 0, 0, lU, 0, 0.03);
  set(BONE.LEG_U_R, p.hipW, 0, 0, rU, 0, -0.03);

  const kneeL = sit ? 1.5 : Math.max(0, -sw) * 1.15 + 0.06 + crouch * 0.5;
  const kneeR = sit ? 1.5 : Math.max(0, sw) * 1.15 + 0.06 + crouch * 0.5;
  set(BONE.LEG_L_L, 0, -p.legU, 0, kneeL, 0, 0);
  set(BONE.LEG_L_R, 0, -p.legU, 0, kneeR, 0, 0);

  set(BONE.SHOE_L, 0, -p.legL, 0, -kneeL * 0.5 - lU * 0.3, 0, 0);
  set(BONE.SHOE_R, 0, -p.legL, 0, -kneeR * 0.5 - rU * 0.3, 0, 0);

  // --- Flatten hierarchy
  for (const s of SPEC) {
    const m = out[s.i] || (out[s.i] = new THREE.Matrix4());
    if (s.parent === -1) m.multiplyMatrices(rootMatrix, local[s.i]);
    else m.multiplyMatrices(out[s.parent], local[s.i]);
  }
  return out;
}

// --- Geometry kit -----------------------------------------------------------

/**
 * Body-part geometry for a given build. Pivots sit at the joint so the poser
 * can just rotate them.
 */
export function buildBodyGeometry(p, style = {}) {
  const {
    hair = 'short', glasses = false, apron = false, cardigan = false,
    antenna = false, hat = null, beard = null, sleeves = 'short',
  } = style;
  const g = {};

  g.hips = mergeParts([
    box(p.torsoW * 0.92, p.h * 0.1, p.torsoD * 1.05, 0, p.h * 0.03, 0, 0, 0, 0, p.h * 0.03),
  ]);

  const torsoParts = [
    box(p.torsoW, p.torso, p.torsoD, 0, p.torso / 2, 0, 0, 0, 0, p.h * 0.035),
    // shoulders
    box(p.torsoW * 1.06, p.torso * 0.22, p.torsoD * 1.02, 0, p.torso * 0.86, 0, 0, 0, 0, p.h * 0.03),
  ];
  if (cardigan) {
    torsoParts.push(box(p.torsoW * 1.06, p.torso * 0.92, p.torsoD * 1.1, 0, p.torso * 0.48, 0, 0, 0, 0, p.h * 0.03));
    torsoParts.push(box(p.torsoW * 0.14, p.torso * 0.9, p.torsoD * 1.14, 0, p.torso * 0.48, 0));
  }
  if (apron) torsoParts.push(box(p.torsoW * 0.8, p.torso * 0.7, p.torsoD * 0.2, 0, p.torso * 0.35, p.torsoD * 0.55));
  g.torso = mergeParts(torsoParts);

  const r = p.headR;
  const headParts = [
    sphere(r, 20, 16, 0, r * 0.98, 0),
    box(r * 1.1, r * 0.5, r * 0.9, 0, r * 0.55, r * 0.55, 0, 0, 0, r * 0.2), // jaw
    cyl(r * 0.36, r * 0.4, r * 0.4, 10, 0, r * 0.06, 0),                     // neck
    sphere(r * 0.2, 8, 6, -r * 0.95, r * 1.0, 0),                            // ears
    sphere(r * 0.2, 8, 6, r * 0.95, r * 1.0, 0),
    sphere(r * 0.15, 8, 6, 0, r * 0.95, r * 0.92),                           // nose
  ];
  g.head = mergeParts(headParts);

  g.eyes = mergeParts([
    sphere(r * 0.17, 10, 8, -r * 0.36, r * 1.12, r * 0.8),
    sphere(r * 0.17, 10, 8, r * 0.36, r * 1.12, r * 0.8),
  ]);

  const hairParts = [];
  if (hair === 'short') {
    hairParts.push(sphere(r * 1.06, 18, 14, 0, r * 1.06, -r * 0.05));
    hairParts.push(box(r * 2.0, r * 0.5, r * 1.6, 0, r * 1.45, -r * 0.25, 0, 0, 0, r * 0.2));
  } else if (hair === 'bun') {
    hairParts.push(sphere(r * 1.05, 18, 14, 0, r * 1.08, -r * 0.08));
    hairParts.push(sphere(r * 0.52, 12, 10, 0, r * 1.92, -r * 0.55));
  } else if (hair === 'long') {
    hairParts.push(sphere(r * 1.06, 18, 14, 0, r * 1.05, -r * 0.05));
    hairParts.push(box(r * 1.9, r * 2.4, r * 1.2, 0, r * 0.5, -r * 0.7, 0, 0, 0, r * 0.3));
  } else if (hair === 'spiky') {
    hairParts.push(sphere(r * 1.04, 16, 12, 0, r * 1.1, -r * 0.05));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      hairParts.push(cyl(0, r * 0.24, r * 0.55, 6, Math.cos(a) * r * 0.5, r * 1.9, Math.sin(a) * r * 0.5, 0, 0, Math.cos(a) * 0.4));
    }
  } else if (hair === 'pigtails') {
    hairParts.push(sphere(r * 1.05, 18, 14, 0, r * 1.06, -r * 0.05));
    hairParts.push(sphere(r * 0.42, 12, 10, -r * 1.2, r * 1.25, -r * 0.3));
    hairParts.push(sphere(r * 0.42, 12, 10, r * 1.2, r * 1.25, -r * 0.3));
    hairParts.push(cyl(r * 0.16, r * 0.16, r * 0.9, 8, -r * 1.3, r * 0.85, -r * 0.35, 0.2, 0, 0.3));
    hairParts.push(cyl(r * 0.16, r * 0.16, r * 0.9, 8, r * 1.3, r * 0.85, -r * 0.35, 0.2, 0, -0.3));
  } else if (hair === 'bald') {
    hairParts.push(box(r * 2.0, r * 0.35, r * 1.4, 0, r * 1.3, -r * 0.5, 0, 0, 0, r * 0.15));
  }
  if (antenna) {
    hairParts.push(cyl(r * 0.06, r * 0.06, r * 1.1, 6, -r * 0.4, r * 2.1, 0, 0, 0, -0.25));
    hairParts.push(cyl(r * 0.06, r * 0.06, r * 1.1, 6, r * 0.4, r * 2.1, 0, 0, 0, 0.25));
    hairParts.push(sphere(r * 0.2, 10, 8, -r * 0.68, r * 2.62, 0));
    hairParts.push(sphere(r * 0.2, 10, 8, r * 0.68, r * 2.62, 0));
  }
  g.hair = hairParts.length ? mergeParts(hairParts) : null;

  // Ball cap. Kept separate from the hair so it takes its own colour.
  if (hat === 'cap') {
    // The brim line sits well above the eyes (which are at ~1.12r) or the cap
    // reads as a blindfold.
    const crown = sphere(r * 1.06, 18, 12, 0, r * 1.42, -r * 0.04);
    crown.scale(1, 0.78, 1);
    g.hat = mergeParts([
      crown,
      cyl(r * 1.05, r * 1.08, r * 0.26, 18, 0, r * 1.4, -r * 0.04),
      // Peak: wide, flat, tipped down at the front.
      box(r * 1.82, r * 0.1, r * 1.2, 0, r * 1.44, r * 0.88, -0.16, 0, 0, r * 0.045),
      sphere(r * 0.12, 8, 6, 0, r * 2.02, -r * 0.04),
    ]);
    // A pale badge on the front panel, like the logo on the cap in the photo.
    g.hatBadge = mergeParts([
      box(r * 0.4, r * 0.4, r * 0.09, 0, r * 1.55, r * 0.94, 0, 0, 0, r * 0.05),
    ]);
  }

  // Beard: a jaw-hugging mass plus a moustache. Reads at gameplay distance,
  // which is all it needs to do.
  if (beard === 'full') {
    // Sits below the nose (~0.95r) and behind its tip, so the face still reads.
    const chin = sphere(r * 0.6, 14, 12, 0, r * 0.36, r * 0.46);
    chin.scale(1.22, 1.12, 1.02);
    g.beard = mergeParts([
      chin,
      box(r * 1.5, r * 0.8, r * 1.52, 0, r * 0.5, r * 0.2, 0, 0, 0, r * 0.32),
      // Sideburns running up to the hairline.
      box(r * 0.3, r * 0.72, r * 0.62, -r * 0.84, r * 0.94, r * 0.06, 0, 0, 0, r * 0.13),
      box(r * 0.3, r * 0.72, r * 0.62, r * 0.84, r * 0.94, r * 0.06, 0, 0, 0, r * 0.13),
      // Moustache, tucked just under the nose.
      box(r * 0.9, r * 0.22, r * 0.3, 0, r * 0.8, r * 0.9, 0, 0, 0, r * 0.09),
    ]);
  }

  g.glasses = glasses ? mergeParts([
    new THREE.TorusGeometry(r * 0.3, r * 0.045, 6, 18).translate(-r * 0.36, r * 1.12, r * 0.86),
    new THREE.TorusGeometry(r * 0.3, r * 0.045, 6, 18).translate(r * 0.36, r * 1.12, r * 0.86),
    box(r * 0.25, r * 0.04, r * 0.04, 0, r * 1.12, r * 0.86),
    box(r * 0.04, r * 0.04, r * 0.5, -r * 0.66, r * 1.12, r * 0.62),
    box(r * 0.04, r * 0.04, r * 0.5, r * 0.66, r * 1.12, r * 0.62),
  ]) : null;

  const limbR = p.limbR;
  const sleeved = sleeves === 'long' ? 1.12 : 1;
  g.armU = mergeParts([
    cyl(limbR * sleeved, limbR * 0.9 * sleeved, p.armU, 10, 0, -p.armU / 2, 0),
    sphere(limbR * 1.05 * sleeved, 10, 8, 0, 0, 0),
  ]);
  g.armL = mergeParts([
    cyl(limbR * 0.9 * sleeved, limbR * 0.78, p.armL, 10, 0, -p.armL / 2, 0),
    sphere(limbR * 0.92 * sleeved, 10, 8, 0, 0, 0),
  ]);
  g.hand = mergeParts([sphere(limbR * 1.15, 10, 8, 0, 0, 0)]);

  const legR = p.legR;
  g.legU = mergeParts([cyl(legR, legR * 0.85, p.legU, 10, 0, -p.legU / 2, 0), sphere(legR * 1.02, 10, 8, 0, 0, 0)]);
  g.legL = mergeParts([cyl(legR * 0.85, legR * 0.66, p.legL, 10, 0, -p.legL / 2, 0), sphere(legR * 0.88, 10, 8, 0, 0, 0)]);
  g.shoe = mergeParts([
    box(legR * 2.0, legR * 0.9, legR * 3.2, 0, -legR * 0.3, legR * 0.7, 0, 0, 0, legR * 0.35),
  ]);

  for (const k of Object.keys(g)) if (g[k]) ensureColorAttr(g[k]);
  return g;
}

export { proportions };

// --- Solo character (player, bosses) ---------------------------------------

export class SoloCharacter {
  constructor(scene, mats, { height = 1.72, chunk = 1, style = {}, colors = {}, matMap = {} } = {}) {
    this.p = proportions(height, chunk);
    this.geo = buildBodyGeometry(this.p, style);
    this.style = style;
    this.group = new THREE.Group();
    scene.add(this.group);

    const mk = (geo, matKey, color) => {
      if (!geo) return null;
      const mat = mats[matKey].clone();
      if (color !== undefined) mat.color.setHex(color);
      mat.vertexColors = true;
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      return m;
    };

    const c = {
      skin: 0xe8b48c, shirt: 0x486a9c, pants: 0x2f3947,
      hair: 0x3a2418, shoe: 0x22232a, hat: 0x8e2b2b, badge: 0xe8dcc4, ...colors,
    };
    // A character can swap the material of any slot — that's how the flannel
    // shirt and sleeves work without a second rig.
    const M = { torso: 'cloth', hips: 'cloth', armU: 'skin', armL: 'skin', leg: 'cloth', hat: 'cloth', ...matMap };

    this.meshes = {
      hips: mk(this.geo.hips, M.hips, c.pants),
      torso: mk(this.geo.torso, M.torso, c.shirt),
      head: mk(this.geo.head, 'skin', c.skin),
      eyes: mk(this.geo.eyes, 'rubber', 0x14161c),
      hair: mk(this.geo.hair, 'hair', c.hair),
      beard: mk(this.geo.beard, 'hair', c.beard ?? c.hair),
      hat: mk(this.geo.hat, M.hat, c.hat),
      hatBadge: mk(this.geo.hatBadge, 'cloth', c.badge),
      glasses: mk(this.geo.glasses, 'metal', 0x8a6a3a),
      armU_L: mk(this.geo.armU, M.armU, M.armU === 'skin' ? c.skin : c.shirt),
      armU_R: mk(this.geo.armU, M.armU, M.armU === 'skin' ? c.skin : c.shirt),
      armL_L: mk(this.geo.armL, M.armL, M.armL === 'skin' ? c.skin : c.shirt),
      armL_R: mk(this.geo.armL, M.armL, M.armL === 'skin' ? c.skin : c.shirt),
      hand_L: mk(this.geo.hand, 'skin', c.skin),
      hand_R: mk(this.geo.hand, 'skin', c.skin),
      legU_L: mk(this.geo.legU, M.leg, c.pants),
      legU_R: mk(this.geo.legU, M.leg, c.pants),
      legL_L: mk(this.geo.legL, M.leg, c.pants),
      legL_R: mk(this.geo.legL, M.leg, c.pants),
      shoe_L: mk(this.geo.shoe, 'rubber', c.shoe),
      shoe_R: mk(this.geo.shoe, 'rubber', c.shoe),
    };

    this.bones = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
    this.rootMatrix = new THREE.Matrix4();
  }

  pose(x, y, z, yaw, anim, scale = 1) {
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.rootMatrix.compose(_v.set(x, y, z), _q, new THREE.Vector3(scale, scale, scale));
    poseSkeleton(this.bones, this.p, anim, this.rootMatrix);
    const b = this.bones;
    const M = this.meshes;
    const put = (mesh, bone) => { if (mesh) { mesh.matrix.copy(b[bone]); mesh.matrixWorldNeedsUpdate = true; mesh.matrixWorld.copy(b[bone]); } };
    put(M.hips, BONE.HIPS);
    put(M.torso, BONE.TORSO);
    put(M.head, BONE.HEAD);
    put(M.eyes, BONE.HEAD);
    put(M.hair, BONE.HEAD);
    put(M.beard, BONE.HEAD);
    put(M.hat, BONE.HEAD);
    put(M.hatBadge, BONE.HEAD);
    put(M.glasses, BONE.HEAD);
    put(M.armU_L, BONE.ARM_U_L); put(M.armU_R, BONE.ARM_U_R);
    put(M.armL_L, BONE.ARM_L_L); put(M.armL_R, BONE.ARM_L_R);
    put(M.hand_L, BONE.HAND_L); put(M.hand_R, BONE.HAND_R);
    put(M.legU_L, BONE.LEG_U_L); put(M.legU_R, BONE.LEG_U_R);
    put(M.legL_L, BONE.LEG_L_L); put(M.legL_R, BONE.LEG_L_R);
    put(M.shoe_L, BONE.SHOE_L); put(M.shoe_R, BONE.SHOE_R);
  }

  setVisible(v) { this.group.visible = v; }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const m of Object.values(this.meshes)) { if (m) m.material.dispose(); }
    for (const g of Object.values(this.geo)) g?.dispose?.();
  }
}

// --- Crowd batch (kids) -----------------------------------------------------

const CROWD_PARTS = [
  ['hips', BONE.HIPS, 'cloth', 'pants'],
  ['torso', BONE.TORSO, 'cloth', 'shirt'],
  ['head', BONE.HEAD, 'skin', 'skin'],
  ['eyes', BONE.HEAD, 'rubber', 'eye'],
  ['armU', BONE.ARM_U_L, 'skin', 'skin'],
  ['armU', BONE.ARM_U_R, 'skin', 'skin'],
  ['armL', BONE.ARM_L_L, 'skin', 'skin'],
  ['armL', BONE.ARM_L_R, 'skin', 'skin'],
  ['hand', BONE.HAND_L, 'skin', 'skin'],
  ['hand', BONE.HAND_R, 'skin', 'skin'],
  ['legU', BONE.LEG_U_L, 'cloth', 'pants'],
  ['legU', BONE.LEG_U_R, 'cloth', 'pants'],
  ['legL', BONE.LEG_L_L, 'skin', 'skin'],
  ['legL', BONE.LEG_L_R, 'skin', 'skin'],
  ['shoe', BONE.SHOE_L, 'rubber', 'shoe'],
  ['shoe', BONE.SHOE_R, 'rubber', 'shoe'],
];

/**
 * A pool of identical-rig characters drawn with InstancedMesh. Each member gets
 * its own body colours; hairstyle variety comes from parallel batches.
 */
export class CrowdBatch {
  constructor(scene, mats, { height = 1.15, chunk = 1, capacity = 48, style = {}, hairStyles = ['short'] } = {}) {
    this.capacity = capacity;
    this.p = proportions(height, chunk);
    this.geo = buildBodyGeometry(this.p, { ...style, hair: hairStyles[0] });
    this.hairGeos = hairStyles.map((h) => buildBodyGeometry(this.p, { ...style, hair: h }).hair);
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.meshes = [];
    for (const [geoKey, bone, matKey, colorKey] of CROWD_PARTS) {
      const geo = this.geo[geoKey];
      if (!geo) { this.meshes.push(null); continue; }
      const mesh = new THREE.InstancedMesh(geo, mats[matKey], capacity);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      mesh.count = 0;
      mesh.userData = { bone, colorKey };
      this.group.add(mesh);
      this.meshes.push(mesh);
    }

    // Hair as separate instanced meshes, one per style, so a crowd looks like
    // a crowd instead of clones.
    this.hairMeshes = this.hairGeos.map((hg) => {
      if (!hg) return null;
      const m = new THREE.InstancedMesh(hg, mats.hair, capacity);
      m.castShadow = true;
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      m.count = 0;
      this.group.add(m);
      return m;
    });

    this.bones = Array.from({ length: BONE_COUNT }, () => new THREE.Matrix4());
    this._rootM = new THREE.Matrix4();
    this._hairCursor = new Array(this.hairMeshes.length).fill(0);
  }

  begin() {
    for (const m of this.meshes) if (m) m.count = 0;
    for (const m of this.hairMeshes) if (m) m.count = 0;
    this._hairCursor.fill(0);
  }

  /** Write one character's pose into the batch. */
  push(x, y, z, yaw, anim, colors, scale = 1, hairIndex = 0) {
    _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this._rootM.compose(_v.set(x, y, z), _q, new THREE.Vector3(scale, scale, scale));
    poseSkeleton(this.bones, this.p, anim, this._rootM);

    for (let i = 0; i < CROWD_PARTS.length; i++) {
      const mesh = this.meshes[i];
      if (!mesh || mesh.count >= this.capacity) continue;
      const [, bone, , colorKey] = CROWD_PARTS[i];
      const idx = mesh.count++;
      mesh.setMatrixAt(idx, this.bones[bone]);
      const col = colors[colorKey] ?? 0xffffff;
      const c = _tmpColor.setHex(col);
      mesh.instanceColor.setXYZ(idx, c.r, c.g, c.b);
    }

    const hm = this.hairMeshes[hairIndex % this.hairMeshes.length];
    if (hm && hm.count < this.capacity) {
      const idx = hm.count++;
      hm.setMatrixAt(idx, this.bones[BONE.HEAD]);
      const c = _tmpColor.setHex(colors.hair ?? 0x3a2418);
      hm.instanceColor.setXYZ(idx, c.r, c.g, c.b);
    }
  }

  end() {
    for (const m of this.meshes) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
    for (const m of this.hairMeshes) {
      if (!m) continue;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    for (const m of this.meshes) m?.dispose?.();
    for (const m of this.hairMeshes) m?.dispose?.();
    for (const g of Object.values(this.geo)) g?.dispose?.();
    for (const g of this.hairGeos) g?.dispose?.();
  }
}

const _tmpColor = new THREE.Color();
