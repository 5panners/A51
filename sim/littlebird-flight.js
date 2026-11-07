// littlebird-flight.js — Battlefield-style arcade helicopter flight model for three.js
// Easy to pick up: rate-command controls, neutral collective = hover, gentle self-levelling.
// Skill to master: lift follows the rotor disc (tilt = lose height), collective lag,
// torque kick, weathervaning, translational lift, ground effect, vortex ring state,
// autorotation if the engine is off.
//
// Model axes (matches littlebird.glb): +Y up, nose +Z, aircraft left = +X.
// Usage:
//   const fm = new HeliFlightModel();               // optional tuning overrides
//   const input = new HeliInput(renderer.domElement);
//   loop: fm.update(dt, input.read(dt), { groundHeight: (x,z) => h });
//         fm.applyTo(heliObject3D); fm.animateRotors(gltfScene, dt);
import * as THREE from 'three';

export const LITTLEBIRD_TUNING = {
  g: 9.81,
  // lift (as multiples of g at full rotor RPM, level)
  hoverLift: 1.0,          // collective 0 (no key) = hover when level
  climbLift: 0.8,          // added at full collective up  -> 1.8 g
  descendLift: 0.85,       // removed at full collective down -> 0.15 g
  collectiveRate: 3.2,     // how fast the rotor responds to collective (lag = skill)
  tiltCompensation: 0.4,   // 0 = pure physics (BF hardcore), 1 = holds height when banked
  // rotation (rad/s at full input) & response
  maxPitchRate: 1.7, maxRollRate: 2.6, maxYawRate: 1.9,
  rateResponse: 7.0,       // higher = snappier
  selfLevelRoll: 0.6,      // wings-level assist when no roll input (0 = none)
  selfLevelPitch: 0.06,    // weak: nose attitude mostly holds where you put it (BF feel)
  maxBank: 1.25,           // soft limit on self-level region, rad
  // aero
  dragForward: 0.0012, dragSide: 0.006, dragVertical: 0.006,
  dragLinear: 0.035, dragVerticalLinear: 0.15,
  neutralDamping: 0.75,    // extra vertical damping when collective is centred (easy hover)
  weathervane: 1.1,        // nose aligns with flight path at speed
  bankTurn: 0.55,          // coordinated yaw when banked at speed
  translationalLift: 0.14, // extra lift around 12-45 m/s
  groundEffect: 0.12,      // extra lift within ~4 m of ground
  vortexRing: 0.45,        // max lift loss when descending fast at low speed
  torqueKick: 0.45,        // yaw kick on sudden collective changes
  maxSpeed: 80,            // m/s hard cap
  // rotor
  spoolUpTime: 4.0, spoolDownRate: 0.06, autorotationGain: 0.035,
  rotorVisualRPS: 7.5,     // main rotor revolutions/sec at 100% (visual only)
  tailRotorRatio: 4.6,
  // ground / damage
  skidPoints: [[0.98, 0, 1.25], [-0.98, 0, 1.25], [0.98, 0, -1.55], [-0.98, 0, -1.55]],
  strikePoints: [[0, 1.02, -5.3], [0, 2.6, 4.15], [0, 2.6, -4.2], [4.15, 2.6, 0], [-4.15, 2.6, 0], [0, 2.56, -5.0]],
  groundFriction: 2.5,
  hardLanding: 4.5,        // m/s vertical — damage
  crashSpeed: 9.5,         // m/s — destroyed
  crashTilt: 0.85,         // rad (~49 deg) tilt while touching ground — rollover
};

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

