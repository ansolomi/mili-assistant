// Adds bones to Taila's clothes so they can swing (run after taila_rig.mjs, which creates the spring data it extends):
//   - one sleeve bone per arm (pivot at the elbow, tail past the cuff) that the sleeve's far end is weighted to
//   - four hem bones (front, back, left, right) under the capelet
// Skinning is edited in the file itself: new joints, new inverse bind matrices, and up to a fraction of each affected vertex's weight moved to them.
// usage: node tools/taila_cloth.mjs <in.vrm> <out.vrm>
import fs from 'node:fs';
import * as THREE from 'three';

const [, , inPath, outPath] = process.argv;
const buf = fs.readFileSync(inPath);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
let bin = Buffer.from(buf.subarray(20 + jsonLen + 8));
const nodes = json.nodes, skin = json.skins[0];
const id = (name) => { const i = nodes.findIndex((n) => n.name === name); if (i < 0) throw new Error(`missing node ${name}`); return i; };
const where = (accIdx) => { const a = json.accessors[accIdx], v = json.bufferViews[a.bufferView]; return { a, off: (v.byteOffset ?? 0) + (a.byteOffset ?? 0) }; };

// bind-space world matrix of every joint = inverse of its inverse bind matrix
const ibm = where(skin.inverseBindMatrices);
const ibmOf = (k) => new THREE.Matrix4().fromArray(Array.from({ length: 16 }, (_, i) => bin.readFloatLE(ibm.off + k * 64 + i * 4)));
const jointIndex = (name) => skin.joints.indexOf(id(name));
const bindPos = (name) => new THREE.Vector3().setFromMatrixPosition(ibmOf(jointIndex(name)).clone().invert());
const bindWorld = (name) => ibmOf(jointIndex(name)).clone().invert();

// ---- new bones -------------------------------------------------------------------------------------------------
const newIbm = []; // matrices appended to the skin
const newBones = []; // { index (in skin.joints), head, tail, weightOf(v) }
const addBone = (name, parentName, head, tail, weightOf, extra = {}) => {
  const L = bindWorld(parentName).invert().multiply(new THREE.Matrix4().makeTranslation(head.x, head.y, head.z));
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  L.decompose(t, q, s);
  nodes.push({ name, translation: t.toArray(), rotation: q.toArray(), scale: s.toArray() });
  const node = nodes.length - 1;
  (nodes[id(parentName)].children ??= []).push(node);
  const d = tail.clone().sub(head); // the bind frame of the new bone has identity rotation, so the tail offset is in bind-space axes
  nodes.push({ name: `${name}.tail`, translation: d.toArray() });
  (nodes[node].children ??= []).push(nodes.length - 1);
  skin.joints.push(node);
  newIbm.push(new THREE.Matrix4().makeTranslation(-head.x, -head.y, -head.z));
  const b = { index: skin.joints.length - 1, node, tailNode: nodes.length - 1, head, tail, weightOf, ...extra };
  newBones.push(b);
  return b;
};
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

const sleeves = [];
for (const s of ['L', 'R']) {
  const elbow = bindPos(`DEF-forearm.${s}`), hand = bindPos(`DEF-hand.${s}`);
  const axis = hand.clone().sub(elbow), len = axis.length(), dir = axis.clone().normalize();
  const tail = hand.clone().addScaledVector(dir, 0.05);
  const weightOf = (v) => { // far end of the sleeve, near the forearm axis, ramps up toward the cuff
    const r = v.clone().sub(elbow), t = r.dot(dir) / len;
    if (r.addScaledVector(dir, -r.dot(dir)).length() > 0.13) return 0;
    return 0.9 * smooth(0.35, 1.05, t);
  };
  sleeves.push(addBone(`cloth-sleeve.${s}`, `DEF-forearm.${s}`, elbow, tail, weightOf, { name: `sleeve${s}` }));
}

