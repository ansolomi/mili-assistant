// Turns a GLB exported from a Koikatsu (KKBP) Rigify-style rig into a VRM 1.0 file:
//   1. hangs the loose deform bones (the exporter drops non-deform parents) back under the humanoid skeleton
//   2. adds VRMC_vrm: humanoid map, expressions from KK morph targets, eye look-at, meta
//   3. fixes material alpha modes
// The rig is already in a T-pose, so no pose change. usage: node tools/kk2vrm.mjs <in.glb> <out.vrm> <name>
import fs from 'node:fs';
import * as THREE from 'three';

const [, , inPath, outPath, modelName = 'Model'] = process.argv;
const buf = fs.readFileSync(inPath);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const bin = buf.subarray(20 + jsonLen + 8);
const nodes = json.nodes;
const id = (name) => { const i = nodes.findIndex((n) => n.name === name); if (i < 0) throw new Error(`missing node ${name}`); return i; };
const parent = {};
nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));

const local = (n) => new THREE.Matrix4().compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
const world = {};
const getWorld = (i) => (world[i] ??= parent[i] === undefined ? local(nodes[i]) : getWorld(parent[i]).clone().multiply(local(nodes[i])));
nodes.forEach((_, i) => getWorld(i));

// ---- 1. re-parent loose bones (world transforms kept, so skinning is unchanged) ----------------
const root = id('RIG-Armature');
const hips = id('DEF-Hips'), upperChest = id('DEF-Upper Chest'), head = id('DEF-Head');
const move = (child, np) => {
  nodes[parent[child]].children = nodes[parent[child]].children.filter((c) => c !== child);
  (nodes[np].children ??= []).push(child);
  parent[child] = np;
};
const moves = [];
for (const c of [...nodes[root].children]) {
  const n = nodes[c];
  if (n.mesh !== undefined || n.skin !== undefined || c === hips) continue;
  if (/^DEF-(Left|Right) arm$/.test(n.name)) moves.push([c, upperChest]);
  else if (/hair|ribbon|halo|acc|Face|Eye|Tongue|Mouth|Mayu|Cheek|Nose|Chin/i.test(n.name)) moves.push([c, head]);
  else moves.push([c, hips]);
}
moves.forEach(([c, np]) => move(c, np));
nodes.forEach((n, i) => {
  const pm = parent[i] === undefined ? new THREE.Matrix4() : world[parent[i]];
  const l = pm.clone().invert().multiply(world[i]);
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  l.decompose(t, q, s);
  delete n.matrix;
  n.translation = t.toArray(); n.rotation = q.toArray(); n.scale = s.toArray();
});
console.log('re-parented', moves.length, 'bones');

// ---- 2. VRMC_vrm -------------------------------------------------------------------------------------
const hb = { hips: 'DEF-Hips', spine: 'DEF-Spine', chest: 'DEF-Chest', upperChest: 'DEF-Upper Chest', neck: 'DEF-Neck', head: 'DEF-Head', leftEye: 'Left Eye', rightEye: 'Right Eye' };
for (const [S, N] of [['left', 'Left'], ['right', 'Right']]) {
  const s = S === 'left' ? 'L' : 'R';
  Object.assign(hb, {
    [`${S}UpperLeg`]: `DEF-${N} leg`, [`${S}LowerLeg`]: `DEF-${N} knee`, [`${S}Foot`]: `DEF-${N} ankle`, [`${S}Toes`]: `DEF-${N} toe`,
    [`${S}UpperArm`]: `DEF-${N} arm`, [`${S}LowerArm`]: `DEF-${N} elbow`, [`${S}Hand`]: `DEF-${N} wrist`,
    [`${S}ThumbMetacarpal`]: `DEF-Thumb0_${s}`, [`${S}ThumbProximal`]: `DEF-Thumb1_${s}`, [`${S}ThumbDistal`]: `DEF-Thumb2_${s}`,
  });
  for (const F of ['Index', 'Middle', 'Ring', 'Little']) {
    hb[`${S}${F}Proximal`] = `DEF-${F}Finger1_${s}`; hb[`${S}${F}Intermediate`] = `DEF-${F}Finger2_${s}`; hb[`${S}${F}Distal`] = `DEF-${F}Finger3_${s}`;
  }
}
const humanBones = Object.fromEntries(Object.entries(hb).map(([k, v]) => [k, { node: id(v) }]));

