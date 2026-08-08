import * as THREE from 'three';

// Third-person chase camera: fixed pitch, smoothed follow, look-ahead in the
// direction of travel, and a trauma-based shake that every disaster feeds into.

const UP = new THREE.Vector3(0, 1, 0);

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.target = new THREE.Vector3();
    this.smoothed = new THREE.Vector3();
    this.yaw = Math.PI * 0.25;
    this.pitch = 0.76;             // radians from horizontal
    this.distance = 16;
    this.targetDistance = 16;
    this.minDistance = 9;
    this.maxDistance = 24;
    this.height = 1.1;
    // Never let the rig climb through the ceiling; set per level.
    this.ceiling = 14;

    this.trauma = 0;
    this.traumaDecay = 1.35;
    this._shake = new THREE.Vector3();
    this._t = 0;
    this._lookAhead = new THREE.Vector3();
    this._initialised = false;

    this.fovBase = camera.fov;
    this.fovBoost = 0;
  }

  addTrauma(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  rotate(delta) { this.yaw += delta; }

  zoom(steps) {
    this.targetDistance = THREE.MathUtils.clamp(this.targetDistance + steps * 1.6, this.minDistance, this._ceilingLimit());
  }

  setCeiling(h) {
    this.ceiling = h;
    this.targetDistance = Math.min(this.targetDistance, this._ceilingLimit());
  }

  _ceilingLimit() {
    // Keep the eye a comfortable margin below the coffers.
    const limit = (this.ceiling - 1.8) / Math.max(0.2, Math.sin(this.pitch));
    return Math.min(this.maxDistance, Math.max(this.minDistance, limit));
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

    if (!this._initialised) { this.smoothed.copy(this.target); this._initialised = true; }
    const k = 1 - Math.exp(-dt * (opts.snap ? 30 : 8.5));
    this.smoothed.lerp(this.target, k);

    const wanted = Math.min(this.targetDistance, this._ceilingLimit());
    this.distance += (wanted - this.distance) * (1 - Math.exp(-dt * 6));

    // Speed-based FOV punch.
    const wantFov = this.fovBase + Math.min(vlen / 9, 1) * 4 + this.fovBoost;
    this.camera.fov += (wantFov - this.camera.fov) * (1 - Math.exp(-dt * 5));
    this.camera.updateProjectionMatrix();

    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    const dir = _tmp.set(
      Math.sin(this.yaw) * cy,
      sy,
      Math.cos(this.yaw) * cy,
    );

    this.trauma = Math.max(0, this.trauma - this.traumaDecay * dt);
    const shake = this.trauma * this.trauma;
    this._shake.set(
      (noise(this._t * 22.1) * 2 - 1) * shake * 0.85,
      (noise(this._t * 19.7 + 31) * 2 - 1) * shake * 0.6,
      (noise(this._t * 25.3 + 77) * 2 - 1) * shake * 0.85,
    );

    this.camera.position.copy(this.smoothed).addScaledVector(dir, this.distance).add(this._shake);
    _look.copy(this.smoothed).addScaledVector(this._shake, 0.35);
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
