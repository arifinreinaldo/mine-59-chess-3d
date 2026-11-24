import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { Chess } from 'chess.js';
import SKINS from './skins.json';
import PROPS from './props.json';

/* ---------- constants ---------- */
const TILE = 2;
const ROLE = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const HEIGHT = { pawn: 1.1, knight: 1.5, bishop: 1.6, rook: 1.5, queen: 1.8, king: 2.0 };
const FOOT = 1.7;                       // max footprint for non-humanoid models
const LIFT = { 'single-engine-fighter-a6addf': 0.9 };   // flying pieces hover
const TEAM = { w: new THREE.Color(0xf2f2f2), b: new THREE.Color(0x2a2a33) };
const LEVELS = {
  Beginner: { skill: 0, ms: 120 }, Casual: { skill: 5, ms: 300 }, Club: { skill: 10, ms: 600 },
  Strong: { skill: 15, ms: 1000 }, Maximum: { skill: 20, ms: 1500 },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqPos = (sq) => new THREE.Vector3((sq.charCodeAt(0) - 97 + 0.5) * TILE, 0, (8 - +sq[1] + 0.5) * TILE);

/* ---------- scene ---------- */
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x181b22);
const hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 1.7); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(6, 14, 10); scene.add(sun);
const cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 120);
const camBase = new THREE.Vector3(8, 17.5, 22.5);
cam.position.copy(camBase); cam.lookAt(8, 0, 8.2);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); });

const frame = new THREE.Mesh(new THREE.BoxGeometry(17, 0.5, 17), new THREE.MeshLambertMaterial({ color: 0x3a2a1c }));
frame.position.set(8, -0.37, 8); scene.add(frame);
const tiles = new Map();
const tileGeo = new THREE.BoxGeometry(TILE * 0.98, 0.24, TILE * 0.98);
for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) {
  const sq = String.fromCharCode(97 + f) + r;
  const m = new THREE.Mesh(tileGeo, new THREE.MeshLambertMaterial({ color: (f + r) % 2 ? 0xd6c6a2 : 0x6d5b46 }));
  m.position.copy(sqPos(sq)); m.position.y = -0.12; m.userData.sq = sq;
  scene.add(m); tiles.set(sq, m);
}

/* ---------- tween + effects ---------- */
const tweens = [];
function tween(dur, fn) {
  return new Promise((res) => tweens.push({ t: 0, dur, fn, res }));
}
function stepTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i]; w.t += dt; const p = Math.min(w.t / w.dur, 1);
    w.fn(p);
    if (p >= 1) { tweens.splice(i, 1); w.res(); }
  }
}
function flash(pos, color = 0xffaa33, size = 0.9) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ color, transparent: true }));
  m.position.copy(pos); m.position.y += 1; scene.add(m);
  return tween(0.35, (p) => { m.scale.setScalar(0.2 + size * p); m.material.opacity = 1 - p; })
    .then(() => { scene.remove(m); m.geometry.dispose(); m.material.dispose(); });
}
function shake(amount = 0.25) {
  return tween(0.25, (p) => {
    const k = (1 - p) * amount;
    cam.position.set(camBase.x + Math.sin(p * 50) * k, camBase.y + Math.cos(p * 43) * k * 0.5, camBase.z);
  }).then(() => cam.position.copy(camBase));
}

/* ---------- models ---------- */
const gltfLoader = new GLTFLoader();
const modelCache = new Map();
function loadModel(id) {
  if (!modelCache.has(id)) modelCache.set(id, new Promise((res, rej) => gltfLoader.load(`assets/${id}.glb`, res, undefined, rej)));
  return modelCache.get(id);
}
const scaleCache = new Map();
function modelScale(info, role, gltf) {
  const key = info.id + role;
  if (!scaleCache.has(key)) {
    const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    let s = HEIGHT[role] / size.y;
    if (!info.skeleton) s = Math.min(s, FOOT / Math.max(size.x, size.z));
    scaleCache.set(key, s);
  }
  return scaleCache.get(key);
}

const pieces = new Set();
const pieceAt = new Map();