export class HeliFlightModel {
  constructor(tuning = {}) {
    this.t = { ...LITTLEBIRD_TUNING, ...tuning };
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.omega = new THREE.Vector3();   // body rates: x = pitch (nose down +), y = yaw (left +), z = roll (right +)
    this.listeners = {};
    this.reset();
  }
  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); return this; }
  emit(evt, data) { (this.listeners[evt] || []).forEach(f => f(data)); }

  reset(pos = new THREE.Vector3(0, 0, 0), headingRad = 0, engineOn = false) {
    this.position.copy(pos);
    this.quaternion.setFromAxisAngle(UP, headingRad);
    this.velocity.set(0, 0, 0); this.omega.set(0, 0, 0);
    this.collective = 0; this.rpm = engineOn ? 1 : 0; this.engineOn = engineOn;
    this.grounded = true; this._contact = true; this.crashed = false; this.damage = 0;
    this.vrs = 0; this.agl = 0; this.shake = 0; this.lastImpact = 0;
    this._rotorAngle = 0; this._tailAngle = 0;
  }
  setEngine(on) { if (!this.crashed) this.engineOn = on; }
  toggleEngine() { this.setEngine(!this.engineOn); }

  /** input: { collective, pitch, roll, yaw } each -1..1. pitch +1 = nose down, roll +1 = right, yaw +1 = right */
  update(dt, input, env = {}) {
    dt = Math.min(dt, 1 / 20);
    const t = this.t, g = t.g;
    const groundHeight = env.groundHeight || (() => 0);
    if (this.crashed) { this._crashedUpdate(dt, groundHeight); return; }

    // ---- rotor RPM
    if (this.engineOn) this.rpm = Math.min(1, this.rpm + dt / t.spoolUpTime);
    else {
      const up = _v.copy(UP).applyQuaternion(this.quaternion);
      const inflow = Math.max(0, -this.velocity.dot(up));           // air coming up through the disc
      this.rpm = THREE.MathUtils.clamp(this.rpm - t.spoolDownRate * dt + inflow * t.autorotationGain * dt * (1 - this.rpm * 0.6), 0, 1.05);
    }

    // ---- collective (lagged)
    const cIn = THREE.MathUtils.clamp(input.collective || 0, -1, 1);
    const prevC = this.collective;
    this.collective += (cIn - this.collective) * (1 - Math.exp(-t.collectiveRate * dt));
    const dC = (this.collective - prevC) / dt;

    // ---- attitude helpers
    const fwd = _v.set(0, 0, 1).applyQuaternion(this.quaternion).clone();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const pitchAng = Math.asin(THREE.MathUtils.clamp(-fwd.y, -1, 1));     // + nose down
    const rollAng = Math.atan2(left.y, up.y);                              // + right wing down
    const tilt = Math.acos(THREE.MathUtils.clamp(up.y, -1, 1));

    // body-frame velocity
    const invQ = _q.copy(this.quaternion).invert();
    const vb = this.velocity.clone().applyQuaternion(invQ);               // x left, y up, z fwd
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const airSpeed = this.velocity.length();
    const spd = THREE.MathUtils.smoothstep(airSpeed, 6, 30);

    // ---- rotation: rate command
    const pIn = THREE.MathUtils.clamp(input.pitch || 0, -1, 1);
    const rIn = THREE.MathUtils.clamp(input.roll || 0, -1, 1);
    const yIn = THREE.MathUtils.clamp(input.yaw || 0, -1, 1);
    const ctrl = this.grounded ? 0.35 + 0.65 * Math.min(1, this.rpm) * (this.collective > -0.2 ? 1 : 0.3) : 1;
    const target = new THREE.Vector3(pIn * t.maxPitchRate, -yIn * t.maxYawRate, rIn * t.maxRollRate).multiplyScalar(ctrl * Math.max(0.25, this.rpm));
    // self-levelling when stick centred
    if (!this.grounded) {
      if (Math.abs(pIn) < 0.05) target.x += -pitchAng * t.selfLevelPitch * (Math.abs(pitchAng) < t.maxBank ? 1 : 0.3);
      if (Math.abs(rIn) < 0.05) target.z += -rollAng * t.selfLevelRoll * (Math.abs(rollAng) < t.maxBank ? 1 : 0.3);
    }
    // weathervane: nose follows the flight path at speed
    if (hSpeed > 3 && !this.grounded) {
      const beta = Math.atan2(vb.x, Math.max(0.5, Math.abs(vb.z))) * Math.sign(vb.z || 1);
      target.y += beta * t.weathervane * spd;
      // coordinated turn from bank
      target.y += -Math.sin(rollAng) * t.bankTurn * spd * (vb.z > 0 ? 1 : -0.3);
    }
    // torque reaction on power changes
    target.y += -dC * t.torqueKick * 0.1 * this.rpm;
    this.omega.lerp(target, 1 - Math.exp(-t.rateResponse * dt));
    // integrate attitude (body rates)
    const dq = _q.setFromEuler(_e.set(this.omega.x * dt, this.omega.y * dt, this.omega.z * dt, 'YXZ'));
    this.quaternion.multiply(dq).normalize();

    // ---- lift
    let liftG = t.hoverLift + this.collective * (this.collective > 0 ? t.climbLift : t.descendLift);
    liftG *= 1 + t.tiltCompensation * (1 / Math.max(0.5, Math.cos(Math.min(tilt, 1.0))) - 1);
    // translational lift
    liftG *= 1 + t.translationalLift * THREE.MathUtils.smoothstep(hSpeed, 10, 22) * (1 - THREE.MathUtils.smoothstep(hSpeed, 45, 75));
    // ground effect
    this.agl = this.position.y - groundHeight(this.position.x, this.position.z);
    liftG *= 1 + t.groundEffect * Math.max(0, 1 - this.agl / 4);
    // vortex ring state: fast vertical descent, low forward speed
    const sink = -this.velocity.y;
    const vrsTarget = THREE.MathUtils.smoothstep(sink, 5, 10) * (1 - THREE.MathUtils.smoothstep(hSpeed, 7, 14)) * (this.agl > 3 ? 1 : 0);
    this.vrs += (vrsTarget - this.vrs) * (1 - Math.exp(-2.5 * dt));
    liftG *= 1 - t.vortexRing * this.vrs;
    liftG *= this.rpm * this.rpm;
    // sit on the skids until the pilot pulls collective
    if (this._contact && cIn <= 0.05) liftG = Math.min(liftG, 0.9);
    const lift = up.clone().multiplyScalar(Math.max(0, liftG) * g);

    // ---- drag (body frame)
    const dragB = new THREE.Vector3(
      -(t.dragSide * vb.x * Math.abs(vb.x) + t.dragLinear * vb.x),
      -(t.dragVertical * vb.y * Math.abs(vb.y) + t.dragVerticalLinear * vb.y),
      -(t.dragForward * vb.z * Math.abs(vb.z) + t.dragLinear * vb.z));
    const drag = dragB.applyQuaternion(this.quaternion);

    // ---- integrate
    const acc = lift.add(drag); acc.y -= g;
    if (!this._contact) acc.y -= t.neutralDamping * Math.max(0, 1 - Math.abs(this.collective) * 1.6) * this.velocity.y;  // hover assist (world vertical)
    this.velocity.addScaledVector(acc, dt);
    if (this.velocity.length() > t.maxSpeed) this.velocity.setLength(t.maxSpeed);
    this.position.addScaledVector(this.velocity, dt);

    this.shake = Math.max(this.vrs * 0.9, this.rpm > 0.2 ? 0.04 * this.rpm : 0, THREE.MathUtils.smoothstep(airSpeed, 55, 80) * 0.3);
    this._groundContact(dt, groundHeight, liftG);

    this.telemetry = {
      speed: airSpeed, groundSpeed: hSpeed, kmh: hSpeed * 3.6, verticalSpeed: this.velocity.y, agl: this.agl,
      altitude: this.position.y, heading: (THREE.MathUtils.radToDeg(Math.atan2(-fwd.x, fwd.z)) + 360) % 360,
      pitch: THREE.MathUtils.radToDeg(pitchAng), roll: THREE.MathUtils.radToDeg(rollAng),
      rpm: this.rpm, collective: this.collective, grounded: this.grounded, vrs: this.vrs,
      damage: this.damage, crashed: this.crashed, engineOn: this.engineOn, liftG,
    };
  }

  _groundContact(dt, groundHeight, liftG) {
    const t = this.t;
    let maxPen = 0, any = false;
    for (const p of t.skidPoints) {
      const w = _v.fromArray(p).applyQuaternion(this.quaternion).add(this.position);
      const pen = groundHeight(w.x, w.z) - w.y;
      if (pen > maxPen) maxPen = pen;
      if (pen > -0.03) any = true;
    }
    // rotor / tail strikes
    for (const p of t.strikePoints) {
      const w = _v.fromArray(p).applyQuaternion(this.quaternion).add(this.position);
      if (groundHeight(w.x, w.z) - w.y > 0) { this._crash('strike'); return; }
    }
    const up = _v2.set(0, 1, 0).applyQuaternion(this.quaternion);
    const tilt = Math.acos(THREE.MathUtils.clamp(up.y, -1, 1));
    if (maxPen > 0) {
      this.position.y += maxPen;
      const impact = -this.velocity.y;
      if (impact > 0.5) {
        this.lastImpact = impact;
        const horiz = Math.hypot(this.velocity.x, this.velocity.z);
        if (impact > t.crashSpeed || tilt > t.crashTilt || horiz > 25) { this._crash('impact'); return; }
        if (impact > t.hardLanding) { this.damage = Math.min(1, this.damage + (impact - t.hardLanding) / (t.crashSpeed - t.hardLanding) * 0.6); this.emit('hardLanding', { impact, damage: this.damage }); }
        else this.emit('touchdown', { impact });
      }
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
    if (tilt > t.crashTilt && any) { this._crash('rollover'); return; }
    const wasGrounded = this.grounded;
    this._contact = any;
    this.grounded = any && liftG < 1.02;
    if (any) {
      // skid friction + settle level on the ground
      const f = Math.exp(-t.groundFriction * dt * (this.grounded ? 1 : 0.3));
      this.velocity.x *= f; this.velocity.z *= f;
      if (this.grounded) {
        const fwd = _v.set(0, 0, 1).applyQuaternion(this.quaternion); fwd.y = 0;
        if (fwd.lengthSq() > 1e-6) {
          const yawOnly = _q.setFromAxisAngle(UP, Math.atan2(fwd.x, fwd.z));
          this.quaternion.slerp(yawOnly, 1 - Math.exp(-5 * dt));
        }
        this.omega.x *= Math.exp(-8 * dt); this.omega.z *= Math.exp(-8 * dt);
      }
    }
    if (!wasGrounded && this.grounded) this.emit('landed', {});
    if (wasGrounded && !this.grounded) this.emit('liftoff', {});
  }
  _crash(reason) {
    if (this.crashed) return;
    this.crashed = true; this.engineOn = false; this.damage = 1;
    this.emit('crash', { reason, position: this.position.clone(), velocity: this.velocity.clone() });
  }
  _crashedUpdate(dt, groundHeight) {
    this.rpm = Math.max(0, this.rpm - dt * 0.8);
    this.velocity.y -= this.t.g * dt; this.velocity.multiplyScalar(Math.exp(-1.5 * dt));
    this.position.addScaledVector(this.velocity, dt);
    const h = groundHeight(this.position.x, this.position.z) + 0.3;
    if (this.position.y < h) { this.position.y = h; this.velocity.set(0, 0, 0); this.omega.multiplyScalar(0.9); }
    const dq = _q.setFromEuler(_e.set(this.omega.x * dt, this.omega.y * dt, this.omega.z * dt, 'YXZ'));
    this.quaternion.multiply(dq).normalize();
    if (this.telemetry) Object.assign(this.telemetry, { crashed: true, rpm: this.rpm, engineOn: false });
  }

  applyTo(obj) { obj.position.copy(this.position); obj.quaternion.copy(this.quaternion); }

  /** spins MainRotor / TailRotor nodes and swaps to blur discs at high RPM */
  animateRotors(scene, dt) {
    const n = this._nodes ||= {
      main: scene.getObjectByName('MainRotor'), tail: scene.getObjectByName('TailRotor'),
      mainBlur: scene.getObjectByName('MainRotorBlur'), tailBlur: scene.getObjectByName('TailRotorBlur'),
    };
    const rps = this.t.rotorVisualRPS * this.rpm;
    this._rotorAngle += rps * Math.PI * 2 * dt;
    this._tailAngle += rps * this.t.tailRotorRatio * Math.PI * 2 * dt;
    if (n.main) n.main.rotation.y = this._rotorAngle % (Math.PI * 2);
    if (n.tail) n.tail.rotation.y = this._tailAngle % (Math.PI * 2);
    const blur = this.rpm > 0.75;
    if (n.mainBlur) n.mainBlur.visible = blur;
    if (n.tailBlur) n.tailBlur.visible = this.rpm > 0.45;
    if (n.tail) n.tail.visible = !(this.rpm > 0.45);
    if (n.main) n.main.visible = true;  // keep hub/blades, blur disc adds motion
  }
}