// expressions: weights of KK morph targets on the face mesh (mesh 0); each name must exist on the mesh
const face = nodes.findIndex((n) => n.mesh === 0);
const names = json.meshes[0].extras.targetNames;
const bind = (list) => ({ morphTargetBinds: list.map(([n, w = 1]) => { const index = names.indexOf(`KK ${n}`); if (index < 0) throw new Error(`no morph ${n}`); return { node: face, index, weight: w }; }) });
const preset = {
  blink: bind([['Eyes_default_cl']]),
  blinkLeft: bind([['Eyes_wink_left_op']]), blinkRight: bind([['Eyes_wink_right_op']]),
  aa: bind([['Mouth_a_big_op']]), ih: bind([['Mouth_i_big_op']]), ou: bind([['Mouth_u_big_op']]), ee: bind([['Mouth_e_big_op']]), oh: bind([['Mouth_o_big_op']]),
  happy: bind([['Eyes_smile_op'], ['Mouth_smile_op']]),
  angry: bind([['Eyes_angry_op'], ['Eyebrows_angry_op'], ['Mouth_angry_op']]),
  sad: bind([['Eyes_sad_op'], ['Eyebrows_worried_op'], ['Mouth_lonely_op']]),
  surprised: bind([['Eyebrows_shocked_op'], ['Mouth_shocked_op']]),
  relaxed: bind([['Mouth_happy_moderate_op', 0.6]]),
};
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'VRMC_vrm'])];
json.extensions = {
  ...(json.extensions ?? {}),
  VRMC_vrm: {
    specVersion: '1.0',
    meta: { name: modelName, version: '1', authors: ['unknown (user supplied)'], licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'onlyAuthor', commercialUsage: 'personalNonProfit', allowExcessivelyViolentUsage: false, allowExcessivelySexualUsage: false, allowRedistribution: false, modification: 'prohibited' },
    humanoid: { humanBones },
    expressions: { preset },
    lookAt: { type: 'bone', offsetFromHeadBone: [0, 0.08, 0], rangeMapHorizontalInner: { inputMaxValue: 40, outputScale: 12 }, rangeMapHorizontalOuter: { inputMaxValue: 40, outputScale: 12 }, rangeMapVerticalDown: { inputMaxValue: 30, outputScale: 8 }, rangeMapVerticalUp: { inputMaxValue: 30, outputScale: 8 } },
  },
};

// ---- 3. materials: cut-out alpha instead of sorted blending (hair, lashes and clothes overlap) ------
for (const m of json.materials) {
  if (/ (Face|Body)$/.test(m.name)) m.alphaMode = 'OPAQUE';
  else { m.alphaMode = 'MASK'; m.alphaCutoff = 0.5; }
  if (/hair|ribbon|plana_body|panst|shorts|shoes/i.test(m.name)) m.doubleSided = true;
}

// ---- write GLB -------------------------------------------------------------------------------------------------
const jb = Buffer.from(JSON.stringify(json), 'utf8');
const jchunk = Buffer.concat([jb, Buffer.alloc((4 - (jb.length % 4)) % 4, 0x20)]);
const bchunk = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)]);
const total = 12 + 8 + jchunk.length + 8 + bchunk.length;
const out = Buffer.alloc(total);
out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(total, 8);
out.writeUInt32LE(jchunk.length, 12); out.writeUInt32LE(0x4e4f534a, 16); jchunk.copy(out, 20);
let o = 20 + jchunk.length;
out.writeUInt32LE(bchunk.length, o); out.writeUInt32LE(0x004e4942, o + 4); bchunk.copy(out, o + 8);
fs.writeFileSync(outPath, out);
console.log('wrote', outPath, total, 'bytes');