function makeCrown(y) {
  const g = new THREE.Group(); g.position.y = y;
  const mat = new THREE.MeshLambertMaterial({ color: 0xd4af37, emissive: 0x4a3500 });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.22, 10), mat);
  band.position.y = 0.11; g.add(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.3, 6), mat);
    spike.position.set(Math.sin(a) * 0.24, 0.37, Math.cos(a) * 0.24); g.add(spike);
  }
  return g;
}
async function createPiece(skinKey, role, team, sq) {
  const info = SKINS[skinKey].pieces[role];
  const gltf = await loadModel(info.id);
  const inner = skClone(gltf.scene);
  const s = modelScale(info, role, gltf);
  inner.scale.setScalar(s);
  inner.traverse((o) => {
    if (o.isMesh) { o.material = o.material.clone(); o.material.color.lerp(TEAM[team], 0.3); }
  });
  const root = new THREE.Group(); root.add(inner);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.82, 32), new THREE.MeshBasicMaterial({ color: TEAM[team], side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; root.add(ring); root.userData.ring = ring;
  if (role === 'king') {
    const top = new THREE.Box3().setFromObject(inner).max.y;
    const crown = makeCrown(top + 0.12); root.add(crown); root.userData.crown = crown;
  }
  const p = {
    root, inner, role, team, sq, info, skinKey, swing: 0, lift: LIFT[info.id] || 0,
    humanoid: !!info.skeleton, mixer: null, actions: {}, cur: null, arm: null, dead: false,
  };
  inner.traverse((o) => { if (o.isBone && /RightArm$/.test(o.name)) p.arm = o; });
  if (gltf.animations.length) {
    p.mixer = new THREE.AnimationMixer(inner);
    for (const c of gltf.animations) p.actions[c.name] = p.mixer.clipAction(c);
  }
  root.userData.piece = p;
  root.position.copy(sqPos(sq)); root.position.y = p.lift;
  root.rotation.y = team === 'w' ? Math.PI : 0;
  play(p, 'Idle', { offset: true });
  scene.add(root); pieces.add(p); pieceAt.set(sq, p);
  return p;
}
function play(p, name, o = {}) {
  const a = p.actions[name]; if (!a) return null;
  if (p.cur === a && !o.once) return a;
  const prev = p.cur;
  a.reset().setEffectiveTimeScale(o.timeScale || 1).setEffectiveWeight(1);
  if (prev && prev !== a) { prev.fadeOut(0.2); a.fadeIn(0.2); }
  if (o.once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
  if (o.offset) a.time = Math.random() * a.getClip().duration;
  a.play(); p.cur = a; return a;
}
function removePiece(p) {
  scene.remove(p.root); pieces.delete(p);
  if (pieceAt.get(p.sq) === p) pieceAt.delete(p.sq);
  p.mixer?.stopAllAction();
  // Free only what this piece owns: per-piece material clones, its ring, its skeleton clone.
  // Model geometry and textures are shared through the glTF cache, so they stay.
  p.inner.traverse((o) => {
    if (o.isMesh) { const m = o.material; (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose()); }
    if (o.isSkinnedMesh) o.skeleton.dispose();
  });
  if (p.mixer) p.mixer.uncacheRoot(p.inner);
  const ring = p.root.userData.ring;
  if (ring) { ring.geometry.dispose(); ring.material.dispose(); }
  const crown = p.root.userData.crown;
  if (crown) crown.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}

/* ---------- piece animations ---------- */
function face(p, to) {
  const d = to.clone().sub(p.root.position); p.root.rotation.y = Math.atan2(d.x, d.z);
}
function restFacing(p) { p.root.rotation.y = p.team === 'w' ? Math.PI : 0; }
async function slide(p, to, dur = 0.55, hop = 0) {
  const from = p.root.position.clone(); to = to.clone(); to.y = p.lift;
  face(p, to);
  play(p, 'Walk');
  await tween(dur, (k) => {
    p.root.position.lerpVectors(from, to, k);
    p.root.position.y = p.lift + hop * Math.sin(Math.PI * k);
  });
  play(p, 'Idle');
}
// Attack style per piece as [melee, ranged]: melee at 1 square, ranged further out.
const STYLE = {
  dragons: { pawn: ['bite', 'bite'], knight: ['spear', 'spear'], bishop: ['slash', 'missile'], rook: ['bite', 'breath'], queen: ['bite', 'breath'], king: ['bite', 'bite'] },
  ww2: { pawn: ['bite', 'shot'], knight: ['ram', 'ram'], bishop: ['shot', 'shot'], rook: ['cannon', 'cannon'], queen: ['strafe', 'strafe'], king: ['shot', 'shot'] },
};
const styleOf = (p, d) => { const pair = STYLE[p.skinKey]?.[p.role]; return pair ? pair[d <= 1 ? 0 : 1] : (p.humanoid ? 'slash' : 'bite'); };
const HIT = { missile: 0xc9a8ff, spear: 0xffd27a, shot: 0xffd27a, cannon: 0xffb050, strafe: 0xffe9a8, ram: 0xe6eeff, slash: 0xe6eeff, bite: 0xff8a2a };
// Short-lived mesh flying from->to (plus arc height); optional fading trail colour. Owns and frees its geometry and material.
function projectile(geo, color, from, to, dur, arc = 0, trail = null) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true }), o = new THREE.Mesh(geo, m); scene.add(o);
  const at = (k, v) => v.lerpVectors(from, to, k).setY(v.y + arc * Math.sin(Math.PI * k));
  let tg = null, tm = null, tl = null;
  if (trail !== null) { tg = new THREE.BufferGeometry(); tm = new THREE.LineBasicMaterial({ color: trail, transparent: true }); tl = new THREE.Line(tg, tm); scene.add(tl); }
  return tween(dur, (k) => {
    at(k, o.position); o.lookAt(at(Math.min(1, k + 0.02), new THREE.Vector3()));
    if (tl) { tg.setFromPoints([at(Math.max(0, k - 0.3), new THREE.Vector3()), o.position.clone()]); tm.opacity = 1 - 0.6 * k; }
  }).then(() => {
    scene.remove(o); geo.dispose(); m.dispose();
    if (tl) { scene.remove(tl); tg.dispose(); tm.dispose(); }
  });
}
// Expanding ring on the board where a hit lands.
function burst(pos, color = 0xffe08a, size = 2.6) {
  const geo = new THREE.RingGeometry(0.2, 0.35, 32).rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide });
  const r = new THREE.Mesh(geo, m); r.position.set(pos.x, 0.12, pos.z); scene.add(r);
  return tween(0.4, (k) => { r.scale.setScalar(0.3 + size * k); m.opacity = 1 - k; })
    .then(() => { scene.remove(r); geo.dispose(); m.dispose(); });
}
function tracer(from, to, color = 0xffe08a) {
  const g = new THREE.BufferGeometry().setFromPoints([from, to]);
  const m = new THREE.LineBasicMaterial({ color, transparent: true });
  const l = new THREE.Line(g, m); scene.add(l);
  return tween(0.3, (k) => { m.opacity = 1 - k; }).then(() => { scene.remove(l); g.dispose(); m.dispose(); });
}
function slashArc(center, dir, color = 0xe6eeff) {
  const geo = new THREE.RingGeometry(0.7, 1.05, 24, 1, -Math.PI / 2, Math.PI * 0.9);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide });
  const arc = new THREE.Mesh(geo, m);
  arc.position.copy(center); arc.position.y = 1.0;
  arc.lookAt(center.clone().add(dir).setY(1.0));
  scene.add(arc);
  let last = -0.8;
  return tween(0.3, (k) => { const a = -0.8 + 1.6 * k; arc.rotateZ(a - last); last = a; m.opacity = 1 - k; })
    .then(() => { scene.remove(arc); geo.dispose(); m.dispose(); });
}
async function strike(p, victimPos, onHit, style) {
  face(p, victimPos);
  const breath = style === 'breath' ? (p.actions.FireBreath ? 'FireBreath' : p.actions.PoisonBreath ? 'PoisonBreath' : null) : null;
  const base = p.root.position.clone();
  const fwd = victimPos.clone().sub(base).setY(0).normalize();
  if (breath) {
    const clip = p.actions[breath].getClip();
    const ts = Math.max(1, clip.duration / 1.3);
    play(p, breath, { once: true, timeScale: ts });
    const dur = clip.duration / ts;
    let breathHit = false, balls = 0;
    const head = base.clone().addScaledVector(fwd, 0.8).setY(base.y + 2.2);
    await tween(dur, (k) => {
      // Crystal Dragon has no flame node, so fake the fire with fireballs
      if (breath === 'FireBreath' && balls < 4 && k >= 0.25 + 0.04 * balls) { balls++; projectile(new THREE.SphereGeometry(0.12, 10, 8), 0xff7a2a, head, victimPos.clone().setY(1.1), 0.3, 0, 0xffaa55); }
      if (k >= 0.45 && !breathHit) { breathHit = true; onHit(); }
    });
    play(p, 'Idle');
    return;
  }
  const shoulder = base.clone().addScaledVector(fwd, 0.6).setY(1.1);   // where a shot leaves
  const aim = victimPos.clone().setY(1.1);
  let hit = false, fired = false;
  if (style === 'shot' || style === 'cannon') {
    const shot = style === 'shot';
    const dur = shot ? 0.5 : 0.6, fireAt = shot ? 0.3 : 0.2, hitAt = shot ? 0.4 : 0.45, kick = shot ? 0.12 : 0.3;
    await tween(dur, (k) => {
      const r = k < fireAt ? k / fireAt : Math.max(0, 1 - (k - fireAt) / (1 - fireAt));
      p.root.position.copy(base).addScaledVector(fwd, -kick * r);
      if (k >= fireAt && !fired) { fired = true; flash(shoulder.clone().setY(0.1), shot ? 0xffd27a : 0xff8a2a, shot ? 0.5 : 1.2); tracer(shoulder, aim); }
      if (k >= hitAt && !hit) { hit = true; onHit(); }
    });
  } else if (style === 'missile') {
    const hand = base.clone().setY(base.y + 1.4);
    await projectile(new THREE.SphereGeometry(0.18, 12, 8), 0x9a6bff, hand, aim, 0.45, 0.8, 0xc9a8ff);
    onHit();
  } else if (style === 'spear') {
    const hand = p.root.getObjectByName('attach-righthand-mesh');
    const start = base.clone().setY(base.y + 1.4), top = base.clone().setY(base.y + 6);
    const cone = () => new THREE.ConeGeometry(0.06, 0.7, 8).rotateX(Math.PI / 2);
    try {
      await tween(0.25, (k) => { p.swing = 0.5 * k; });
      if (hand) hand.visible = false;
      await projectile(cone(), 0xffd27a, start, top, 0.3, 0, 0xffe9a8);
      await projectile(cone(), 0xffd27a, top, aim, 0.25, 0, 0xffe9a8);
      onHit();
    } finally { if (hand) hand.visible = true; p.swing = 0; }
  } else if (style === 'strafe') {
    const shotAt = [0.2, 0.3, 0.4]; let n = 0;
    await tween(0.7, (k) => {
      const w = Math.sin(Math.PI * k);
      p.root.position.copy(base).addScaledVector(fwd, 0.9 * w); p.root.position.y = p.lift + 0.6 * w;
      if (n < shotAt.length && k >= shotAt[n]) { n++; tracer(p.root.position.clone().setY(p.lift + 0.4), aim, 0xffe9a8); }
      if (k >= 0.45 && !hit) { hit = true; onHit(); }
    });
  } else if (style === 'ram') {
    await tween(0.45, (k) => {
      const w = Math.sin(Math.PI * k);
      p.root.position.copy(base).addScaledVector(fwd, 0.9 * w);
      if (k >= 0.4 && !hit) { hit = true; onHit(); }
    });
  } else if (style === 'slash') {
    let arc = false;
    await tween(0.55, (k) => {
      const w = Math.sin(Math.PI * k);
      p.root.position.copy(base).addScaledVector(fwd, 0.5 * w);
      p.inner.rotation.x = -0.2 * w;
      p.swing = k;
      if (k >= 0.4 && !arc) { arc = true; slashArc(victimPos.clone().lerp(base, 0.5), fwd); }
      if (k >= 0.5 && !hit) { hit = true; onHit(); }
    });
  } else {
    await tween(0.5, (k) => {
      const w = Math.sin(Math.PI * k);
      p.root.position.copy(base).addScaledVector(fwd, 0.7 * w);
      p.inner.rotation.x = 0.4 * w;
      if (k >= 0.45 && !hit) { hit = true; onHit(); }
    });
  }
  p.inner.rotation.x = 0; p.swing = 0; p.root.position.copy(base);
}
async function die(v) {
  v.dead = true; play(v, 'Idle');
  const tip = v.humanoid ? 'x' : 'z', sign = v.humanoid ? -1 : (Math.random() < 0.5 ? 1 : -1);
  await tween(0.9, (k) => {
    v.root.rotation[tip] = sign * (Math.PI / 2) * k * k;
    v.root.position.y = v.lift * (1 - k);
    v.root.scale.setScalar(1 - Math.max(0, (k - 0.7) / 0.3));
  });
  removePiece(v);
}
async function attack(a, v) {
  const target = v.root.position.clone();
  const dir = target.clone().sub(a.root.position).setY(0).normalize();
  const stand = target.clone().addScaledVector(dir, -1.15);
  const d = Math.max(Math.abs(a.sq.charCodeAt(0) - v.sq.charCodeAt(0)), Math.abs(a.sq[1] - v.sq[1]));
  const style = styleOf(a, d), poison = !!a.actions.PoisonBreath, ranged = d > 1;
  // Bishops (missile, or the WW2 medic's shot) and the spear fire from their own square; the long-range queen flies in; everything else walks up.
  if (ranged && style === 'breath' && poison) await slide(a, stand, 0.9, 3);
  else if (!(ranged && (style === 'missile' || style === 'spear' || a.role === 'bishop'))) await slide(a, stand, 0.4);
  const hit = style === 'breath' ? (poison ? 0x6fdc4a : 0xff7a2a) : HIT[style];
  let victimDown;
  await strike(a, target, () => {
    flash(target, hit); burst(target, hit); shake(); victimDown = die(v);
  }, style);
  await victimDown;
}