/** Keyboard + mouse (pointer lock) + gamepad -> flight input, Battlefield PC defaults.
 *  W/S collective, A/D yaw, mouse = pitch/roll (mouse acts like a self-centring stick),
 *  arrow keys pitch/roll only if opts.arrowKeys is true (default false: arrows are free for the camera). Gamepad: left stick collective/yaw, right stick pitch/roll. */
export class HeliInput {
  constructor(element, opts = {}) {
    this.opts = { mouseSensitivity: 0.012, invertPitch: false, recentre: 7, arrowKeys: false, ...opts };
    this.keys = new Set(); this.mx = 0; this.my = 0; this.enabled = true;
    addEventListener('keydown', e => { this.keys.add(e.code); });
    addEventListener('keyup', e => { this.keys.delete(e.code); });
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', e => {
      if (document.pointerLockElement !== element) return;
      this.mx += e.movementX * this.opts.mouseSensitivity;
      this.my += e.movementY * this.opts.mouseSensitivity * (this.opts.invertPitch ? -1 : 1);
    });
    this.element = element;
  }
  read(dt) {
    const k = c => this.keys.has(c) ? 1 : 0;
    const decay = Math.exp(-this.opts.recentre * dt);
    this.mx = THREE.MathUtils.clamp(this.mx, -1.2, 1.2) * decay;
    this.my = THREE.MathUtils.clamp(this.my, -1.2, 1.2) * decay;
    const inp = {
      collective: k('KeyW') - k('KeyS'),
      yaw: k('KeyD') - k('KeyA'),
      roll: this.mx,
      pitch: -this.my,   // mouse forward (up) = nose down
    };
    if (this.opts.arrowKeys) { inp.roll += k('ArrowRight') - k('ArrowLeft'); inp.pitch += k('ArrowUp') - k('ArrowDown'); }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const dz = v => Math.abs(v) < 0.12 ? 0 : v;
      inp.collective += -dz(p.axes[1] || 0); inp.yaw += dz(p.axes[0] || 0);
      inp.roll += dz(p.axes[2] || 0); inp.pitch += -dz(p.axes[3] || 0) * (this.opts.invertPitch ? -1 : 1);
      break;
    }
    for (const key of Object.keys(inp)) inp[key] = THREE.MathUtils.clamp(inp[key], -1, 1);
    return inp;
  }
}
