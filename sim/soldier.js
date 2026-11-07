// soldier.js — US Army soldier (UCP / ACU, IOTV, ACH), flat-shaded low-poly character.
// Extracted unchanged from the "US Soldier Model" artifact (FOrest Sniper) so the sim can import it;
// only the imports and the export line at the bottom are added here.
// Faces +Z, feet on y = 0, about 1.80 m tall. Every body part hangs off a named joint node
// (Hips, Spine, Chest, Neck, Head, Thigh/Shin/Foot/Toe, Clavicle/UpperArm/Forearm/Hand + L/R).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// US Army soldier (UCP / ACU, IOTV, ACH) — flat-shaded low-poly character for FOrest Sniper.
// Faces +Z, feet on y=0, ~1.80 m tall. Every body part hangs off a named joint node.

// ---------- deterministic random ----------
let _seed = 1337;
let LOW = false; // low-poly LOD switch (set by buildSoldier)
const rand = () => { _seed = (_seed * 16807) % 2147483647; return (_seed - 1) / 2147483646; };
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };

// ---------- per-polygon UCP camo (no textures) ----------
const UCP = [0xc2bba5, 0x93958c, 0x6d7262].map((h) => new THREE.Color(h)); // sand, urban grey, foliage green
function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const h = (a, b, c) => { const t = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return t - Math.floor(t); };
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h(ix, iy, iz), h(ix + 1, iy, iz), sx), l(h(ix, iy + 1, iz), h(ix + 1, iy + 1, iz), sx), sy),
           l(l(h(ix, iy, iz + 1), h(ix + 1, iy, iz + 1), sx), l(h(ix, iy + 1, iz + 1), h(ix + 1, iy + 1, iz + 1), sx), sy), sz);
}
let _camoOff = 0;
// one flat colour per triangle, clustered by noise so the facets form digital-camo patches
function camoColors(g) {
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const o = (_camoOff += 3.17);
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 + o;
    const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
    const cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const a = vnoise3(cx * 22, cy * 22, cz * 22) * 0.7 + vnoise3(cx * 55, cy * 55, cz * 55) * 0.3;
    const b = vnoise3(cx * 18 + 40, cy * 18, cz * 18) * 0.7 + vnoise3(cx * 47 + 40, cy * 47, cz * 47) * 0.3;
    const c = b < 0.4 ? UCP[2] : a > 0.52 ? UCP[1] : UCP[0];
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i + k) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// ---------- geometry helpers ----------
// Loft along +Y through superelliptic sections.
// section: {y, rx, rz, x, z, p, rzB (back radius), rxI/rxO not used}
function loft(secs, seg = 14, opts = {}) {
  if (LOW) seg = Math.max(6, Math.round(seg * 0.55));
  const pos = [], idx = [];
  const jit = opts.jitter || 0;
  secs.forEach((s, j) => {
    const p = s.p || 2;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const sa = Math.sin(a), ca = Math.cos(a);
      const ex = Math.sign(sa) * Math.pow(Math.abs(sa), 2 / p);
      const ez = Math.sign(ca) * Math.pow(Math.abs(ca), 2 / p);
      const rz = ca >= 0 ? s.rz : (s.rzB ?? s.rz);
      const rx = sa >= 0 ? s.rx : (s.rxR ?? s.rx);
      const jj = (j > 0 && j < secs.length - 1) ? 1 + jit * (hash(i * 3.1 + (opts.js || 0), j * 7.7) - 0.5) : 1;
      pos.push((s.x || 0) + ex * rx * jj, s.y, (s.z || 0) + ez * rz * jj);
    }
  });
  const R = secs.length;
  // sections listed top-to-bottom (limbs) would otherwise face inward: flip winding
  const flip = secs[R - 1].y < secs[0].y;
  const tri = (a, b, c) => (flip ? idx.push(a, c, b) : idx.push(a, b, c));
  for (let j = 0; j < R - 1; j++) for (let i = 0; i < seg; i++) {
    const a = j * seg + i, b = j * seg + (i + 1) % seg, c = (j + 1) * seg + i, d = (j + 1) * seg + (i + 1) % seg;
    tri(a, b, d); tri(a, d, c);
  }
  if (!opts.open) {
    const s0 = secs[0], s1 = secs[R - 1];
    pos.push(s0.x || 0, s0.y, s0.z || 0); const c0 = pos.length / 3 - 1;
    pos.push(s1.x || 0, s1.y, s1.z || 0); const c1 = pos.length / 3 - 1;
    for (let i = 0; i < seg; i++) {
      tri(c0, (i + 1) % seg, i);
      tri(c1, (R - 1) * seg + i, (R - 1) * seg + (i + 1) % seg);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}
// Rounded, optionally front-bulged box (soft pouches)
function softBox(w, h, d, r = 0.01, bulge = 0, seg = 4) {
  if (LOW) seg = 2;
  const g = new THREE.BoxGeometry(w, h, d, seg, seg, Math.max(2, seg - 1));
  const p = g.attributes.position, v = new THREE.Vector3(), c = new THREE.Vector3();
  const ix = w / 2 - r, iy = h / 2 - r, iz = d / 2 - r;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(THREE.MathUtils.clamp(v.x, -ix, ix), THREE.MathUtils.clamp(v.y, -iy, iy), THREE.MathUtils.clamp(v.z, -iz, iz));
    const n = v.clone().sub(c); if (n.lengthSq() > 1e-12) n.normalize().multiplyScalar(r);
    v.copy(c).add(n);
    if (bulge && v.z > 0) {
      const fx = 1 - Math.pow(2 * v.x / w, 2), fy = 1 - Math.pow(2 * v.y / h, 2);
      v.z += bulge * Math.max(0, fx) * Math.max(0, fy);
    }
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
// Flat strap swept along points. normalFn(p) gives the outward surface normal.
function ribbon(points, width, thick, normalFn, widthFn) {
  if (LOW && points.length > 6) points = points.filter((p, i) => i % 2 === 0 || i === points.length - 1);
  const pos = [], idx = [], n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const t = points[Math.min(n - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
    let nn = normalFn(p).clone().normalize();
    const s = new THREE.Vector3().crossVectors(t, nn).normalize();
    nn = new THREE.Vector3().crossVectors(s, t).normalize();
    const w = (widthFn ? widthFn(i / (n - 1)) : 1) * width / 2, th = thick / 2;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(p.x + s.x * w * a + nn.x * th * b, p.y + s.y * w * a + nn.y * th * b, p.z + s.z * w * a + nn.z * th * b);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 4; k++) {
    const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
    idx.push(a, b, d, a, d, c);
  }
  idx.push(0, 2, 1, 0, 3, 2);
  const e = (n - 1) * 4; idx.push(e, e + 1, e + 2, e, e + 2, e + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function tube(points, r, seg = 5, tubSeg) {
  const curve = new THREE.CatmullRomCurve3(points);
  if (LOW) return new THREE.TubeGeometry(curve, Math.max(3, Math.round((tubSeg || points.length * 3) * 0.5)), r, 3, false);
  return new THREE.TubeGeometry(curve, tubSeg || points.length * 3, r, seg, false);
}
function ellipseArc(rx, rz, y, a0, a1, n, out = 0, cx = 0, cz = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = THREE.MathUtils.degToRad(a0 + (a1 - a0) * i / n);
    const nx = Math.sin(a) / rx, nz = Math.cos(a) / rz, l = Math.hypot(nx, nz);
    pts.push(V(cx + rx * Math.sin(a) + nx / l * out, y, cz + rz * Math.cos(a) + nz / l * out));
  }
  return pts;
}
function onEllipse(obj, rx, rz, deg, y, out, cx = 0, cz = 0) {
  const a = THREE.MathUtils.degToRad(deg);
  const nx = Math.sin(a) / rx, nz = Math.cos(a) / rz, l = Math.hypot(nx, nz);
  obj.position.set(cx + rx * Math.sin(a) + nx / l * out, y, cz + rz * Math.cos(a) + nz / l * out);
  obj.rotation.y = Math.atan2(nx, nz);
  return obj;
}
// box-projected UVs (meters / tile) so camo has a consistent scale everywhere
function boxUV(g, tile = 0.6) {
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      let u, w;
      if (ax >= ay && ax >= az) { u = v.z; w = v.y; } else if (ay >= az) { u = v.x; w = v.z; } else { u = v.x; w = v.y; }
      uv[(i + k) * 2] = u / tile + 0.37; uv[(i + k) * 2 + 1] = w / tile + 0.11;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// ---------- materials ----------
function makeMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.92, metalness: 0, flatShading: true }, o));
  return {
    camo: std({ vertexColors: true, name: 'UCP_Camo' }),
    camoDS: std({ vertexColors: true, name: 'UCP_Camo_2S', side: THREE.DoubleSide }),
    webbing: std({ color: 0x80846f, name: 'Webbing' }),
    webDark: std({ color: 0x63675a, name: 'WebbingDark' }),
    velcro: std({ color: 0x8d8a7c, name: 'Velcro' }),
    kneepad: std({ color: 0x66705f, roughness: 0.6, name: 'KneePad' }),
    boot: std({ color: 0x2b2b2a, roughness: 0.7, name: 'BootLeather' }),
    bootDark: std({ color: 0x1e1e1d, roughness: 0.6, name: 'BootToe' }),
    sole: std({ color: 0x141414, roughness: 0.85, name: 'Sole' }),
    lace: std({ color: 0x0f0f0f, name: 'Lace' }),
    lacePanel: std({ color: 0x121212, name: 'LacePanel' }),
    skin: std({ color: 0xdca88d, roughness: 0.75, name: 'Skin' }),
    skinDark: std({ color: 0xb87a62, roughness: 0.8, name: 'SkinShadow' }),
    lip: std({ color: 0xc27a6c, roughness: 0.6, name: 'Lip' }),
    hair: std({ color: 0x4a3626, name: 'Hair' }),
    nail: std({ color: 0xe8c0ae, roughness: 0.5, name: 'Nail' }),
    black: std({ color: 0x1d1d1d, roughness: 0.55, name: 'BlackPolymer' }),
    lens: std({ color: 0x090909, roughness: 0.12, metalness: 0.3, name: 'Lens' }),
    metal: std({ color: 0x9a9a96, roughness: 0.35, metalness: 0.8, name: 'Metal' }),
    tan: std({ color: 0x8e8a6c, name: 'TanCloth' }),
    tanLight: std({ color: 0xa69f7f, name: 'TanBand' }),
    flagRed: std({ color: 0xa8293a, name: 'FlagRed' }),
    flagWhite: std({ color: 0xece8dc, name: 'FlagWhite' }),
    flagBlue: std({ color: 0x27336a, name: 'FlagBlue' }),
  };
}

// ---------- build ----------
function buildSoldier(opts = {}) {
  _seed = 1337;
  LOW = opts.lod === 'low';
  const M = makeMaterials();
  const joints = {};
  const node = (name, parent, x = 0, y = 0, z = 0) => {
    const o = new THREE.Group(); o.name = 'Soldier_' + name; o.position.set(x, y, z);
    parent && parent.add(o); joints[name] = o; return o;
  };
  const dummy = new THREE.Group();
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    if (LOW) {
      geo.computeBoundingBox(); const sz = geo.boundingBox.getSize(new THREE.Vector3());
      const d = [sz.x, sz.y, sz.z].sort((a, b) => a - b);
      const thinRod = d[1] < 0.013 && mat !== M.webbing && mat !== M.lens;
      const keep = mat === M.flagRed || mat === M.flagWhite || mat === M.flagBlue;
      if (!keep && (d[2] < 0.026 || thinRod || mat === M.lace || mat === M.metal || mat === M.nail)) { const m = new THREE.Mesh(); dummy.add(m); return m; }
    }
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (mat === M.camo || mat === M.camoDS) camoColors(g);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
  };
  // geometry whose UVs we set ourselves (decals)
  const addRaw = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m;
  };
  const sphere = (r, sx = 1, sy = 1, sz = 1, ws = 10, hs = 7) => new THREE.SphereGeometry(r, LOW ? Math.max(6, Math.round(ws * 0.6)) : ws, LOW ? Math.max(4, Math.round(hs * 0.6)) : hs).scale(sx, sy, sz);
  const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  const root = node('Root', null);
  root.name = 'US_Soldier';

  // ===== PELVIS / HIPS =====
  const hips = node('Hips', root, 0, 0.95, 0);
  add(hips, loft([
    { y: -0.13, rx: 0.06, rz: 0.06 },
    { y: -0.10, rx: 0.15, rz: 0.10 },
    { y: -0.04, rx: 0.175, rz: 0.115, rzB: 0.125 },
    { y: 0.04, rx: 0.175, rz: 0.11, rzB: 0.12 },
    { y: 0.10, rx: 0.165, rz: 0.105 },
  ], 16, { jitter: 0.04 }), M.camo);
  // fly / seat seam
  add(hips, box(0.012, 0.12, 0.01), M.webDark, 0.02, -0.04, 0.113);

  // ===== LEGS =====
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const thigh = node('Thigh' + L, hips, 0.095 * s, -0.03, 0);
    add(thigh, loft([
      { y: 0.06, rx: 0.098, rz: 0.105 },
      { y: -0.04, rx: 0.096, rz: 0.104 },
      { y: -0.14, rx: 0.09, rz: 0.098, rzB: 0.095 },
      { y: -0.24, rx: 0.084, rz: 0.09 },
      { y: -0.33, rx: 0.077, rz: 0.083 },
      { y: -0.41, rx: 0.072, rz: 0.076 },
      { y: -0.46, rx: 0.068, rz: 0.072 },
    ], 14, { jitter: 0.07, js: s }), M.camo);
    // cargo pocket on outer front of thigh, with flap and buttons/velcro
    const pocket = new THREE.Group(); thigh.add(pocket);
    pocket.position.set(0.07 * s, -0.22, 0.03); pocket.rotation.y = s * 1.1;
    add(pocket, softBox(0.11, 0.16, 0.026, 0.012, 0.012), M.camo, 0, 0, 0);
    add(pocket, softBox(0.118, 0.045, 0.016, 0.008, 0.004), M.camo, 0, 0.072, 0.012, -0.15);
    add(pocket, box(0.08, 0.004, 0.004), M.webDark, 0, 0.05, 0.021);
    // side seam
    add(thigh, box(0.006, 0.44, 0.006), M.webDark, 0.093 * s, -0.2, -0.01, 0, 0, s * 0.06);

    // knee joint filler
    const shin = node('Shin' + L, thigh, 0, -0.43, 0);
    add(shin, sphere(0.072, 1, 1, 1.05, 12, 8), M.camo, 0, 0.0, 0);
    add(shin, loft([
      { y: 0.03, rx: 0.07, rz: 0.074 },
      { y: -0.06, rx: 0.064, rz: 0.066, rzB: 0.078 },
      { y: -0.15, rx: 0.06, rz: 0.062, rzB: 0.072 },
      { y: -0.23, rx: 0.058, rz: 0.06, rzB: 0.064 },
      { y: -0.28, rx: 0.069, rz: 0.072 },
      { y: -0.315, rx: 0.073, rz: 0.077 },
      { y: -0.335, rx: 0.068, rz: 0.072 },
      { y: -0.35, rx: 0.056, rz: 0.06 },
    ], 14, { jitter: 0.09, js: 5 + s }), M.camo);
    // calf pocket
    const calf = new THREE.Group(); shin.add(calf); calf.position.set(0.058 * s, -0.17, 0.0); calf.rotation.y = s * 1.57;
    add(calf, softBox(0.09, 0.11, 0.022, 0.008, 0.008), M.camo);
    add(calf, softBox(0.095, 0.035, 0.014, 0.006), M.camo, 0, 0.05, 0.01, -0.12);
    // knee pad (hard shell) + strap
    const pad = new THREE.Group(); shin.add(pad); pad.position.set(0, 0.0, 0.07);
    add(pad, loft([
      { y: -0.085, rx: 0.025, rz: 0.012, z: -0.01 },
      { y: -0.07, rx: 0.052, rz: 0.022, z: -0.008 },
      { y: -0.03, rx: 0.062, rz: 0.03 },
      { y: 0.02, rx: 0.062, rz: 0.03 },
      { y: 0.06, rx: 0.05, rz: 0.024, z: -0.006 },
      { y: 0.08, rx: 0.025, rz: 0.012, z: -0.012 },
    ], 16, { jitter: 0 }), M.kneepad, 0, 0, 0);
    for (const [rx, ry] of [[0.045, 0.045], [-0.045, 0.045], [0.048, -0.05], [-0.048, -0.05], [0, 0.07], [0, -0.075]]) {
      add(pad, sphere(0.0045, 1, 1, 0.6, 6, 4), M.metal, rx, ry, 0.022 + (Math.abs(ry) > 0.06 ? -0.01 : 0));
    }
    add(pad, softBox(0.05, 0.012, 0.01, 0.003), M.webDark, 0, -0.055, 0.025);
    for (const yy of [0.045, -0.045]) {
      add(shin, ribbon(ellipseArc(0.074, 0.08, yy, 60, 300, 14, 0.003), 0.022, 0.004, (p) => V(p.x, 0, p.z)), M.webDark);
    }

    // boot shaft (part of the shin)
    add(shin, loft([
      { y: -0.42, rx: 0.055, rz: 0.062, z: 0.0 },
      { y: -0.36, rx: 0.052, rz: 0.058 },
      { y: -0.30, rx: 0.053, rz: 0.056 },
      { y: -0.255, rx: 0.056, rz: 0.058 },
    ], 14), M.boot);
    // shaft laces / eyelets
    for (let k = 0; k < 4; k++) {
      const y = -0.40 + k * 0.035;
      for (const sx of [1, -1]) add(shin, cyl(0.0055, 0.0055, 0.004, 8), M.metal, 0.02 * sx, y, 0.056, Math.PI / 2);
      add(shin, tube([V(-0.02, y, 0.059), V(0, y + 0.017, 0.062), V(0.02, y + 0.035, 0.059)], 0.0028, 4, 6), M.lace);
      add(shin, tube([V(0.02, y, 0.059), V(0, y + 0.017, 0.063), V(-0.02, y + 0.035, 0.059)], 0.0028, 4, 6), M.lace);
    }
    add(shin, softBox(0.03, 0.17, 0.01, 0.004), M.bootDark, 0, -0.33, 0.052);
    // boot pull tab at back
    add(shin, softBox(0.025, 0.035, 0.008, 0.003), M.bootDark, 0, -0.255, -0.058);

    // ===== FOOT (ankle) =====
    const foot = node('Foot' + L, shin, 0, -0.41, 0);
    // upper (heel to ball) — loft along Z: build along Y then rotate
    const footSecs = (list) => list.map(([z, rx, ry, cy]) => ({ y: z, rx, rz: ry, z: -cy }));
    const toUp = (g) => g.rotateX(Math.PI / 2);
    add(foot, toUp(loft(footSecs([
      [-0.085, 0.040, 0.035, -0.04],
      [-0.07, 0.048, 0.055, -0.03],
      [-0.03, 0.052, 0.068, -0.02],
      [0.02, 0.052, 0.062, -0.03],
      [0.07, 0.055, 0.048, -0.045],
      [0.115, 0.056, 0.04, -0.052],
    ]), 14)), M.boot);
    // heel counter (darker leather)
    if (!LOW) add(foot, toUp(loft(footSecs([
      [-0.088, 0.041, 0.02, -0.065],
      [-0.07, 0.05, 0.03, -0.06],
      [-0.03, 0.054, 0.028, -0.062],
    ]), 14)), M.bootDark);
    // sole (heel part)
    add(foot, toUp(loft(footSecs([
      [-0.09, 0.044, 0.012, -0.078],
      [-0.06, 0.054, 0.013, -0.078],
      [0.0, 0.054, 0.013, -0.078],
      [0.06, 0.06, 0.013, -0.078],
      [0.115, 0.061, 0.013, -0.078],
    ]), 14)), M.sole);
    // instep laces / eyelets
    for (let k = 0; k < 3; k++) {
      const z = 0.075 - k * 0.032, y = -0.008 + k * 0.022;
      for (const sx of [1, -1]) add(foot, cyl(0.0055, 0.0055, 0.004, 8), M.metal, 0.021 * sx, y, z + 0.012, -0.9, 0, 0);
      add(foot, tube([V(-0.021, y, z + 0.014), V(0, y + 0.012, z + 0.002), V(0.021, y + 0.022, z - 0.018)], 0.0028, 4, 6), M.lace);
      add(foot, tube([V(0.021, y, z + 0.014), V(0, y + 0.012, z + 0.002), V(-0.021, y + 0.022, z - 0.018)], 0.0028, 4, 6), M.lace);
    }
    if (LOW) { // simple lace panels instead of individual laces
      add(shin, softBox(0.036, 0.15, 0.008, 0.003), M.lacePanel, 0, -0.335, 0.058);
      add(foot, softBox(0.034, 0.075, 0.008, 0.003), M.lacePanel, 0, 0.012, 0.062, -0.75, 0, 0);
    }
    // lugs on sole edge
    for (let k = 0; k < 5; k++) for (const sx of [1, -1]) {
      add(foot, box(0.01, 0.01, 0.018), M.sole, sx * (0.051 + (k > 2 ? 0.004 : 0)), -0.086, -0.075 + k * 0.042);
    }
    // ===== TOE joint =====
    const toe = node('Toe' + L, foot, 0, -0.06, 0.115);
    add(toe, toUp(loft(footSecs([
      [0.0, 0.056, 0.04, 0.008],
      [0.04, 0.054, 0.034, 0.002],
      [0.075, 0.046, 0.028, -0.002],
      [0.098, 0.03, 0.02, -0.006],
      [0.106, 0.012, 0.012, -0.008],
    ]), 14)), M.boot);
    // toe cap (rubber rand)
    if (!LOW) add(toe, toUp(loft(footSecs([
      [0.03, 0.057, 0.016, -0.012],
      [0.07, 0.05, 0.016, -0.012],
      [0.1, 0.033, 0.014, -0.013],
      [0.112, 0.012, 0.01, -0.014],
    ]), 14)), M.bootDark);
    add(toe, toUp(loft(footSecs([
      [0.0, 0.061, 0.013, -0.018],
      [0.06, 0.056, 0.013, -0.018],
      [0.1, 0.04, 0.012, -0.017],
      [0.118, 0.015, 0.01, -0.016],
    ]), 14)), M.sole);
    for (let k = 0; k < 3; k++) for (const sx of [1, -1]) add(toe, box(0.01, 0.01, 0.018), M.sole, sx * (0.054 - k * 0.006), -0.026, 0.012 + k * 0.035);
  }

  // ===== SPINE (waist) =====
  const spine = node('Spine', hips, 0, 0.09, 0);
  add(spine, loft([
    { y: -0.02, rx: 0.165, rz: 0.105 },
    { y: 0.08, rx: 0.16, rz: 0.10, rzB: 0.095 },
    { y: 0.18, rx: 0.165, rz: 0.105 },
  ], 16), M.camo);
  // IOTV lower body / cummerbund on spine
  const vRX = 0.198, vRZ = 0.142;
  add(spine, loft([
    { y: -0.07, rx: 0.19, rz: 0.135, p: 2.3 },
    { y: -0.05, rx: vRX, rz: vRZ, p: 2.3 },
    { y: 0.08, rx: vRX - 0.005, rz: vRZ - 0.006, p: 2.3 },
    { y: 0.19, rx: vRX, rz: vRZ, p: 2.3 },
  ], 20, { jitter: 0.02 }), M.camo);
  // groin protector flap
  add(spine, softBox(0.17, 0.1, 0.018, 0.012, 0.004), M.camo, 0, -0.1, 0.13, 0.12);
  // belt-level pouches on the IOTV skirt
  const pouchSet = [];
  const magPouch = (parent) => {
    const g = new THREE.Group(); parent.add(g);
    add(g, softBox(0.085, 0.13, 0.055, 0.012, 0.01), M.camo, 0, 0, 0.028);
    add(g, softBox(0.09, 0.045, 0.06, 0.01, 0.006), M.camo, 0, 0.058, 0.03);           // flap
    add(g, box(0.006, 0.125, 0.006), M.webbing, 0, -0.003, 0.064);                       // divider
    add(g, softBox(0.022, 0.032, 0.007, 0.003), M.webbing, 0, 0.045, 0.063);            // tab
    add(g, softBox(0.02, 0.012, 0.009, 0.002), M.black, 0, 0.03, 0.066);                 // snap
    add(g, box(0.07, 0.016, 0.004), M.webbing, 0, -0.02, 0.06);                          // molle strap
    return g;
  };
  const utilPouch = (parent, w, h, d) => {
    const g = new THREE.Group(); parent.add(g);
    add(g, softBox(w, h, d, 0.014, 0.012), M.camo, 0, 0, d / 2);
    add(g, softBox(w + 0.006, 0.04, d + 0.008, 0.01, 0.006), M.camo, 0, h / 2 - 0.012, d / 2 + 0.002);
    add(g, softBox(0.024, 0.03, 0.007, 0.003), M.webbing, 0, h / 2 - 0.03, d + 0.006);
    add(g, softBox(0.02, 0.012, 0.009, 0.002), M.black, 0, h / 2 - 0.045, d + 0.008);
    return g;
  };
  const nadePouch = (parent) => {
    const g = new THREE.Group(); parent.add(g);
    add(g, softBox(0.055, 0.075, 0.05, 0.016, 0.01), M.camo, 0, 0, 0.025);
    add(g, softBox(0.058, 0.03, 0.054, 0.012, 0.005), M.camo, 0, 0.035, 0.027);
    add(g, softBox(0.018, 0.022, 0.007, 0.003), M.webbing, 0, 0.022, 0.054);
    return g;
  };
  const py = 0.03;
  onEllipse(utilPouch(spine, 0.085, 0.12, 0.065), vRX, vRZ, -58, py + 0.005, 0.0);
  onEllipse(magPouch(spine), vRX, vRZ, -30, py, 0.0);
  onEllipse(magPouch(spine), vRX, vRZ, -4, py, 0.0);
  onEllipse(nadePouch(spine), vRX, vRZ, 18, py + 0.022, 0.0);
  onEllipse(nadePouch(spine), vRX, vRZ, 33, py + 0.022, 0.0);
  onEllipse(nadePouch(spine), vRX, vRZ, 18, py - 0.055, 0.0).scale.set(1, 0.85, 1);
  onEllipse(utilPouch(spine, 0.085, 0.10, 0.07), vRX, vRZ, 54, py + 0.02, 0.0);
  onEllipse(utilPouch(spine, 0.08, 0.13, 0.07), vRX, vRZ, 98, py, 0.0);
  onEllipse(utilPouch(spine, 0.08, 0.13, 0.07), vRX, vRZ, -98, py, 0.0);
  void pouchSet;
  // MOLLE rows on cummerbund
  for (const y of [0.12, 0.155]) {
    add(spine, ribbon(ellipseArc(vRX, vRZ, y, -80, 80, 20, 0.003), 0.024, 0.004, (p) => V(p.x / vRX / vRX, 0, p.z / vRZ / vRZ)), M.webbing);
  }

  // ===== CHEST =====
  const chest = node('Chest', spine, 0, 0.19, 0);
  add(chest, loft([
    { y: -0.03, rx: 0.165, rz: 0.105 },
    { y: 0.08, rx: 0.18, rz: 0.115 },
    { y: 0.18, rx: 0.19, rz: 0.11 },
    { y: 0.245, rx: 0.18, rz: 0.095 },
    { y: 0.285, rx: 0.13, rz: 0.08 },
    { y: 0.31, rx: 0.07, rz: 0.06 },
  ], 16), M.camo);
  // IOTV upper: front/back plates, side panels
  const cRX = 0.205, cRZ = 0.148;
  add(chest, loft([
    { y: -0.04, rx: vRX + 0.002, rz: vRZ + 0.002, p: 2.3 },
    { y: 0.06, rx: cRX, rz: cRZ, p: 2.3 },
    { y: 0.16, rx: cRX - 0.003, rz: cRZ - 0.002, p: 2.4 },
    { y: 0.215, rx: 0.17, rz: cRZ - 0.012, p: 2.6 },
    { y: 0.235, rx: 0.13, rz: 0.12, p: 2.6 },
  ], 22, { jitter: 0.02 }), M.camo);
  // front plate pocket bulge
  add(chest, softBox(0.27, 0.27, 0.03, 0.02, 0.008), M.camo, 0, 0.085, 0.138, -0.02);
  // MOLLE rows on front plate
  for (let k = 0; k < 4; k++) {
    const y = -0.01 + k * 0.034;
    add(chest, box(0.25, 0.022, 0.006), M.webbing, 0, y, 0.163 + k * 0.0005, -0.02);
  }
  for (let k = -3; k <= 3; k++) add(chest, box(0.004, 0.13, 0.004), M.webDark, k * 0.04, 0.04, 0.167, -0.02); // bartack splits
  // name-tape velcro
  add(chest, softBox(0.14, 0.03, 0.008, 0.003), M.velcro, 0, 0.165, 0.157, -0.05);
  // quick-release cross strap with buckle
  add(chest, ribbon([V(-0.2, 0.2, 0.07), V(-0.12, 0.205, 0.145), V(0, 0.205, 0.168), V(0.12, 0.205, 0.145), V(0.2, 0.2, 0.07)], 0.026, 0.005, (p) => V(p.x, 0, p.z)), M.webbing);
  const buckle = new THREE.Group(); chest.add(buckle); buckle.position.set(0, 0.205, 0.172);
  add(buckle, softBox(0.05, 0.034, 0.012, 0.004), M.black);
  add(buckle, box(0.012, 0.03, 0.006), M.webDark, 0.033, 0, 0);
  // back plate MOLLE
  for (let k = 0; k < 3; k++) add(chest, ribbon(ellipseArc(cRX, cRZ, 0.03 + k * 0.035, 150, 210, 10, 0.004), 0.022, 0.004, (p) => V(p.x, 0, p.z)), M.webbing);
  // IOTV collar / neck protector
  add(chest, loft([
    { y: 0.22, rx: 0.13, rz: 0.118 },
    { y: 0.27, rx: 0.11, rz: 0.1 },
    { y: 0.33, rx: 0.084, rz: 0.08, z: -0.006 },
    { y: 0.385, rx: 0.08, rz: 0.077, z: -0.008 },
  ], 18, { open: true, jitter: 0.04 }), M.camoDS);
  // collar fold seam + front flap
  add(chest, ribbon(ellipseArc(0.084, 0.08, 0.34, -150, 150, 18, 0.002, 0, -0.006), 0.008, 0.008, (p) => V(p.x, 0, p.z + 0.01)), M.camo);
  add(chest, softBox(0.07, 0.07, 0.02, 0.01, 0.004), M.camo, 0.015, 0.3, 0.085, -0.25, 0, 0.12);
  // IOTV shoulder straps (webbing over shoulders)
  for (const s of [1, -1]) {
    const pts = [V(0.11 * s, 0.05, 0.16), V(0.115 * s, 0.17, 0.155), V(0.12 * s, 0.25, 0.10), V(0.125 * s, 0.29, 0.0), V(0.12 * s, 0.25, -0.10), V(0.115 * s, 0.17, -0.15), V(0.11 * s, 0.06, -0.155)];
    add(chest, ribbon(pts, 0.065, 0.012, (p) => V(p.x * 0.3, p.y - 0.05, p.z)), M.camo);
    add(chest, ribbon(pts.map((p) => p.clone().multiplyScalar(1.0)), 0.03, 0.016, (p) => V(p.x * 0.3, p.y - 0.05, p.z)), M.webbing);
  }

  // ===== ASSAULT PACK (on chest) =====
  const pack = new THREE.Group(); pack.name = 'Soldier_Pack'; chest.add(pack); pack.position.set(0, 0.03, -0.24);
  add(pack, softBox(0.33, 0.44, 0.15, 0.035, 0.02), M.camo, 0, 0, 0, 0, Math.PI, 0); // main bag (bulge outward = -z)
  // upper compartment with US print
  add(pack, softBox(0.29, 0.18, 0.06, 0.03, 0.018), M.camo, 0, 0.09, -0.095, 0, Math.PI, 0);
  // lower pocket with MOLLE
  add(pack, softBox(0.3, 0.17, 0.06, 0.025, 0.015), M.camo, 0, -0.12, -0.095, 0, Math.PI, 0);
  for (let k = 0; k < 3; k++) add(pack, box(0.28, 0.022, 0.006), M.webbing, 0, -0.08 - k * 0.035, -0.142);
  for (let k = -3; k <= 3; k++) add(pack, box(0.004, 0.1, 0.005), M.webDark, k * 0.04, -0.115, -0.146);
  // zippers + pulls
  add(pack, tube([V(-0.13, 0.17, -0.12), V(-0.06, 0.185, -0.126), V(0.06, 0.185, -0.126), V(0.13, 0.17, -0.12)], 0.0035, 4, 12), M.webDark);
  add(pack, tube([V(-0.135, -0.03, -0.122), V(0, -0.025, -0.13), V(0.135, -0.03, -0.122)], 0.0035, 4, 12), M.webDark);
  for (const [x, y] of [[0.035, 0.17], [0.06, 0.165], [0.08, -0.03], [0.1, -0.03]]) {
    add(pack, tube([V(x, y, -0.13), V(x + 0.002, y - 0.03, -0.134), V(x + 0.001, y - 0.06, -0.133)], 0.0045, 5, 6), M.black);
  }
  // side compression straps
  for (const s of [1, -1]) for (const y of [0.1, -0.08]) {
    add(pack, ribbon([V(0.165 * s, y, 0.05), V(0.172 * s, y, -0.01), V(0.16 * s, y, -0.08)], 0.022, 0.004, () => V(s, 0, 0)), M.webbing);
    add(pack, softBox(0.006, 0.03, 0.018, 0.002), M.black, 0.175 * s, y, -0.02);
  }
  // top grab handle
  add(pack, ribbon([V(-0.05, 0.215, 0.0), V(-0.03, 0.235, -0.01), V(0.03, 0.235, -0.01), V(0.05, 0.215, 0.0)], 0.025, 0.006, (p) => V(0, 1, -0.2)), M.webbing);
  // pack shoulder straps
  for (const s of [1, -1]) {
    const pts = [V(0.08 * s, 0.205, 0.08), V(0.105 * s, 0.25, 0.19), V(0.12 * s, 0.275, 0.25), V(0.13 * s, 0.25, 0.33), V(0.15 * s, 0.17, 0.38), V(0.18 * s, 0.05, 0.37), V(0.2 * s, -0.06, 0.3), V(0.175 * s, -0.17, 0.1)];
    add(pack, ribbon(pts, 0.055, 0.016, (p) => V(p.x * 0.6, p.y - 0.0, p.z - 0.24)), M.webbing);
    add(pack, softBox(0.03, 0.04, 0.012, 0.004), M.black, 0.185 * s, 0.03, 0.375, 0, s * 0.5, 0);
  }
  // sternum strap with buckle
  add(chest, ribbon([V(-0.15, 0.24, 0.148), V(-0.07, 0.25, 0.172), V(0.07, 0.25, 0.172), V(0.15, 0.24, 0.148)], 0.018, 0.004, (p) => V(p.x, 0, p.z)), M.webDark);

  // ===== ARMS =====
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    const clav = node('Clavicle' + L, chest, 0.06 * s, 0.24, -0.01);
    // shoulder cap (deltoid) on clavicle so the joint stays covered
    add(clav, sphere(0.066, 1, 0.9, 0.95, 12, 8), M.camo, 0.128 * s, -0.008, 0);
    const upper = node('UpperArm' + L, clav, 0.135 * s, -0.01, 0);
    add(upper, loft([
      { y: 0.04, rx: 0.064, rz: 0.068 },
      { y: -0.04, rx: 0.064, rz: 0.066 },
      { y: -0.12, rx: 0.059, rz: 0.061 },
      { y: -0.2, rx: 0.054, rz: 0.056 },
      { y: -0.27, rx: 0.051, rz: 0.054 },
      { y: -0.3, rx: 0.049, rz: 0.052 },
    ], 12, { jitter: 0.08, js: 20 + s }), M.camo);
    // shoulder pocket + patch
    const sp = new THREE.Group(); upper.add(sp); sp.position.set(0.057 * s, -0.09, 0.005); sp.rotation.y = s * Math.PI / 2; sp.rotation.x = 0.05;
    add(sp, softBox(0.085, 0.12, 0.018, 0.008, 0.01), M.camo);
    add(sp, softBox(0.09, 0.03, 0.012, 0.005), M.camo, 0, 0.06, 0.008, -0.12);
    if (s < 0) {
      add(sp, softBox(0.078, 0.052, 0.006, 0.004), M.tanLight, 0, -0.005, 0.017);
      add(sp, box(0.072, 0.046, 0.003), M.flagWhite, 0, -0.005, 0.0205);
      for (let k = 0; k < 4; k++) add(sp, box(0.072, 0.0058, 0.003), M.flagRed, 0, -0.005 + 0.0203 - k * 0.0116 - 0.0029 * (k > 1 ? 1 : 0), 0.0215);
      add(sp, box(0.031, 0.025, 0.003), M.flagBlue, 0.0205, 0.0055, 0.0225);
    } else {
      add(sp, softBox(0.07, 0.07, 0.006, 0.004), M.velcro, 0, -0.01, 0.017);
    }
    // elbow joint
    const fore = node('Forearm' + L, upper, 0, -0.29, 0);
    add(fore, sphere(0.048, 1, 1, 1.03, 12, 8), M.camo);
    add(fore, loft([
      { y: 0.02, rx: 0.05, rz: 0.053 },
      { y: -0.06, rx: 0.05, rz: 0.055 },
      { y: -0.14, rx: 0.046, rz: 0.05 },
      { y: -0.2, rx: 0.044, rz: 0.047 },
      { y: -0.235, rx: 0.047, rz: 0.05 },
      { y: -0.25, rx: 0.046, rz: 0.049 },
    ], 12, { jitter: 0.09, js: 30 + s }), M.camo);
    // cuff velcro tab
    add(fore, softBox(0.03, 0.018, 0.008, 0.003), M.camo, 0.0, -0.232, -0.05);
    // wrist (skin bridge) hidden under cuff
    add(fore, loft([{ y: -0.2, rx: 0.025, rz: 0.031 }, { y: -0.262, rx: 0.021, rz: 0.029 }], 10), M.skin);

    // ===== HAND (wrist joint) — palm faces the body, thumb forward =====
    const hand = node('Hand' + L, fore, 0, -0.265, 0);
    add(hand, loft([
      { y: 0.01, rx: 0.02, rz: 0.03 },
      { y: -0.02, rx: 0.019, rz: 0.04 },
      { y: -0.06, rx: 0.017, rz: 0.045, x: -0.002 * s },
      { y: -0.08, rx: 0.0155, rz: 0.044, x: -0.002 * s },
      { y: -0.092, rx: 0.011, rz: 0.04, x: -0.002 * s },
    ], 14), M.skin);
    // thenar pad (thumb muscle)
    add(hand, sphere(0.014, 0.9, 1.5, 1, 8, 6), M.skin, -0.006 * s, -0.035, 0.028);
    // knuckle bumps
    
    if (LOW) {
      const f1 = node('Fingers1' + L, hand, -0.002 * s, -0.086, 0.0);
      add(f1, loft([{ y: 0.01, rx: 0.011, rz: 0.04 }, { y: -0.045, rx: 0.0105, rz: 0.038 }], 8), M.skin);
      const f2 = node('Fingers2' + L, f1, 0, -0.045, 0);
      add(f2, loft([{ y: 0.005, rx: 0.0105, rz: 0.038 }, { y: -0.026, rx: 0.009, rz: 0.034 }, { y: -0.036, rx: 0.005, rz: 0.028, z: 0.002 }], 8), M.skin);
      f1.rotation.z = -s * 0.18; f2.rotation.z = -s * 0.35;
      const t1 = node('Thumb1' + L, hand, -0.01 * s, -0.025, 0.036);
      add(t1, loft([{ y: 0.004, rx: 0.011, rz: 0.012 }, { y: -0.04, rx: 0.0095, rz: 0.01 }, { y: -0.058, rx: 0.006, rz: 0.006 }], 6), M.skin);
      node('Thumb2' + L, t1, 0, -0.035, 0);
      t1.rotation.set(-0.55, 0, -s * 0.3);
    }
    const fingers = LOW ? [] : [['Index', 0.028, 0.044, 0.028, 0.0098], ['Middle', 0.0095, 0.048, 0.031, 0.01], ['Ring', -0.0095, 0.045, 0.029, 0.0095], ['Pinky', -0.027, 0.034, 0.024, 0.0083]];
    for (const [nm, z, l1, l2, r] of fingers) {
      const f1 = node(nm + '1' + L, hand, -0.002 * s, -0.086, z);
      add(f1, loft([{ y: 0.012, rx: r * 0.9, rz: r }, { y: -l1 * 0.5, rx: r * 0.88, rz: r * 0.94 }, { y: -l1, rx: r * 0.84, rz: r * 0.9 }], 8), M.skin);
      add(f1, sphere(r * 0.84, 1, 1, 1.05, 8, 5), M.skin, 0, -l1, 0);
      const f2 = node(nm + '2' + L, f1, 0, -l1, 0);
      add(f2, loft([{ y: 0.002, rx: r * 0.86, rz: r * 0.9 }, { y: -l2 * 0.7, rx: r * 0.78, rz: r * 0.82 }, { y: -l2 * 0.92, rx: r * 0.6, rz: r * 0.65 }, { y: -l2, rx: r * 0.3, rz: r * 0.35 }], 8), M.skin);
      add(f2, box(r * 0.25, l2 * 0.34, r * 1.15), M.nail, r * 0.72 * s, -l2 * 0.68, 0);
      // natural rest curl
      f1.rotation.z = -s * 0.18; f2.rotation.z = -s * 0.32;
    }
    if (!LOW) {
    const t1 = node('Thumb1' + L, hand, -0.01 * s, -0.025, 0.036);
    add(t1, loft([{ y: 0.0, rx: 0.011, rz: 0.012 }, { y: -0.035, rx: 0.0105, rz: 0.011 }], 7), M.skin);
    add(t1, sphere(0.0102, 1, 1, 1, 7, 5), M.skin, 0, -0.035, 0);
    const t2 = node('Thumb2' + L, t1, 0, -0.035, 0);
    add(t2, loft([{ y: 0.0, rx: 0.0098, rz: 0.0105 }, { y: -0.022, rx: 0.009, rz: 0.0095 }, { y: -0.032, rx: 0.006, rz: 0.006 }], 7), M.skin);
    add(t2, box(0.0025, 0.012, 0.012), M.nail, -0.008 * s, -0.022, 0.0);
    t1.rotation.set(-0.55, 0, -s * 0.25); t2.rotation.z = -s * 0.25;
    }
    // weapon socket in the grip
    const sock = new THREE.Group(); sock.name = 'Socket_Hand' + L; sock.position.set(-0.025 * s, -0.07, 0.0); hand.add(sock);
  }

  // ===== NECK / HEAD =====
  const neck = node('Neck', chest, 0, 0.3, 0.005);
  add(neck, loft([
    { y: -0.04, rx: 0.06, rz: 0.058 },
    { y: 0.05, rx: 0.053, rz: 0.054 },
    { y: 0.11, rx: 0.055, rz: 0.058, z: 0.005 },
  ], 12), M.skin);
  // adam's apple
  add(neck, sphere(0.012, 1, 1.4, 1, 6, 4), M.skin, 0, 0.055, 0.047);
  const head = node('Head', neck, 0, 0.1, 0.012);
  add(head, loft([
    { y: -0.038, rx: 0.02, rz: 0.016, z: 0.064 },
    { y: -0.033, rx: 0.034, rz: 0.03, z: 0.058, p: 2.2 },
    { y: -0.022, rx: 0.05, rz: 0.05, z: 0.04, p: 2.4 },
    { y: -0.008, rx: 0.06, rz: 0.072, z: 0.016, rzB: 0.06, p: 2.4 },
    { y: 0.01, rx: 0.067, rz: 0.086, z: 0.006, rzB: 0.072, p: 2.3 },
    { y: 0.035, rx: 0.069, rz: 0.093, z: 0.002, rzB: 0.083, p: 2.25 },
    { y: 0.065, rx: 0.073, rz: 0.096, z: -0.002, rzB: 0.093, p: 2.25 },
    { y: 0.095, rx: 0.076, rz: 0.097, z: -0.007, rzB: 0.099, p: 2.2 },
    { y: 0.125, rx: 0.077, rz: 0.096, z: -0.011, rzB: 0.1 },
    { y: 0.155, rx: 0.073, rz: 0.09, z: -0.014 },
    { y: 0.185, rx: 0.06, rz: 0.075, z: -0.016 },
    { y: 0.207, rx: 0.038, rz: 0.048, z: -0.016 },
    { y: 0.218, rx: 0.01, rz: 0.012, z: -0.016 },
  ], 22, { jitter: 0 }), M.skin);
  // jaw angle
  for (const s of [1, -1]) add(head, sphere(0.017, 1, 1.1, 1.5, 8, 6), M.skin, 0.052 * s, 0.0, 0.028);
  // chin + lower lip
  add(head, sphere(0.02, 1.3, 0.8, 0.75, 10, 6), M.skin, 0, -0.024, 0.071);
  add(head, sphere(0.012, 1.7, 0.6, 0.7, 10, 5), M.lip, 0, -0.001, 0.086);
  // nose
  add(head, loft([
    { y: 0.032, rx: 0.016, rz: 0.008, z: 0.094 },
    { y: 0.039, rx: 0.015, rz: 0.016, z: 0.1 },
    { y: 0.05, rx: 0.011, rz: 0.015, z: 0.1 },
    { y: 0.08, rx: 0.008, rz: 0.01, z: 0.097 },
    { y: 0.1, rx: 0.008, rz: 0.006, z: 0.093 },
  ], 10), M.skin);
  for (const s of [1, -1]) add(head, sphere(0.0065, 1, 0.8, 1, 6, 4), M.skin, 0.0105 * s, 0.038, 0.099);
  // mouth / lips
  add(head, loft([{ y: 0.006, rx: 0.02, rz: 0.005, z: 0.086 }, { y: 0.011, rx: 0.022, rz: 0.007, z: 0.088 }, { y: 0.015, rx: 0.017, rz: 0.005, z: 0.088 }], 10), M.lip);
  add(head, box(0.04, 0.002, 0.004), M.skinDark, 0, 0.006, 0.092);
  // moustache (short, dark)
  add(head, loft([{ y: 0.016, rx: 0.026, rz: 0.006, z: 0.088 }, { y: 0.024, rx: 0.024, rz: 0.007, z: 0.091 }, { y: 0.028, rx: 0.014, rz: 0.004, z: 0.091 }], 10), M.hair);
  // ears
  for (const s of [1, -1]) {
    add(head, sphere(0.022, 0.45, 1.25, 0.8, 8, 6), M.skin, 0.077 * s, 0.07, -0.01, 0, 0, -s * 0.15);
    add(head, sphere(0.01, 0.4, 1, 0.8, 6, 4), M.skinDark, 0.081 * s, 0.065, -0.006);
  }
  // short hair at nape / sideburns
  add(head, loft([{ y: 0.0, rx: 0.07, rz: 0.075, z: -0.02 }, { y: 0.07, rx: 0.079, rz: 0.098, z: -0.012 }, { y: 0.11, rx: 0.08, rz: 0.1, z: -0.012 }], 16, { open: true }), M.hair).visible = false;
  // eyebrow ridge (shadowed by glasses)
  add(head, box(0.11, 0.012, 0.02), M.skin, 0, 0.11, 0.087);

  // ESS-style ballistic glasses
  const glasses = new THREE.Group(); glasses.name = 'Soldier_Glasses'; head.add(glasses);
  const gArc = ellipseArc(0.085, 0.104, 0.085, -78, 78, 24, 0, 0, -0.006);
  add(glasses, ribbon(gArc, 0.042, 0.004, (p) => V(p.x, 0, p.z + 0.006), (t) => 0.62 + 0.38 * Math.sin(Math.PI * t)), M.lens);
  add(glasses, ribbon(ellipseArc(0.086, 0.105, 0.106, -80, 80, 24, 0.001, 0, -0.006), 0.006, 0.006, (p) => V(p.x, 0, p.z)), M.black);
  // nose bridge piece
  add(glasses, softBox(0.022, 0.012, 0.008, 0.003), M.black, 0, 0.068, 0.1);
  for (const s of [1, -1]) add(glasses, tube([V(0.078 * s, 0.098, 0.04), V(0.082 * s, 0.095, -0.0), V(0.08 * s, 0.085, -0.05)], 0.0028, 4, 6), M.black);

  // ===== ACH HELMET =====
  const helmet = new THREE.Group(); helmet.name = 'Soldier_Helmet'; head.add(helmet);
  const H = { cy: 0.112, cz: -0.012, rx: 0.12, ry: 0.135, rz: 0.138 };
  const rimY = (a) => 0.074 + 0.042 * Math.cos(a) - 0.012 * Math.pow(Math.sin(a), 2);
  {
    const seg = 28, rings = 10, pos = [], idx = [];
    const top = H.cy + H.ry;
    for (let j = 0; j <= rings; j++) for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const t = j / rings;
      const yb = rimY(a);
      const y = top + (yb - top) * Math.pow(t, 0.85);
      let r = y > H.cy ? Math.sqrt(Math.max(0, 1 - Math.pow((y - H.cy) / H.ry, 2))) : 1 + 0.18 * (H.cy - y);
      r = Math.max(r, j === 0 ? 0 : 0.0);
      pos.push(Math.sin(a) * H.rx * r, y, H.cz + Math.cos(a) * H.rz * r);
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
      const a = j * seg + i, b = j * seg + (i + 1) % seg, c = a + seg, d = b + seg;
      idx.push(a, d, b, a, c, d);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const shell = add(helmet, g, M.camo); shell.material = M.camo;
    // inner shell (dark) slightly inside, flipped
    const gi = g.clone(); gi.scale(0.93, 0.97, 0.93); gi.translate(0, 0.004, -0.001);
    const ii = gi.index.array; for (let k = 0; k < ii.length; k += 3) { const t = ii[k]; ii[k] = ii[k + 1]; ii[k + 1] = t; }
    add(helmet, gi, M.webDark);
    // rim edge trim
    const rimPts = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; const y = rimY(a); const r = y > H.cy ? Math.sqrt(1 - Math.pow((y - H.cy) / H.ry, 2)) : 1 + 0.18 * (H.cy - y); rimPts.push(V(Math.sin(a) * H.rx * r * 0.985, y + 0.002, H.cz + Math.cos(a) * H.rz * r * 0.985)); }
    add(helmet, ribbon(rimPts, 0.008, 0.01, (p) => V(p.x, 0, p.z - H.cz)), M.camo);
  }
  const helmetPt = (a, y, out = 0) => {
    const r = y > H.cy ? Math.sqrt(Math.max(0, 1 - Math.pow((y - H.cy) / H.ry, 2))) : 1 + 0.18 * (H.cy - y);
    return V(Math.sin(a) * (H.rx * r + out), y, H.cz + Math.cos(a) * (H.rz * r + out));
  };
  // cat-eye band (tan) around helmet
  {
    const pts = []; for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2; pts.push(helmetPt(a, 0.15 - 0.012 * Math.cos(a), 0.004)); }
    add(helmet, ribbon(pts, 0.022, 0.004, (p) => V(p.x, (p.y - H.cy) * 0.6, p.z - H.cz)), M.tanLight);
  }
  // cover seam / drawstring rim
  // velcro patch & cover pocket at back
  {
    const back = new THREE.Group(); helmet.add(back);
    const p = helmetPt(Math.PI, 0.15, 0.004); back.position.copy(p); back.rotation.y = Math.PI; back.rotation.x = -0.25;
    add(back, softBox(0.07, 0.025, 0.012, 0.004), M.camo, 0, -0.035, 0.002);
    add(back, softBox(0.06, 0.012, 0.008, 0.003), M.webDark, 0, -0.063, 0.0);
    // band retaining tabs + snaps
    for (const s of [1, -1]) {
      add(back, softBox(0.014, 0.05, 0.006, 0.002), M.webDark, 0.052 * s, -0.015, 0.006, 0, 0, 0);
      add(back, cyl(0.006, 0.006, 0.004, 8), M.metal, 0.052 * s, -0.03, 0.01, Math.PI / 2);
    }
  }
  // side rail bolts / accessory pads
  for (const s of [1, -1]) {
    for (const a of [0.9, 2.3]) {
      const p = helmetPt(a * s, 0.095, 0.002);
      const m = add(helmet, cyl(0.007, 0.007, 0.006, 8), M.webDark, p.x, p.y, p.z, 0, 0, 0);
      m.lookAt(p.clone().multiplyScalar(2).sub(V(0, p.y, H.cz))); m.rotateX(Math.PI / 2);
    }
    const sp = helmetPt(s * Math.PI / 2, 0.11, 0.002);
    const rail = add(helmet, softBox(0.012, 0.018, 0.05, 0.003), M.webDark, sp.x, sp.y, sp.z);
    rail.rotation.z = -s * 0.12;
  }
  // NVG shroud / mount (front)
  {
    const nv = new THREE.Group(); helmet.add(nv);
    nv.position.copy(helmetPt(0, 0.165, 0.002)); nv.rotation.x = -0.25;
    add(nv, softBox(0.05, 0.03, 0.006, 0.004), M.tanLight, 0, -0.032, 0.0);
    add(nv, softBox(0.03, 0.055, 0.012, 0.003), M.black, 0, 0.0, 0.006);
    add(nv, softBox(0.04, 0.03, 0.03, 0.004), M.black, 0, 0.025, 0.02);
    add(nv, softBox(0.026, 0.045, 0.02, 0.004), M.black, 0, -0.005, 0.03);
    add(nv, cyl(0.006, 0.006, 0.046, 8), M.black, 0, 0.03, 0.04, 0, 0, Math.PI / 2);
    add(nv, softBox(0.012, 0.012, 0.01, 0.002), M.webDark, 0.018, -0.01, 0.022);
  }
  // 4-point chin strap: front & rear legs meet at buckle on jaw
  for (const s of [1, -1]) {
    const fA = V(0.1 * s, 0.098, 0.065), rA = V(0.105 * s, 0.075, -0.06), j = V(0.07 * s, -0.005, 0.045);
    add(helmet, tube([fA, V(0.09 * s, 0.05, 0.06), j], 0.0045, 4, 8), M.webbing);
    add(helmet, tube([rA, V(0.088 * s, 0.03, -0.01), j], 0.0045, 4, 8), M.webbing);
    add(helmet, softBox(0.012, 0.02, 0.008, 0.003), M.black, j.x, j.y + 0.01, j.z, 0, s * 0.6, s * 0.3);
  }
  add(helmet, tube([V(0.07, -0.005, 0.045), V(0.045, -0.04, 0.06), V(0, -0.052, 0.068), V(-0.045, -0.04, 0.06), V(-0.07, -0.005, 0.045)], 0.005, 4, 14), M.webbing);
  add(helmet, softBox(0.03, 0.022, 0.012, 0.004), M.webDark, 0, -0.05, 0.072);

  // ----- default A-pose (matches the reference turnaround) -----
  for (const s of [1, -1]) {
    const L = s > 0 ? 'L' : 'R';
    joints['UpperArm' + L].rotation.z = s * 0.78;
    joints['Forearm' + L].rotation.x = -0.12;
    joints['Hand' + L].rotation.z = s * 0.1;
  }
  if (LOW || opts.merge) mergeByJoint(root, joints);
  { root.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(root); joints.Hips.position.y -= bb.min.y; } // feet exactly on y = 0
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { root, joints, materials: M };
}

