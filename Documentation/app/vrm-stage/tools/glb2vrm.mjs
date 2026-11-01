// Converts the Rigify-style "taila" GLB (flat DEF- bone hierarchy, A-pose, no VRM data) into a VRM 1.0 file:
//   1. re-parents the flat deform bones into a humanoid hierarchy (world transforms preserved)
//   2. raises both arms to a T-pose (VRM animations and our procedural poses assume T-pose rest)
//   3. adds the VRMC_vrm extension (humanoid map, eye look-at, meta)
// usage: node tools/glb2vrm.mjs <in.glb> <out.vrm>
import fs from 'node:fs';
import * as THREE from 'three';

const [, , inPath, outPath] = process.argv;
const buf = fs.readFileSync(inPath);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binStart = 20 + jsonLen;
const bin = buf.subarray(binStart + 8); // BIN chunk payload

const nodes = json.nodes;
const byName = Object.fromEntries(nodes.map((n, i) => [n.name, i]));
const id = (name) => { if (byName[name] === undefined) throw new Error(`missing bone ${name}`); return byName[name]; };
const parent = {};
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));

const local = (n) => {
  const m = new THREE.Matrix4();
  if (n.matrix) return m.fromArray(n.matrix);
  return m.compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
};
const world = {};
const getWorld = (i) => (world[i] ??= parent[i] === undefined ? local(nodes[i]) : getWorld(parent[i]).clone().multiply(local(nodes[i])));
nodes.forEach((_, i) => getWorld(i));

// ---- 1. new parents ------------------------------------------------------------------
const head = id('DEF-spine.006');
const spine = id('DEF-spine');
const newParent = new Map();
for (const side of ['L', 'R']) {
  newParent.set(id(`DEF-pelvis.${side}`), spine);
  newParent.set(id(`DEF-thigh.${side}`), spine);
  newParent.set(id(`DEF-shoulder.${side}`), id('DEF-spine.003'));
  newParent.set(id(`DEF-upper_arm.${side}`), id(`DEF-shoulder.${side}`));
}
const rootParent = parent[spine];
nodes.forEach((n, i) => {
  if (/^DEF-(skirt)/.test(n.name) && parent[i] === rootParent) newParent.set(i, spine);
  if (/^DEF-(eye|mouth|nose|cheek|hair|face-shape)/.test(n.name) && parent[i] === rootParent) newParent.set(i, head);
});
// a few bones may sit under a bone we are about to move; only re-parent roots of such groups (done above)
for (const [child, np] of newParent) {
  const op = parent[child];
  nodes[op].children = nodes[op].children.filter((c) => c !== child);
  (nodes[np].children ??= []).push(child);
  parent[child] = np;
}

// ---- 2. T-pose: rotate each arm subtree about its shoulder joint ----------------------------------
const subtree = (i) => [i, ...(nodes[i].children ?? []).flatMap(subtree)];
for (const [side, sign] of [['L', 1], ['R', -1]]) {
  const arm = id(`DEF-upper_arm.${side}`), hand = id(`DEF-hand.${side}`);
  const p = new THREE.Vector3().setFromMatrixPosition(world[arm]);
  const h = new THREE.Vector3().setFromMatrixPosition(world[hand]);
  const angle = Math.atan2(-(h.y - p.y), Math.abs(h.x - p.x)); // how far the arm hangs below horizontal
  const rot = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)
    .multiply(new THREE.Matrix4().makeRotationZ(sign * angle))
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  console.log(side, 'arm drop', ((angle * 180) / Math.PI).toFixed(1), 'deg');
  for (const i of subtree(arm)) world[i] = rot.clone().multiply(world[i]);
}

// ---- rewrite local transforms from (possibly changed) world transforms ---------------------------
nodes.forEach((n, i) => {
  const pm = parent[i] === undefined ? new THREE.Matrix4() : world[parent[i]];
  const l = pm.clone().invert().multiply(world[i]);
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  l.decompose(t, q, s);
  delete n.matrix;
  n.translation = t.toArray();
  n.rotation = q.toArray();
  n.scale = s.toArray();
});
delete json.animations; // the original animation targets the old rest pose

// ---- 3. VRMC_vrm ---------------------------------------------------------------------------------------
const hb = {
  hips: 'DEF-spine', spine: 'DEF-spine.001', chest: 'DEF-spine.002', upperChest: 'DEF-spine.003', neck: 'DEF-spine.004', head: 'DEF-spine.006',
  leftEye: 'DEF-eye.L', rightEye: 'DEF-eye.R',
};
for (const [S, s] of [['left', 'L'], ['right', 'R']]) {
  Object.assign(hb, {
    [`${S}UpperLeg`]: `DEF-thigh.${s}`, [`${S}LowerLeg`]: `DEF-shin.${s}`, [`${S}Foot`]: `DEF-foot.${s}`, [`${S}Toes`]: `DEF-toe.${s}`,
    [`${S}Shoulder`]: `DEF-shoulder.${s}`, [`${S}UpperArm`]: `DEF-upper_arm.${s}`, [`${S}LowerArm`]: `DEF-forearm.${s}`, [`${S}Hand`]: `DEF-hand.${s}`,
    [`${S}ThumbMetacarpal`]: `DEF-thumb.01.${s}`, [`${S}ThumbProximal`]: `DEF-thumb.02.${s}`, [`${S}ThumbDistal`]: `DEF-thumb.03.${s}`,
  });
  for (const [F, f] of [['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Little', 'pinky']]) {
    hb[`${S}${F}Proximal`] = `DEF-f_${f}.01.${s}`;
    hb[`${S}${F}Intermediate`] = `DEF-f_${f}.02.${s}`;
    hb[`${S}${F}Distal`] = `DEF-f_${f}.03.${s}`;
  }
}
const humanBones = Object.fromEntries(Object.entries(hb).map(([k, v]) => [k, { node: id(v) }]));
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'VRMC_vrm'])];
json.extensions = {
  ...(json.extensions ?? {}),
  VRMC_vrm: {
    specVersion: '1.0',
    meta: { name: 'Taila', version: '1', authors: ['unknown (user supplied)'], licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'onlyAuthor', commercialUsage: 'personalNonProfit', allowExcessivelyViolentUsage: false, allowExcessivelySexualUsage: false, allowRedistribution: false, modification: 'prohibited' },
    humanoid: { humanBones },
    lookAt: { type: 'bone', offsetFromHeadBone: [0, 0.08, 0], rangeMapHorizontalInner: { inputMaxValue: 40, outputScale: 12 }, rangeMapHorizontalOuter: { inputMaxValue: 40, outputScale: 12 }, rangeMapVerticalDown: { inputMaxValue: 30, outputScale: 8 }, rangeMapVerticalUp: { inputMaxValue: 30, outputScale: 8 } },
  },
};

// ---- write GLB ------------------------------------------------------------------------------------------------
const jb = Buffer.from(JSON.stringify(json), 'utf8');
const jpad = Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20);
const jchunk = Buffer.concat([jb, jpad]);
const bpad = Buffer.alloc((4 - (bin.length % 4)) % 4, 0);
const bchunk = Buffer.concat([bin, bpad]);
const total = 12 + 8 + jchunk.length + 8 + bchunk.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
out.writeUInt32LE(jchunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jchunk.copy(out, 20);
let o = 20 + jchunk.length;
out.writeUInt32LE(bchunk.length, o); out.writeUInt32LE(0x004e4942, o + 4); bchunk.copy(out, o + 8);
fs.writeFileSync(outPath, out);
console.log('wrote', outPath, total, 'bytes');