// capelet hem: vertices weighted to the torso or shoulders below shoulder height
const chestBone = 'DEF-spine.003';
const hemTop = bindPos(chestBone).y + 0.02, hemBottom = 1.09;
const capeCenter = new THREE.Vector3(); // filled from the vertices below
const capeVerts = [];
const dirs = { front: [0, 1], back: [0, -1], left: [1, 0], right: [-1, 0] }; // [x, z]
const names = skin.joints.map((n) => nodes[n].name);
const isTorso = (n) => /spine|shoulder/.test(n);
const meshNode = (n) => nodes.find((x) => x.name === n);
const forEachVertex = (meshName, fn) => {
  for (const p of json.meshes[meshNode(meshName).mesh].primitives) {
    const P = where(p.attributes.POSITION), J = where(p.attributes.JOINTS_0), W = where(p.attributes.WEIGHTS_0);
    for (let v = 0; v < P.a.count; v++) fn({ P, J, W, v, pos: new THREE.Vector3(bin.readFloatLE(P.off + v * 12), bin.readFloatLE(P.off + v * 12 + 4), bin.readFloatLE(P.off + v * 12 + 8)) });
  }
};
const dominant = (J, W, v) => { let best = 0, bw = -1; for (let c = 0; c < 4; c++) { const w = bin.readFloatLE(W.off + v * 16 + c * 4); if (w > bw) { bw = w; best = bin[J.off + v * 4 + c]; } } return names[best] ?? ''; };
forEachVertex('ClothA', ({ J, W, v, pos }) => { if (isTorso(dominant(J, W, v)) && pos.y > hemTop - 0.05) capeCenter.add(pos), capeVerts.push(pos); });
capeCenter.divideScalar(capeVerts.length);
const hems = Object.entries(dirs).map(([k, [dx, dz]]) => {
  const head = new THREE.Vector3(capeCenter.x, hemTop, capeCenter.z);
  const tail = new THREE.Vector3(capeCenter.x + dx * 0.14, hemBottom - 0.02, capeCenter.z + dz * 0.14);
  return addBone(`cloth-hem.${k}`, chestBone, head, tail, null, { name: `hem${k}`, dir: new THREE.Vector2(dx, dz), cape: true });
});
const hemWeights = (pos) => { // [share per hem bone]; zero above the hem line
  const down = smooth(hemTop, hemBottom, pos.y) * 0.85;
  const r = new THREE.Vector2(pos.x - capeCenter.x, pos.z - capeCenter.z);
  if (down <= 0 || r.length() < 1e-4) return hems.map(() => 0);
  const shares = hems.map((h) => Math.max(0, r.clone().normalize().dot(h.dir)) ** 2), sum = shares.reduce((a, b) => a + b, 0) || 1;
  return shares.map((s) => (down * s) / sum);
};

// ---- re-weight ---------------------------------------------------------------------------------------------------------
let touched = 0;
const give = (J, W, v, bone, f) => { // move fraction f of the vertex's weight to `bone`, taking it over the weakest slot
  if (f < 0.01) return;
  const w = [0, 1, 2, 3].map((c) => bin.readFloatLE(W.off + v * 16 + c * 4)).map((x) => x * (1 - f));
  const slot = w.indexOf(Math.min(...w));
  w[slot] += f;
  bin[J.off + v * 4 + slot] = bone.index;
  w.forEach((x, c) => bin.writeFloatLE(x, W.off + v * 16 + c * 4));
  touched++;
};
for (const meshName of ['ClothA', 'ClothA.001', 'ClothA.002']) {
  forEachVertex(meshName, ({ J, W, v, pos }) => {
    if (meshName === 'ClothA') hems.forEach((h, k) => give(J, W, v, h, isTorso(dominant(J, W, v)) ? hemWeights(pos)[k] : 0));
    if (meshName !== 'ClothA.002') sleeves.forEach((s) => give(J, W, v, s, s.weightOf(pos)));
  });
}
console.log('weights moved on', touched, 'vertex entries;', newBones.length, 'new bones');
if (skin.joints.length > 255) throw new Error('joint index no longer fits in 8 bits');

// ---- skin data and spring chains ---------------------------------------------------------------------------------------
const oldIbmBytes = bin.subarray(ibm.off, ibm.off + 64 * ibm.a.count);
const extra = Buffer.alloc(64 * newIbm.length);
newIbm.forEach((m, k) => m.elements.forEach((e, i) => extra.writeFloatLE(e, k * 64 + i * 4)));
const all = Buffer.concat([oldIbmBytes, extra]);
const pad = (4 - (bin.length % 4)) % 4;
const start = bin.length + pad;
bin = Buffer.concat([bin, Buffer.alloc(pad), all]);
json.bufferViews.push({ buffer: 0, byteOffset: start, byteLength: all.length });
json.accessors.push({ bufferView: json.bufferViews.length - 1, componentType: 5126, count: ibm.a.count + newIbm.length, type: 'MAT4' });
skin.inverseBindMatrices = json.accessors.length - 1;
json.buffers[0].byteLength = bin.length;

const sp = json.extensions.VRMC_springBone;
const joint = (node, stiffness, drag, grav) => ({ node, hitRadius: 0.03, stiffness, gravityPower: grav, gravityDir: [0, -1, 0], dragForce: drag });
for (const b of newBones) {
  sp.springs.push({ name: b.name, joints: [joint(b.node, b.cape ? 0.7 : 0.6, b.cape ? 0.45 : 0.4, b.cape ? 0.05 : 0.1), joint(b.tailNode, 0.5, 0.4, 0)], colliderGroups: b.cape ? [1] : [] });
}

// ---- write GLB ---------------------------------------------------------------------------------------------------------
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