// remove zero-area triangles (they produce zero-length normals)
function dropDegenerate(g) {
  const p = g.attributes.position, keep = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    if (b.sub(a).cross(c.sub(a)).length() > 1e-9) keep.push(i, i + 1, i + 2);
  }
  if (keep.length === p.count) return g;
  const out = new THREE.BufferGeometry();
  for (const k of Object.keys(g.attributes)) {
    const at = g.attributes[k], arr = new Float32Array(keep.length * at.itemSize);
    keep.forEach((src, d) => { for (let j = 0; j < at.itemSize; j++) arr[d * at.itemSize + j] = at.array[src * at.itemSize + j]; });
    out.setAttribute(k, new THREE.BufferAttribute(arr, at.itemSize));
  }
  return out;
}

// Bake every mesh into one mesh per (joint, material): far fewer draw calls.
function mergeByJoint(root, joints) {
  root.updateMatrixWorld(true);
  const jset = new Set(Object.values(joints));
  const buckets = new Map(), meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count) meshes.push(o); });
  for (const m of meshes) {
    let j = m.parent; while (j && !jset.has(j)) j = j.parent;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    g = dropDegenerate(g);
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    const rel = new THREE.Matrix4().copy(j.matrixWorld).invert().multiply(m.matrixWorld);
    g.applyMatrix4(rel);
    const key = j.uuid + '|' + m.material.uuid;
    if (!buckets.has(key)) buckets.set(key, { j, mat: m.material, geos: [] });
    buckets.get(key).geos.push(g);
    m.parent.remove(m);
  }
  for (const { j, mat, geos } of buckets.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
    mesh.name = j.name + '_' + mat.name; j.add(mesh);
  }
  // drop now-empty helper groups (keep joints and sockets)
  const empties = []; root.traverse((o) => { if (!jset.has(o) && o !== root && !o.isMesh && !o.name.startsWith('Socket') && o.children.length === 0) empties.push(o); });
  empties.forEach((o) => o.parent && o.parent.remove(o));
}