async function animateMove(m) {
  const p = pieceAt.get(m.from);
  pieceAt.delete(m.from);
  let victim = null;
  if (m.flags.includes('e')) victim = pieceAt.get(m.to[0] + m.from[1]);
  else if (m.captured) victim = pieceAt.get(m.to);
  if (victim) { pieceAt.delete(victim.sq); await attack(p, victim); }
  const jobs = [slide(p, sqPos(m.to), 0.6, m.piece === 'n' ? 1.2 : 0)];
  if (m.flags.includes('k') || m.flags.includes('q')) {
    const r = m.color === 'w' ? '1' : '8', short = m.flags.includes('k');
    const rf = (short ? 'h' : 'a') + r, rt = (short ? 'f' : 'd') + r;
    const rook = pieceAt.get(rf); pieceAt.delete(rf);
    jobs.push(slide(rook, sqPos(rt), 0.6).then(() => { rook.sq = rt; pieceAt.set(rt, rook); restFacing(rook); }));
  }
  await Promise.all(jobs);
  p.sq = m.to; pieceAt.set(m.to, p); restFacing(p);
  if (m.promotion) {
    const sk = p.skinKey; removePiece(p);
    await createPiece(sk, 'queen', m.color, m.to);
  }
}


/* ---------- board themes (follow the skin) ---------- */
// props: [assetId, x, z, rotY, scale]   (board spans x,z 0..16; scenery stands outside it)
const THEMES = {
  classic: { name: 'Classic', light: 0xd6c6a2, dark: 0x6d5b46, frame: 0x3a2a1c, ground: 0x181b22, bg: 0x181b22, hemi: 1.7, fire: [], props: [] },
  dragons: { name: 'Dragons Lair', light: 0x9c8b7a, dark: 0x2c2427, frame: 0x120d0e, ground: 0x1c1113, bg: 0x0f0809, hemi: 1.15,
    fire: [[-2, 2, -2], [18, 2, -2], [-2, 2, 18], [18, 2, 18]],
    props: [
      ['dragonfire-brazier-6bc2ce', -2, -2, 0, 1.3], ['flame-brazier-bbf74a', 18, -2, 0, 1.6], ['dragonfire-brazier-6bc2ce', -2, 18, 0, 1.3], ['flame-brazier-bbf74a', 18, 18, 0, 1.6],
      ['giant-dragon-rib-0e42d9', 8, -7, 0, 1.0], ['coiled-dragon-pillar-7d526a', -5, 3, 0.4, 0.75], ['coiled-dragon-pillar-7d526a', 21, 3, -0.4, 0.75],
      ['lair-stalagmite-7d4d95', 3, -4, 0, 1.2], ['lair-crystal-column-877d1a', 12.5, -3.6, 0.5, 1.6], ['obsidian-fang-rock-67e326', 6, -3.6, 1, 1.0],
      ['ancient-dragon-skull-7be378', 19.5, 10.5, -1.3, 1.1], ['gold-hoard-mound-d0a2be', -5, 12, 0.6, 0.9], ['overflowing-treasure-chest-3d6ee0', -2.8, 8, 1.4, 0.9],
      ['ember-dragon-egg-0700c7', -2.4, 5, 0, 1.6], ['geode-dragon-egg-89141e', 18.4, 6, 0, 1.6], ['miasma-dragon-egg-4b66e0', 18.4, 14, 0, 1.4],
      ['skull-and-bone-scatter-3dea4c', -2.6, 14.5, 0.8, 1.2], ['bone-warning-totem-56cf4a', 17.8, 1, 0.3, 1.2], ['dragon-skeleton-88de43', 8, -13, 0, 1.2],
    ] },
  ww2: { name: 'World War II', light: 0xbab08a, dark: 0x5b6846, frame: 0x3a3426, ground: 0x4a4a3a, bg: 0x8da0b0, hemi: 1.9,
    fire: [],
    props: [
      ['sandbag-wall-section-7075ee', 2, -2, 0, 1], ['sandbag-wall-section-7075ee', 6, -2, 0, 1], ['sandbag-wall-section-7075ee', 10, -2, 0, 1], ['sandbag-wall-section-7075ee', 14, -2, 0, 1],
      ['sandbag-wall-section-7075ee', -2, 3, Math.PI / 2, 1], ['sandbag-wall-section-7075ee', -2, 7, Math.PI / 2, 1], ['sandbag-wall-section-7075ee', 18, 3, Math.PI / 2, 1], ['sandbag-wall-section-7075ee', 18, 7, Math.PI / 2, 1],
      ['czech-hedgehog-d77ae5', -2.4, -2.4, 0.3, 1], ['czech-hedgehog-d77ae5', 18.4, -2.4, 0.9, 1], ['czech-hedgehog-d77ae5', -2.4, 18.4, 0.5, 1], ['czech-hedgehog-d77ae5', 18.4, 18.4, 0.1, 1],
      ['barbed-wire-fence-section-a01906', -2.5, 12, Math.PI / 2, 1], ['barbed-wire-fence-section-a01906', 18.5, 12, Math.PI / 2, 1],
      ['anti-aircraft-searchlight-ba3f07', 20, 4.5, -0.6, 1.1], ['radar-aerial-mast-f88914', -5, -4, 0, 0.9], ['barrage-balloon-2edc43', 19, -8, 0, 0.8],
      ['shelled-townhouse-2483d1', 5, -8, 0, 0.9], ['nissen-hut-dafb56', 14, -7, 0, 1], ['sentry-box-fc915e', -4, 14, 0.6, 1], ['concrete-pillbox-ea855a', 20.5, 12, -0.5, 1],
      ['ammunition-crate-a5c550', -3.6, 9.5, 0.3, 1.2], ['ammunition-crate-a5c550', 19.6, 8, 1.1, 1.2], ['blackout-lamp-post-3af3ca', 18, 16.6, 0, 1.2], ['blackout-lamp-post-3af3ca', -2, 16.6, 0, 1.2],
      ['splintered-roadside-poplar-5859d8', -6, 8, 0, 1], ['field-hospital-marquee-8cf79b', -9, -2, 0.2, 0.9], ['field-grave-marker-15380b', 19.5, 15.4, 0.2, 1.3], ['minefield-warning-sign-296d9e', 17, -3.4, 0.2, 1.4],
    ] },
};
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshLambertMaterial({ color: 0x181b22 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(8, -0.63, 8); scene.add(ground);
const scenery = new THREE.Group(); scenery.position.y = -0.63; scene.add(scenery);
const fireLights = [];
let themeKey = null, themeSeq = 0;
async function applyTheme(key) {
  const th = THEMES[key]; if (!th || key === themeKey) return;
  themeKey = key; const seq = ++themeSeq;
  for (const [sq, m] of tiles) { const f = sq.charCodeAt(0) - 97, r = +sq[1]; m.material.color.setHex((f + r) % 2 ? th.light : th.dark); }
  frame.material.color.setHex(th.frame); ground.material.color.setHex(th.ground);
  scene.background.setHex(th.bg); hemi.intensity = th.hemi;
  scenery.clear(); for (const l of fireLights) scene.remove(l); fireLights.length = 0;
  for (const [x, y, z] of th.fire) { const l = new THREE.PointLight(0xff7a2a, 22, 13, 1.4); l.position.set(x, y, z); scene.add(l); fireLights.push(l); }
  const loaded = await Promise.all(th.props.map(async ([id, x, z, ry, sc]) => {
    const g = await loadModel(id); return { g, x, z, ry, sc };
  }));
  if (seq !== themeSeq) return;               // a newer theme was chosen while loading
  for (const { g, x, z, ry, sc } of loaded) {
    const o = g.scene.clone(true); o.position.set(x, 0, z); o.rotation.y = ry; o.scale.setScalar(sc); scenery.add(o);
  }
  updateCredits();
}
function boardThemeKey() { const v = document.getElementById('boardSel')?.value || 'auto'; return v === 'auto' ? S.skin.w : v; }
function refreshTheme() { return applyTheme(boardThemeKey()); }

/* ---------- game state ---------- */
const chess = new Chess();
const S = { skin: { w: 'dragons', b: 'ww2' }, human: 'w', vsAI: true, level: 'Casual', busy: false, selected: null, legal: [], ready: false, aiError: null, speed: 1 };

function setStatus(t) { statusEl.textContent = t; }
function statusText() {
  if (chess.isCheckmate()) return `Checkmate - ${chess.turn() === 'w' ? 'Black' : 'White'} wins`;
  if (chess.isStalemate()) return 'Draw - stalemate';
  if (chess.isDraw()) return 'Draw';
  const side = chess.turn() === 'w' ? 'White' : 'Black';
  return `${side} to move${chess.inCheck() ? ' - CHECK' : ''}` + (S.vsAI && chess.turn() !== S.human ? ' (AI thinking...)' : '');
}
async function rebuildPieces() {
  for (const p of [...pieces]) removePiece(p);
  pieceAt.clear();
  const jobs = [];
  for (const row of chess.board()) for (const c of row) {
    if (c) jobs.push(createPiece(S.skin[c.color], ROLE[c.type], c.color, c.square));
  }
  await Promise.all(jobs);
  updateCredits();
}
function creditLines() {
  const lines = new Set();
  for (const c of ['w', 'b']) for (const r of Object.values(SKINS[S.skin[c]].pieces)) lines.add(r.credit);
  for (const [id] of (THEMES[themeKey]?.props || [])) if (PROPS[id]) lines.add(PROPS[id].credit);
  return [...lines];
}
function updateCredits() {
  creditsEl.innerHTML = 'Models by Polyfork (CC BY 4.0) | Animations: Quaternius (CC0) | AI: Stockfish (GPLv3) | <a href="#" id=credLink style="color:#8cf">full credits</a>';
  document.getElementById('credLink').onclick = (e) => { e.preventDefault(); credBox.style.display = credBox.style.display === 'block' ? 'none' : 'block'; credBox.innerHTML = creditLines().join('<br>'); };
}

/* highlights */
function clearHL() { for (const t of tiles.values()) t.material.emissive.setHex(0); }
function showHL() {
  clearHL();
  if (!S.selected) return;
  tiles.get(S.selected).material.emissive.setHex(0x777700);
  for (const m of S.legal) tiles.get(m.to).material.emissive.setHex(m.captured || m.flags.includes('e') ? 0x882222 : 0x1f6a2a);
}

/* ---------- AI (Stockfish WASM) ---------- */
let sf = null, sfWaiter = null;
function initSF() {
  sf = new Worker('sf/stockfish-19-lite-single.js');
  sf.onerror = (e) => { S.aiError = String(e.message || e); };
  sf.onmessage = (e) => {
    const line = typeof e.data === 'string' ? e.data : '';
    if (sfWaiter && sfWaiter.re.test(line)) { const w = sfWaiter; sfWaiter = null; w.res(line); }
  };
  sf.postMessage('uci');
}
function sfWait(re) { return new Promise((res) => { sfWaiter = { re, res }; }); }
async function bestMove(fen) {
  if (!sf) { initSF(); await sfWait(/^uciok/); }
  const lv = LEVELS[S.level];
  sf.postMessage(`setoption name Skill Level value ${lv.skill}`);
  sf.postMessage('isready'); await sfWait(/^readyok/);
  sf.postMessage(`position fen ${fen}`);
  const p = sfWait(/^bestmove/);
  sf.postMessage(`go movetime ${lv.ms}`);
  const line = await Promise.race([p, sleep(lv.ms + 8000).then(() => { throw new Error('stockfish timeout'); })]);
  return line.split(' ')[1];
}
async function aiTurn() {
  if (!S.vsAI || chess.isGameOver() || chess.turn() === S.human) return;
  S.busy = true; setStatus(statusText());
  let uci;
  try { uci = await bestMove(chess.fen()); await sleep(250); }
  catch (e) {
    S.aiError = String(e.message || e);
    const ms = chess.moves({ verbose: true }); const m = ms[Math.floor(Math.random() * ms.length)];
    uci = m.from + m.to + (m.promotion || '');
  }
  S.busy = false; await exec(uci.slice(0, 2), uci.slice(2, 4));
}
async function exec(from, to) {
  const m = chess.move({ from, to, promotion: 'q' });
  S.busy = true; S.selected = null; S.legal = []; clearHL();
  try { await animateMove(m); }
  catch (e) { S.aiError = String(e.message || e); console.error(e); }
  finally { S.busy = false; setStatus(statusText()); }
  await aiTurn();
}

/* ---------- input ---------- */
const ray = new THREE.Raycaster();
function squareAt(ev) {
  ray.setFromCamera(new THREE.Vector2(ev.clientX / innerWidth * 2 - 1, -(ev.clientY / innerHeight) * 2 + 1), cam);
  const hit = ray.intersectObjects(scene.children, true)[0]; if (!hit) return null;
  for (let o = hit.object; o; o = o.parent) {
    if (o.userData.piece) return o.userData.piece.sq;
    if (o.userData.sq) return o.userData.sq;
  }
  return null;
}
renderer.domElement.addEventListener('click', (ev) => {
  if (S.busy || !S.ready || chess.isGameOver()) return;
  if (S.vsAI && chess.turn() !== S.human) return;
  const sq = squareAt(ev); if (!sq) return;
  const mv = S.legal.find((m) => m.to === sq);
  if (mv) { exec(S.selected, sq); return; }
  const pc = chess.get(sq);
  if (pc && pc.color === chess.turn()) { S.selected = sq; S.legal = chess.moves({ square: sq, verbose: true }); } else { S.selected = null; S.legal = []; }
  showHL();
});

/* ---------- UI ---------- */
document.head.insertAdjacentHTML('beforeend', '<style>body{margin:0;overflow:hidden;font:14px system-ui,sans-serif;color:#eee}#bar{position:fixed;top:0;left:0;right:0;padding:8px 10px;background:#0009;display:flex;gap:10px;flex-wrap:wrap;align-items:center}#bar label{display:flex;gap:4px;align-items:center}#status{margin-left:auto;font-weight:600}#credBox{display:none;position:fixed;bottom:26px;left:8px;max-width:70vw;max-height:55vh;overflow:auto;background:#000d;padding:8px 10px;font-size:11px;color:#ccc}#credits{position:fixed;bottom:0;left:0;right:0;padding:3px 8px;font-size:10px;background:#000a;color:#bbb}</style>');
const opts = (o) => Object.entries(o).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
const themeOpts = Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('');
const skinOpts = opts(Object.fromEntries(Object.entries(SKINS).map(([k, v]) => [k, v.name])));
document.body.insertAdjacentHTML('beforeend', `<div id=bar>
<label>White skin <select id=skW>${skinOpts}</select></label>
<label>Black skin <select id=skB>${skinOpts}</select></label>
<label>Board <select id=boardSel><option value=auto>Auto (White's skin)</option>${themeOpts}</select></label>
<label>Mode <select id=mode><option value=w>vs AI - you are White</option><option value=b>vs AI - you are Black</option><option value=2p>2 players</option></select></label>
<label>AI level <select id=lvl>${opts(Object.fromEntries(Object.keys(LEVELS).map((k) => [k, k])))}</select></label>
<button id=newg>New game</button><span id=status>Loading...</span></div><div id=credits></div><div id=credBox></div>`);
const credBox = document.getElementById('credBox');
const $ = (id) => document.getElementById(id);
const statusEl = $('status'), creditsEl = $('credits');
$('skW').value = S.skin.w; $('skB').value = S.skin.b; $('lvl').value = S.level;
async function whenIdle() { while (S.busy) await sleep(100); }
$('skW').onchange = async () => { await whenIdle(); S.skin.w = $('skW').value; S.busy = true; await rebuildPieces(); S.busy = false; refreshTheme(); };
$('skB').onchange = async () => { await whenIdle(); S.skin.b = $('skB').value; S.busy = true; await rebuildPieces(); S.busy = false; };
$('boardSel').onchange = () => refreshTheme();
$('lvl').onchange = () => { S.level = $('lvl').value; };
$('mode').onchange = () => { const v = $('mode').value; S.vsAI = v !== '2p'; if (S.vsAI) S.human = v; newGame(); };
$('newg').onclick = () => newGame();
async function newGame() {
  await whenIdle(); S.busy = true; chess.reset(); S.selected = null; S.legal = []; clearHL();
  await rebuildPieces(); S.busy = false; setStatus(statusText()); await aiTurn();
}

/* ---------- loop ---------- */
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1) * S.speed;
  stepTweens(dt);
  for (const p of pieces) {
    if (p.armAng) p.arm.rotateZ(-p.armAng);   // undo last frame's swing first; mixer skips unchanged tracks
    p.mixer?.update(dt);
    p.armAng = p.arm && p.swing > 0 ? -2.2 * Math.sin(Math.PI * p.swing) : 0;
    if (p.armAng) p.arm.rotateZ(p.armAng);
  }
  renderer.render(scene, cam);
});

/* test hooks */
window.game = {
  S, chess,
  info: () => ({ fen: chess.fen(), busy: S.busy, over: chess.isGameOver(), pieces: pieces.size, atKeys: pieceAt.size, aiError: S.aiError, status: statusEl.textContent, ready: S.ready }),
  play: (u) => exec(u.slice(0, 2), u.slice(2, 4)),
  load: async (fen) => { await whenIdle(); chess.load(fen); S.busy = true; await rebuildPieces(); S.busy = false; setStatus(statusText()); },
  pix: (sq) => { const v = sqPos(sq).project(cam); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; },
  at: (sq) => pieceAt.get(sq),
  mem: () => ({ ...renderer.info.memory, programs: renderer.info.programs?.length }),
  squares: () => [...pieceAt.entries()].map(([s, p]) => s + ':' + p.team + p.role[0]).sort().join(' '),
};

(async () => {
  S.busy = true;
  try { await Promise.all([rebuildPieces(), refreshTheme()]); S.ready = true; setStatus(statusText()); }
  catch (e) { setStatus('Load error: ' + e); S.aiError = String(e); }
  S.busy = false;
})();
