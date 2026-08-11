import * as THREE from 'three';

// Third-person orbit camera: smoothed follow, mouse-driven yaw/pitch,
// look-ahead in the direction of travel, and trauma-based disaster shake.

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Find the inside faces of the four generated perimeter walls. Only slabs
 * which both span an outer edge and touch the building envelope qualify, so
 * interior partitions cannot accidentally shrink the camera's playable area.
 */
export function deriveCameraContainment(layout) {
  const width = Number(layout?.width);
  const depth = Number(layout?.depth);
  if (!(width > 0) || !(depth > 0)) return null;

  const bounds = { minX: 0, maxX: width, minZ: 0, maxZ: depth };
  const edgeTolerance = Math.max(0.05, Math.min(width, depth) * 0.002);

  for (const wall of layout.walls || []) {
    const x = Number(wall?.x), z = Number(wall?.z);
    const w = Number(wall?.w), d = Number(wall?.d);
    if (![x, z, w, d].every(Number.isFinite) || w <= 0 || d <= 0) continue;

    const x0 = x - w / 2, x1 = x + w / 2;
    const z0 = z - d / 2, z1 = z + d / 2;
    const spansX = w >= width * 0.7;
    const spansZ = d >= depth * 0.7;

    if (spansZ && x0 <= edgeTolerance && x1 < width / 2) bounds.minX = Math.max(bounds.minX, x1);
    if (spansZ && x1 >= width - edgeTolerance && x0 > width / 2) bounds.maxX = Math.min(bounds.maxX, x0);
    if (spansX && z0 <= edgeTolerance && z1 < depth / 2) bounds.minZ = Math.max(bounds.minZ, z1);
    if (spansX && z1 >= depth - edgeTolerance && z0 > depth / 2) bounds.maxZ = Math.min(bounds.maxZ, z0);
  }

  // Malformed custom layouts should retain the harmless outer envelope rather
  // than collapse the eye to a line or produce NaNs.
  if (bounds.maxX - bounds.minX < 1) { bounds.minX = 0; bounds.maxX = width; }
  if (bounds.maxZ - bounds.minZ < 1) { bounds.minZ = 0; bounds.maxZ = depth; }
  return bounds;
}

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.smoothed = new THREE.Vector3();
    this.yaw = Math.PI * 0.25;
    this.defaultPitch = 0.76;      // radians from horizontal
    this.pitch = this.defaultPitch;
    this.minPitch = 0.34;
    this.maxPitch = 1.08;
    this.orbitSensitivity = 0.0055;
    this.invertY = false;
    this.distance = 16;
    this.targetDistance = 16;
    this.minDistance = 9;
    this.maxDistance = 24;
    this.height = 1.1;
    // Never let the rig climb through the ceiling; set per level.
    this.ceiling = 14;
    this.containment = null;
    // Added to the near-plane corner radius below to avoid precision flicker
    // when the camera slides along an opaque wall.
    this.containmentPadding = 0.12;

    this.trauma = 0;
    this.traumaDecay = 1.35;
    this._shake = new THREE.Vector3();
    this._t = 0;
    this._lookAhead = new THREE.Vector3();
    this._initialised = false;

    this.fovBase = camera.fov;
    this.fovBoost = 0;
    this.reducedMotion = false;
  }

  addTrauma(amount) {
    if (this.reducedMotion) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  setReducedMotion(enabled) {
    this.reducedMotion = !!enabled;
    if (this.reducedMotion) {
      this.trauma = 0;
      this._shake.set(0, 0, 0);
    }
  }

  setInvertY(enabled) {
    this.invertY = !!enabled;
  }

  rotate(delta) { this.yaw = wrapAngle(this.yaw + delta); }

  /** Orbit in response to a left-mouse drag, in CSS pixels. */
  orbit(deltaX, deltaY) {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;
    this.yaw = wrapAngle(this.yaw - deltaX * this.orbitSensitivity);
    // Normally dragging upward lifts the viewpoint. Inverted vertical camera
    // input reverses only this axis and leaves horizontal orbit unchanged.
    const verticalDirection = this.invertY ? -1 : 1;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - deltaY * this.orbitSensitivity * verticalDirection,
      this.minPitch,
      Math.min(this.maxPitch, this._pitchCeilingLimit()),
    );
    this.distance = Math.min(this.distance, this._ceilingLimit());
  }

  zoom(steps) {
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + steps * 1.6, this.minDistance, this._ceilingLimit());
  }

  setCeiling(h) {
    this.ceiling = h;
    this.pitch = Math.min(this.pitch, this._pitchCeilingLimit());
    this.distance = Math.min(this.distance, this._ceilingLimit());
    this.targetDistance = Math.min(this.targetDistance, this._ceilingLimit());
  }

  /** Keep the eye and its full near plane inside a generated building. */
  setContainment(layout) {
    this.containment = deriveCameraContainment(layout);
    if (this.containment && this._initialised) {
      this._clampXZ(this.target, 0.02);
      this._clampXZ(this.smoothed, 0.02);
      this._clampXZ(this.camera.position, this._cameraContainmentRadius());
    }
  }

  /** Hard lifecycle boundary: no follow lag, zoom, look-ahead, or shake leaks. */
  reset(focus, { yaw = Math.PI * 0.25, pitch = this.defaultPitch } = {}) {
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, this.minPitch, Math.min(this.maxPitch, this._pitchCeilingLimit()));
    this.targetDistance = Math.min(16, this._ceilingLimit());
    this.distance = this.targetDistance;
    this.trauma = 0;
    this._t = 0;
    this._shake.set(0, 0, 0);
    this._lookAhead.set(0, 0, 0);
    this.target.set(focus.x, this.height, focus.z);
    this.smoothed.copy(this.target);
    this._initialised = true;
    this.fovBoost = 0;
    this.camera.fov = this.fovBase;
    this.camera.updateProjectionMatrix();
    this.update(0, focus, { x: 0, z: 0 }, { snap: true });
  }

  _ceilingLimit() {
    // Keep the eye a comfortable margin below the coffers.
    const limit = (this.ceiling - 1.8) / Math.max(0.2, Math.sin(this.pitch));
    return Math.min(this.maxDistance, Math.max(this.minDistance, limit));
  }

  _pitchCeilingLimit() {
    const rise = THREE.MathUtils.clamp((this.ceiling - 1.8) / this.minDistance, 0.2, 1);
    return Math.asin(rise);
  }

  update(dt, focus, velocity, opts = {}) {
    this._t += dt;
    this.target.set(focus.x, this.height, focus.z);

    // Look-ahead: push the framing toward where the player is heading so you
    // see the aisle you're about to enter, not the one you just left.
    const vlen = Math.hypot(velocity.x, velocity.z);
    const ahead = Math.min(vlen / 6, 1) * 2.6;
    this._lookAhead.lerp(
      _tmp.set(velocity.x, 0, velocity.z).normalize().multiplyScalar(ahead),
      1 - Math.exp(-dt * 3.2),
    );
    this.target.add(this._lookAhead);
    // Look-ahead is allowed to lead the player, but never through an exterior
    // wall. Keeping both endpoints inside this convex envelope also guarantees
    // that the wall cannot cut across the line of sight to the player.
    this._clampXZ(this.target, 0.02);

    if (!this._initialised) { this.smoothed.copy(this.target); this._initialised = true; }
    const k = 1 - Math.exp(-dt * (opts.snap ? 30 : 8.5));
    this.smoothed.lerp(this.target, k);

    const wanted = Math.min(this.targetDistance, this._ceilingLimit());
    this.distance += (wanted - this.distance) * (1 - Math.exp(-dt * 6));

    // Speed-based FOV punch.
    const motionScale = this.reducedMotion ? 0 : 1;
    const wantFov = this.fovBase + (Math.min(vlen / 9, 1) * 4 + this.fovBoost) * motionScale;
    this.camera.fov += (wantFov - this.camera.fov) * (1 - Math.exp(-dt * 5));
    this.camera.updateProjectionMatrix();

    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    const dir = _tmp.set(
      Math.sin(this.yaw) * cy,
      sy,
      Math.cos(this.yaw) * cy,
    );

    this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    const shake = this.reducedMotion ? 0 : this.trauma * this.trauma;
    this._shake.set(
      (noise(this._t * 22.1) * 2 - 1) * shake * 0.85,
      (noise(this._t * 19.7 + 31) * 2 - 1) * shake * 0.6,
      (noise(this._t * 25.3 + 77) * 2 - 1) * shake * 0.85,
    );

    this.camera.position.copy(this.smoothed).addScaledVector(dir, this.distance).add(this._shake);
    // Clamp after shake so even a maximum-trauma disaster cannot kick the eye
    // through a wall. The radius encloses every near-plane corner at any yaw.
    const cameraRadius = this._cameraContainmentRadius();
    this._clampXZ(this.camera.position, cameraRadius);
    this.camera.position.y = THREE.MathUtils.clamp(
      this.camera.position.y,
      cameraRadius,
      Math.max(cameraRadius, this.ceiling - cameraRadius),
    );
    _look.copy(this.smoothed).addScaledVector(this._shake, 0.35);
    this._clampXZ(_look, 0.02);
    this.camera.lookAt(_look);
    if (shake > 0.001) this.camera.rotateZ((noise(this._t * 17.3 + 12) * 2 - 1) * shake * 0.05);
  }

  /**
   * Convert screen-relative input into world XZ, so W is always "up-screen".
   *
   * The rig sits at `target + (sin yaw, ·, cos yaw) * distance`, so the
   * direction *into* the screen is the negative of that, and screen-right is
   * its perpendicular. Input arrives with y positive downward (W is -1).
   */
  inputToWorld(ix, iy, out) {
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const fx = -s, fz = -c;          // forward: away from the camera
    const rx = c, rz = -s;           // right: cross(forward, up)
    out.x = ix * rx - iy * fx;
    out.z = ix * rz - iy * fz;
    return out;
  }

  /** Where a screen ray meets the ground plane (mouse aiming). */
  screenToGround(ndcX, ndcY, out, y = 0.9) {
    _ray.setFromCamera(_v2.set(ndcX, ndcY), this.camera);
    _plane.set(UP, -y);
    if (_ray.ray.intersectPlane(_plane, out)) return out;
    out.set(this.smoothed.x, y, this.smoothed.z);
    return out;
  }

  _cameraContainmentRadius() {
    const near = Math.max(0.001, Number(this.camera.near) || 0.1);
    const halfHeight = near * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const halfWidth = halfHeight * Math.max(0.01, Number(this.camera.aspect) || 1);
    return Math.hypot(near, halfWidth, halfHeight) + this.containmentPadding;
  }

  _clampXZ(vector, inset) {
    const b = this.containment;
    if (!b) return vector;
    const insetX = Math.min(Math.max(0, inset), Math.max(0, (b.maxX - b.minX) / 2 - 0.001));
    const insetZ = Math.min(Math.max(0, inset), Math.max(0, (b.maxZ - b.minZ) / 2 - 0.001));
    vector.x = THREE.MathUtils.clamp(vector.x, b.minX + insetX, b.maxX - insetX);
    vector.z = THREE.MathUtils.clamp(vector.z, b.minZ + insetZ, b.maxZ - insetZ);
    return vector;
  }
}

const _tmp = new THREE.Vector3();
const _look = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _v2 = new THREE.Vector2();
const _plane = new THREE.Plane();

function noise(t) {
  const s = Math.sin(t) * 43758.5453;
  return s - Math.floor(s);
}

function wrapAngle(radians) {
  return THREE.MathUtils.euclideanModulo(radians + Math.PI, Math.PI * 2) - Math.PI;
}