// ---------- poses ----------
const POSES = {
  apose: {},
  stand: { UpperArmL: [0, 0, 0.12], UpperArmR: [0, 0, -0.12], ForearmL: [-0.25, 0, 0], ForearmR: [-0.25, 0, 0], HandL: [0, 0, 0.05], HandR: [0, 0, -0.05] },
  walk: {
    ThighL: [-0.45, 0, 0], ShinL: [0.15, 0, 0], FootL: [0.2, 0, 0],
    ThighR: [0.35, 0, 0], ShinR: [0.55, 0, 0], FootR: [-0.1, 0, 0], ToeR: [0.35, 0, 0],
    UpperArmL: [0.4, 0, 0.12], UpperArmR: [-0.45, 0, -0.12], ForearmL: [-0.3, 0, 0], ForearmR: [-0.6, 0, 0],
    Spine: [0.05, 0.08, 0], Chest: [0, 0.06, 0], Neck: [0, -0.08, 0], Head: [-0.04, -0.06, 0],
  },
  kneel: {
    Hips: [0, 0, 0], ThighL: [-1.45, 0.1, 0], ShinL: [1.5, 0, 0], FootL: [0.0, 0, 0],
    ThighR: [0.1, -0.1, 0], ShinR: [1.95, 0, 0], FootR: [-0.6, 0, 0], ToeR: [0.9, 0, 0],
    Spine: [0.12, 0, 0], Chest: [0.05, 0, 0], Neck: [-0.1, 0, 0], Head: [-0.1, 0.25, 0],
    UpperArmL: [-0.9, 0.2, 0.25], ForearmL: [-1.3, 0, 0.0], UpperArmR: [-0.4, 0, -0.45], ForearmR: [-1.6, 0, 0],
    HandL: [0, 0, 0.3], HandR: [0.3, 0, 0],
  },
  fist: {},
};
function applyPose(soldier, name) {
  const { joints, root } = soldier;
  // reset to rest
  if (!soldier._rest) { soldier._rest = {}; for (const k in joints) soldier._rest[k] = joints[k].rotation.clone(); soldier._restY = joints.Hips.position.y; }
  for (const k in joints) joints[k].rotation.copy(soldier._rest[k]);
  joints.Hips.position.y = soldier._restY;
  const p = POSES[name] || {};
  for (const k in p) { const j = joints[k]; if (j) j.rotation.set(p[k][0], p[k][1], p[k][2]); }
  if (name === 'kneel') joints.Hips.position.y = 0.5;
  if (name === 'fist' || name === 'kneel') {
    for (const s of ['L', 'R']) {
      const sg = s === 'L' ? 1 : -1;
      for (const f of ['Index', 'Middle', 'Ring', 'Pinky', 'Fingers']) { if (!joints[f + '1' + s]) continue; joints[f + '1' + s].rotation.z = -sg * 1.3; joints[f + '2' + s].rotation.z = -sg * 1.5; }
      joints['Thumb1' + s].rotation.set(-0.9, 0, -sg * 0.7); joints['Thumb2' + s].rotation.z = -sg * 0.6;
    }
  }
  root.updateMatrixWorld(true);
}

export { buildSoldier, applyPose, POSES };
