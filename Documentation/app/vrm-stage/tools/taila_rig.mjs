// Gives Taila a proper skirt skeleton and spring bone data (VRMC_springBone), editing only the node graph:
//   1. the 21 loose DEF-skirt leaf bones become 7 chains of 3 (top > middle > hem), world transforms kept, so skinning is unchanged
//   2. spring chains for the skirt and every DEF-hair chain, with thigh / hip / head colliders
// usage: node tools/taila_rig.mjs <in.vrm> <out.vrm>
import fs from 'node:fs';
import * as THREE from 'three';

const [, , inPath, outPath] = process.argv;
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
const pos = (i) => new THREE.Vector3().setFromMatrixPosition(world[i]);

// ---- 1. skirt chains ------------------------------------------------------------------------------------
const skirt = nodes.map((n, i) => (/^DEF-skirt/.test(n.name) ? i : -1)).filter((i) => i >= 0);
const ang = (i) => Math.atan2(pos(i).z, pos(i).x); // glTF is Y-up: the skirt ring lies in the XZ plane
// the 7 highest bones start the columns; every other bone joins the column whose top is nearest in azimuth (2 each)
const tops = [...skirt].sort((a, b) => pos(b).y - pos(a).y).slice(0, skirt.length / 3);
const dAng = (a, b) => { const d = Math.abs(ang(a) - ang(b)) % (2 * Math.PI); return Math.min(d, 2 * Math.PI - d); };
const cols = tops.map((t) => [t]);
const pairs = skirt.filter((i) => !tops.includes(i)).flatMap((b) => cols.map((c) => [b, c, dAng(b, c[0])])).sort((x, y) => x[2] - y[2]);
const taken = new Set();
for (const [b, c] of pairs) if (!taken.has(b) && c.length < 3) { c.push(b); taken.add(b); }
for (const c of cols) c.sort((a, b) => pos(b).y - pos(a).y);
console.log('skirt columns', cols.map((c) => c.length).join(','), 'of', skirt.length, 'bones');
if (cols.some((c) => c.length !== 3)) throw new Error('expected 3 bones per skirt column');
const link = cols.flatMap((c) => [pos(c[0]).distanceTo(pos(c[1])), pos(c[1]).distanceTo(pos(c[2]))]);
console.log('longest chain link', Math.max(...link).toFixed(3), 'm');
cols.forEach((c) => console.log('  ', c.map((n) => nodes[n].name).join(' > ')));
if (Math.max(...link) > 0.2) throw new Error('a skirt chain jumps between columns');
const move = (child, np) => {
  nodes[parent[child]].children = nodes[parent[child]].children.filter((c) => c !== child);
  (nodes[np].children ??= []).push(child);
  parent[child] = np;
};
for (const c of cols) { move(c[1], c[0]); move(c[2], c[1]); }
nodes.forEach((n, i) => {
  const pm = parent[i] === undefined ? new THREE.Matrix4() : world[parent[i]];
  const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  pm.clone().invert().multiply(world[i]).decompose(t, q, s);
  delete n.matrix; n.translation = t.toArray(); n.rotation = q.toArray(); n.scale = s.toArray();
});

// ---- 2. spring bones ---------------------------------------------------------------------------------------
const relPos = (fromNode, toNode) => pos(toNode).applyMatrix4(world[fromNode].clone().invert()).toArray();
const colliders = [];
const addCol = (node, shape) => { colliders.push({ node, shape }); return colliders.length - 1; };
const legs = ['L', 'R'].map((s) => addCol(id(`DEF-thigh.${s}`), { capsule: { offset: [0, 0, 0], radius: 0.085, tail: relPos(id(`DEF-thigh.${s}`), id(`DEF-shin.${s}`)) } }));
const hips = addCol(id('DEF-spine'), { sphere: { offset: [0, 0.02, 0], radius: 0.11 } });
const head = addCol(id('DEF-spine.006'), { sphere: { offset: [0, 0.07, 0], radius: 0.1 } });
const chest = addCol(id('DEF-spine.003'), { capsule: { offset: [-0.06, 0, 0], radius: 0.09, tail: [0.06, 0, 0] } });
const colliderGroups = [{ name: 'legs', colliders: [...legs, hips] }, { name: 'head', colliders: [head, chest] }];

const joint = (node, stiffness, drag, grav, hit) => ({ node, hitRadius: hit, stiffness, gravityPower: grav, gravityDir: [0, -1, 0], dragForce: drag });
// A chain's last joint is only the end marker the one before it points at, so every chain gets a small tail node:
// without it the hem or hair tip would not move on its own.
const addTail = (end) => {
  const t = nodes[end].translation, len = Math.hypot(...t);
  const [x, y, z] = len > 0.01 ? t.map((c) => (c / len) * Math.min(len, 0.08)) : [0, -0.05, 0];
  nodes.push({ name: `${nodes[end].name}.tail`, translation: [x, y, z] });
  (nodes[end].children ??= []).push(nodes.length - 1);
  return nodes.length - 1;
};
const springs = [];
cols.forEach((c, k) => { const chain = [...c, addTail(c[2])]; springs.push({ name: `skirt${k}`, joints: chain.map((n, j) => joint(n, [0.75, 0.55, 0.4, 0.3][j], 0.35, 0, 0.025)), colliderGroups: [0] }); });
// hair: every DEF-hair* bone directly under the head starts a chain along its first child
const headNode = id('DEF-spine.006');
for (const r of nodes[headNode].children.filter((c) => /^DEF-hair/.test(nodes[c].name))) {
  const chain = [r];
  while (nodes[chain[chain.length - 1]].children?.length) chain.push(nodes[chain[chain.length - 1]].children[0]);
  chain.push(addTail(chain[chain.length - 1]));
  springs.push({ name: nodes[r].name, joints: chain.map((n, j) => joint(n, 0.9 - j * 0.05, 0.6, 0.05, 0.02)), colliderGroups: [1] });
}
json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'VRMC_springBone'])];
json.extensions = { ...json.extensions, VRMC_springBone: { specVersion: '1.0', colliders, colliderGroups, springs } };
console.log('springs', springs.length, 'colliders', colliders.length);

// ---- write GLB ---------------------------------------------------------------------------------------------------
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
