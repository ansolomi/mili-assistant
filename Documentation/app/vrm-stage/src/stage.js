import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMSpringBoneManager, VRMSpringBoneJoint, VRMSpringBoneCollider, VRMSpringBoneColliderShapeCapsule } from '@pixiv/three-vrm';
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from '@pixiv/three-vrm-animation';

// Emotion tag -> VRM expression weights. Indices match emotionMap of "vrm_stage" in Open-LLM-VTuber/model_dict.json.
export const EMOTIONS = {
  neutral: {},
  joy: { happy: 0.85 },
  anger: { angry: 0.7 },
  sadness: { sad: 0.75 },
  surprise: { surprised: 0.9 },
  fear: { surprised: 0.35, sad: 0.55 },
  disgust: { angry: 0.35, sad: 0.25 },
  smirk: { relaxed: 0.55, happy: 0.25 },
};
export const EMOTION_BY_INDEX = ['neutral', 'joy', 'anger', 'sadness', 'surprise', 'fear', 'disgust', 'smirk'];

// Arm poses as [x, y, z] euler radians on normalised bones; missing entries fall back to BASE_POSE.
export const BASE_POSE = {
  leftUpperArm: [0.05, 0, -1.22], rightUpperArm: [0.05, 0, 1.22],
  leftLowerArm: [0, -0.12, 0], rightLowerArm: [0, 0.12, 0],
  leftShoulder: [0, 0, -0.04], rightShoulder: [0, 0, 0.04],
};
export const POSES = {
  relaxed: {},
  handsBack: { leftUpperArm: [0.55, 0, -1.15], rightUpperArm: [0.55, 0, 1.15], leftLowerArm: [0, -0.9, 0], rightLowerArm: [0, 0.9, 0] },
  handsFront: { leftUpperArm: [-0.25, 0, -1.0], rightUpperArm: [-0.25, 0, 1.0], leftLowerArm: [0, 1.0, 0], rightLowerArm: [0, -1.0, 0] },
  shrug: { leftShoulder: [0, 0, 0.2], rightShoulder: [0, 0, -0.2] },
  wave: { rightUpperArm: [0, 0, -0.1], rightLowerArm: [0, 0, -1.35] }, // upper arm out, forearm up; the hand swings about the elbow
};
const IDLE_POSES = ['relaxed', 'handsBack', 'handsFront', 'relaxed', 'shrug'];

const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qd = new THREE.Quaternion(), _qe = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _v = new THREE.Vector3();
const clamp01 = (v) => Math.min(1, Math.max(0, v));

export class Stage {
  constructor({ width = 1080, height = 1920, transparent = false } = {}) {
    this.W = width;
    this.H = height;
    this.t = 0;
    this.speech = 0; // smoothed speaking energy
    this.emotion = 'neutral';
    this.emo = {}; // current expression weights
    this.mouth = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    this.subtitle = '';
    this.subtitleName = '';
    this.blink = { next: 2, t: -1 };
    this.pose = 'relaxed';
    this.poseT = 3;
    this.cur = {};
    this.pointer = { x: 0, y: 0 };
    this.look = { x: 0, y: 0 }; // smoothed pointer
    this.settings = {
      cameraCoverage: 1.2, cameraCenterOffset: -0.32, fov: 28,
      hairColor: '#b8bcc6', hairTint: true,
      outfitTint: true, topColor: '#15171f', bottomColor: '#2b2f3b', hairpin: true,
      skirt: true, skirtColor: '#1c1f2a', beltColor: '#6c7b96', skinColor: '#f6dccf', braid: true,
      skirtY: 0.1, skirtLen: 0.3, skirtTop: 0.115, skirtBottom: 0.235,
      ears: true, earColor: '#d6d9e2', earInner: '#f5a9ba',
      earX: 0.085, earY: 0.2, earZ: 0.0, earTilt: 0.42, earSize: 1,
      subtitles: true, subtitleSize: 46,
      background: 'default', exposure: 1,
    };

    this.transparent = transparent;
    this.walkDir = 0; // -1 left, 0 stand, 1 right (set by the desktop overlay)
    this.walkAmt = 0;
    this.walkPhase = 0;
    this.facing = 0;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: transparent });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, width / height, 0.1, 30);
    const key = new THREE.DirectionalLight(0xffffff, Math.PI);
    key.position.set(0.6, 1.0, 1.2).normalize();
    this.scene.add(key);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    this.lookTarget = new THREE.Object3D();
    this.scene.add(this.lookTarget);

    this.bgCanvas = document.createElement('canvas');
    this.bgCanvas.width = width;
    this.bgCanvas.height = height;
    this.bgTexture = new THREE.CanvasTexture(this.bgCanvas);
    this.bgTexture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = transparent ? null : this.bgTexture;
    this.setBackground(null);

    // Composite canvas: what you see is what gets recorded (3D + subtitles)
    this.out = document.createElement('canvas');
    this.out.width = width;
    this.out.height = height;
    this.ctx = this.out.getContext('2d');
  }

  // ---- background -------------------------------------------------------
  setBackground(img) {
    const c = this.bgCanvas.getContext('2d');
    const { W, H } = this;
    if (img) {
      const s = Math.max(W / img.width, H / img.height);
      c.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);
    } else {
      const g = c.createLinearGradient(0, 0, W * 0.4, H);
      g.addColorStop(0, '#2b6fe0');
      g.addColorStop(0.5, '#4f9cf5');
      g.addColorStop(1, '#2a66d6');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      const glow = c.createRadialGradient(W * 0.12, H * 0.38, 0, W * 0.12, H * 0.38, W * 0.9);
      glow.addColorStop(0, 'rgba(255,255,255,0.75)');
      glow.addColorStop(0.35, 'rgba(255,255,255,0.18)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = glow;
      c.fillRect(0, 0, W, H);
      c.lineCap = 'round';
      const arcs = [[0.05, 0.42, 0.85, 70, 0.1], [0.1, 0.5, 1.15, 120, 0.08], [0.95, 0.15, 0.7, 90, 0.1], [0.9, 0.85, 0.95, 60, 0.08], [0.0, 0.1, 0.6, 50, 0.1]];
      for (const [x, y, r, w, a] of arcs) {
        c.strokeStyle = `rgba(255,255,255,${a})`;
        c.lineWidth = w;
        c.beginPath();
        c.arc(W * x, H * y, W * r, 0, Math.PI * 2);
        c.stroke();
      }
    }
    this.bgTexture.needsUpdate = true;
  }

  // ---- model ------------------------------------------------------------
  async loadVRM(url) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    const vrm = gltf.userData.vrm;
    if (this.vrm) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    this.baseYaw = vrm.scene.rotation.y; // PI for VRM 0.x models, which face -Z; the turn-to-walk lerp must keep it
    vrm.scene.traverse((o) => (o.frustumCulled = false));
    this.scene.add(vrm.scene);
    this.vrm = vrm;
    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget;
    this.bones = {};
    for (const n of ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg']) {
      this.bones[n] = vrm.humanoid.getNormalizedBoneNode(n) ?? new THREE.Object3D(); // optional bones (shoulders, upper chest) may be missing: poses write to a detached dummy
    }
    this.flipBones = Math.abs(this.baseYaw) > 1 ? Object.keys(vrm.humanoid.humanBones).map((n) => vrm.humanoid.getNormalizedBoneNode(n)).filter(Boolean) : null;
    this.hipsY0 = this.bones.hips.position.y;
    this.mixer = null;
    this.action = null;
    this.hairMats = [];
    this.topMats = [];
    this.bottomMats = [];
    vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (/hair/i.test(m.name) || /hair/i.test(o.name)) this.hairMats.push(m);
        else if (/^tops/i.test(m.name)) this.topMats.push(m);
        else if (/^bottoms/i.test(m.name)) this.bottomMats.push(m);
      }
    });
    this.hairOriginal = null;
    this.applyHair();
    this.applyOutfit();
    this.buildEars();
    this.buildParts();
    this.buildFace();
    this.buildSkirtPhysics();
    this.relaxHands();
    this.frameCamera();
    return { expressions: Object.keys(vrm.expressionManager?.expressionMap ?? {}), hair: this.hairMats.map((m) => m.name), meta: vrm.meta?.name };
  }

  // Models without spring bone data (Taila) have a rigid skirt: give its leaf bones spring joints, let the thighs push it
  // out of the way, and blow it against the walking direction (she walks in place, the window moves, so there is no real inertia)
  buildSkirtPhysics() {
    const vrm = this.vrm;
    this.skirtJoints = [];
    this.skirtRoots = []; // the first bone of each chain: the one the thigh push is applied to
    if (vrm.springBoneManager) { // the model brings its own (Taila: tools/taila_rig.mjs); wind and leg push still reach its skirt chains
      for (const j of vrm.springBoneManager.joints) {
        if (!/skirt/i.test(j.bone.name)) continue;
        this.skirtJoints.push(j);
        if (!/skirt/i.test(j.bone.parent?.name ?? '')) this.skirtRoots.push(j);
      }
      return;
    }
    const bones = [];
    vrm.scene.traverse((o) => { if (/skirt/i.test(o.name) && o.parent && !o.children.length) bones.push(o); });
    if (!bones.length) return;
    const groups = [];
    for (const side of ['left', 'right']) {
      const up = vrm.humanoid.getRawBoneNode(`${side}UpperLeg`), low = vrm.humanoid.getRawBoneNode(`${side}LowerLeg`);
      if (!up || !low) continue;
      const c = new VRMSpringBoneCollider(new VRMSpringBoneColliderShapeCapsule({ radius: 0.09, tail: low.position.clone() }));
      up.add(c);
      groups.push({ colliders: [c] });
    }
    const mgr = new VRMSpringBoneManager();
    for (const bone of bones) {
      const j = new VRMSpringBoneJoint(bone, null, { hitRadius: 0.025, stiffness: 0.55, dragForce: 0.35, gravityPower: 0 }, groups);
      mgr.addJoint(j);
      this.skirtJoints.push(j);
      this.skirtRoots.push(j);
    }
    mgr.setInitState();
    vrm.springBoneManager = mgr;
  }

  frameCamera() {
    if (!this.bones?.head) return;
    this.vrm.scene.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    this.bones.head.getWorldPosition(p);
    this.headY = p.y;
    const s = this.settings;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    const d = s.cameraCoverage / (2 * Math.tan(THREE.MathUtils.degToRad(s.fov / 2)));
    this.camera.position.set(0, this.headY + s.cameraCenterOffset, d);
    this.camera.lookAt(0, this.headY + s.cameraCenterOffset, 0);
    this.lookTarget.position.set(0, this.headY, d);
  }

  // ---- hair retint (desaturate the texture, then tint) --------------------
  applyHair() {
    if (!this.hairMats?.length) return;
    const s = this.settings;
    if (!this.hairOriginal) {
      this.hairOriginal = this.hairMats.map((m) => ({ color: m.color?.clone(), shade: m.shadeColorFactor?.clone(), map: m.map, shadeTex: m.shadeMultiplyTexture }));
    }
    this.hairMats.forEach((m, i) => {
      const o = this.hairOriginal[i];
      if (!s.hairTint) {
        if (o.color) m.color.copy(o.color);
        if (o.shade) m.shadeColorFactor.copy(o.shade);
        m.map = o.map;
        if ('shadeMultiplyTexture' in m) m.shadeMultiplyTexture = o.shadeTex;
        m.needsUpdate = true;
        return;
      }
      const tint = new THREE.Color(s.hairColor);
      m.map = this.grayscale(o.map);
      if ('shadeMultiplyTexture' in m) m.shadeMultiplyTexture = this.grayscale(o.shadeTex);
      m.color.copy(tint);
      if (m.shadeColorFactor) m.shadeColorFactor.copy(tint).multiplyScalar(0.6);
      m.needsUpdate = true;
    });
  }

  grayscale(tex) {
    if (!tex?.image) return tex;
    this._grayCache ??= new Map();
    if (this._grayCache.has(tex)) return this._grayCache.get(tex);
    const img = tex.image;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    let sum = 0;
    const n = d.data.length / 4;
    for (let i = 0; i < d.data.length; i += 4) sum += 0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2];
    const gain = 190 / Math.max(1, sum / n); // normalise average luminance so the tint colour reads true
    for (let i = 0; i < d.data.length; i += 4) {
      const l = Math.min(255, (0.3 * d.data[i] + 0.59 * d.data[i + 1] + 0.11 * d.data[i + 2]) * gain);
      d.data[i] = d.data[i + 1] = d.data[i + 2] = l;
    }
    x.putImageData(d, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.flipY = tex.flipY;
    t.colorSpace = tex.colorSpace;
    t.wrapS = tex.wrapS;
    t.wrapT = tex.wrapT;
    this._grayCache.set(tex, t);
    return t;
  }

  // ---- outfit tint ---------------------------------------------------------------
  applyOutfit() {
    const s = this.settings;
    this._outfitOrig ??= new Map();
    const tint = (mats, hex) => {
      for (const m of mats) {
        if (!this._outfitOrig.has(m)) this._outfitOrig.set(m, { color: m.color?.clone(), shade: m.shadeColorFactor?.clone() });
        const o = this._outfitOrig.get(m);
        if (!s.outfitTint) { m.color?.copy(o.color); o.shade && m.shadeColorFactor.copy(o.shade); }
        else { const c = new THREE.Color(hex); m.color.copy(c); m.shadeColorFactor?.copy(c).multiplyScalar(0.7); }
        m.needsUpdate = true;
      }
    };
    tint(this.topMats ?? [], s.topColor);
    tint(this.bottomMats ?? [], s.skirt ? s.skinColor : s.bottomColor); // skirt hides the shorts, so the legs stay skin
  }

  // Curl the fingers a little so hands do not stay in a stiff T-pose shape.
  relaxHands() {
    const h = this.vrm.humanoid;
    this.fingers = [];
    for (const [side, sign] of [['left', -1], ['right', 1]]) {
      ['Index', 'Middle', 'Ring', 'Little'].forEach((f, fi) => {
        for (const [seg, k] of [['Proximal', 0.35], ['Intermediate', 0.45], ['Distal', 0.3]]) {
          const n = h.getNormalizedBoneNode(`${side}${f}${seg}`);
          if (n) { n.rotation.z = sign * k; this.fingers.push({ n, sign, k, fi, side }); }
        }
      });
    }
    this.handCurl = 1;
  }

  // Per-frame hand life: the curl follows the pose (open for a wave or stretch, closed when shy) and each finger and wrist drifts a little.
  animateHands(t, dt, sp) {
    if (!this.fingers?.length) return;
    const fx = this.fx?.name, wave = this.pose === 'wave';
    const open = wave ? 0.2 : fx === 'stretch' ? 0.1 : fx === 'shy' ? 1.5 : this.pose === 'handsFront' ? 1.2 : 1;
    this.handCurl += (open - this.handCurl) * (1 - Math.exp(-dt * 5));
    for (const { n, sign, k, fi, side } of this.fingers) {
      const idle = Math.sin(t * 0.8 + fi * 0.7 + (side === 'left' ? 0 : 2)) * 0.1 + Math.sin(t * 7 + fi) * sp * 0.08;
      const flutter = wave && side === 'right' ? Math.sin(t * 9 - fi * 0.6) * 0.12 : 0;
      n.rotation.z = sign * Math.max(0, k * (this.handCurl + idle) + flutter);
    }
    const b = this.bones;
    const sway = (side) => Math.sin(t * 0.7 + (side === 'left' ? 0 : 1.7));
    if (b.leftHand) b.leftHand.rotation.set(sway('left') * 0.05 + sp * 0.12 * Math.sin(t * 4.2), 0, -0.06 * sway('left'));
    if (b.rightHand) b.rightHand.rotation.set(sway('right') * 0.05 + sp * 0.12 * Math.sin(t * 4.6), 0, 0.06 * sway('right') + (wave ? Math.sin(t * 9 + 1) * 0.3 : 0));
  }

  // ---- VRMA animation clips (data/animations, see README) ---------------------------------
  async loadClips(names) {
    this.clips ??= {};
    const loader = new GLTFLoader();
    loader.register((p) => new VRMAnimationLoaderPlugin(p));
    await Promise.all(names.filter((n) => !this.clips[n]).map(async (n) => {
      const g = await loader.loadAsync(`/data/animations/${n}.vrma`).catch(() => null);
      const va = g?.userData.vrmAnimations?.[0];
      if (va) this.clips[n] = { va, clip: null };
    }));
  }

  // Plays a clip; resolves when it ends (never for loops). Starting another clip or stopClip() cancels it.
  playClip(name, { loop = false, speed = 1, hold = false } = {}) {
    const c = this.clips?.[name];
    if (!c || !this.vrm) return Promise.resolve(false);
    this.mixer ??= new THREE.AnimationMixer(this.vrm.scene);
    if (!c.clip || c.vrm !== this.vrm) {
      c.clip = createVRMAnimationClip(c.va, this.vrm);
      // dances from other rigs carry hip heights that sink her below the window: keep the rotations, drop the hip translation
      if (name.startsWith('dance_')) c.clip.tracks = c.clip.tracks.filter((t) => !t.name.endsWith('.position'));
      c.vrm = this.vrm;
    }
    const next = this.mixer.clipAction(c.clip);
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.clampWhenFinished = hold;
    next.timeScale = speed;
    next.play();
    if (this.action && this.action !== next) next.crossFadeFrom(this.action, 0.25, false);
    else next.fadeIn(0.25);
    this.action = next;
    this.actionName = name;
    this.onClipEnd?.();
    return new Promise((ok) => {
      const done = (e) => {
        if (e && e.action !== next) return;
        this.mixer.removeEventListener('finished', done);
        if (this.action === next && !hold) this.action = null;
        this.onClipEnd = null;
        ok(true);
      };
      this.mixer.addEventListener('finished', done);
      this.onClipEnd = () => { this.mixer.removeEventListener('finished', done); ok(false); };
    });
  }

  stopClip() {
    this.action?.fadeOut(0.25);
    const a = this.action;
    this.action = null;
    this.onClipEnd?.();
    this.onClipEnd = null;
    if (a) setTimeout(() => a.stop(), 300);
  }

  // ---- painted face (Taila): the mouth and eye sockets live in the face texture, so animate that ----------------
  // Pixel positions are for Taila's 1024px face texture (data/source/taila/textures/Body_Mix.010).
  buildFace() {
    this.face = null;
    let mat = null;
    this.eyeMats = [];
    this.vrm.scene.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) {
        if (m.name === 'Face' && m.emissiveMap?.image) mat = m;
        if (/^Eyes/.test(m.name)) this.eyeMats.push(m);
      }
    });
    if (!mat || this.eyeMats.length < 2) return;
    const img = mat.emissiveMap.image;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = mat.emissiveMap.flipY;
    tex.colorSpace = mat.emissiveMap.colorSpace;
    tex.wrapS = mat.emissiveMap.wrapS;
    tex.wrapT = mat.emissiveMap.wrapT;
    mat.emissiveMap = tex;
    mat.needsUpdate = true;
    this.face = { img, canvas, tex, key: '' };
    this.updateFace(0, 0, 0);
  }

  updateFace(blink, happy, open) {
    const f = this.face;
    if (!f) return;
    const closed = blink > 0.5 || happy > 0.6;
    const mouth = open < 0.08 ? 0 : Math.min(4, 1 + Math.floor(open * 4));
    const key = `${closed ? (happy > 0.6 ? 2 : 1) : 0}${mouth}`;
    if (key === f.key) return;
    f.key = key;
    for (const m of this.eyeMats) m.visible = !closed;
    const c = f.canvas.getContext('2d');
    c.drawImage(f.img, 0, 0, 1024, 1024);
    // canvas is the upright image (GLTFLoader already flipped the bitmap). The sclera lives in two white islands
    // at the left and right edge (y 384); the mouth is a dash at (516, 418).
    if (closed) {
      for (const cx of [40, 984]) {
        c.fillStyle = '#f0d9cb';
        c.beginPath();
        c.ellipse(cx, 384, 62, 58, 0, 0, Math.PI * 2);
        c.fill();
        // texture x runs up the eye on the left island and down on the right one, so mirror the bow
        const sd = cx < 512 ? 1 : -1, bow = happy > 0.6 ? 1 : -1; // bow -1 = closed lid, 1 = ^ ^ when happy
        c.strokeStyle = '#3a2220';
        c.lineWidth = 9;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(cx + sd * bow * 25, 336);
        c.quadraticCurveTo(cx - sd * bow * 45, 384, cx + sd * bow * 25, 432);
        c.stroke();
      }
    }
    if (mouth) {
      const h = [0, 7, 13, 20, 27][mouth];
      c.fillStyle = '#f6e8df'; // hide the painted dash
      c.fillRect(470, 404, 92, 30);
      c.fillStyle = '#6e2230';
      c.beginPath();
      c.ellipse(516, 418 + h / 3, 15 + mouth * 3, 3 + h / 2, 0, 0, Math.PI * 2);
      c.fill();
      if (mouth > 2) { c.fillStyle = '#d9707d'; c.beginPath(); c.ellipse(516, 418 + h / 2, 10, h / 4, 0, 0, Math.PI * 2); c.fill(); }
    }
    f.tex.needsUpdate = true;
  }

  // ---- pleated skirt, belt and side braid ------------------------------------
  buildParts() {
    this.skirtGroup?.removeFromParent();
    this.braidGroup?.removeFromParent();
    const lam = (o) => new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, ...o });
    this.skirtGroup = new THREE.Group();
    this.skirtMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 6, true), lam());
    this.skirtBase = this.skirtMesh.geometry.attributes.position.array.slice();
    this.beltMesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), lam());
    this.buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.026, 0.01), lam({ color: '#d7dbe4' }));
    this.skirtGroup.add(this.skirtMesh, this.beltMesh, this.buckle);
    this.bones.hips.add(this.skirtGroup);

    this.braidGroup = new THREE.Group();
    this.braidMat = lam();
    this.braidSegs = [];
    for (let i = 0; i < 9; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), this.braidMat);
      const r = 0.024 - i * 0.0015;
      seg.scale.set(r, 0.026, r * 0.9);
      seg.position.set(0.108, 0.03 - i * 0.04, 0.085);
      seg.rotation.z = i % 2 ? 0.45 : -0.45;
      this.braidGroup.add(seg);
      this.braidSegs.push(seg);
    }
    const tie = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), lam({ color: '#111318' }));
    tie.position.set(0.108, 0.03 - 9 * 0.04, 0.085);
    this.braidGroup.add(tie);
    this.bones.head.add(this.braidGroup);
    this.layoutParts();
  }

  layoutParts() {
    if (!this.skirtGroup) return;
    const s = this.settings;
    this.skirtGroup.visible = s.skirt;
    this.braidGroup.visible = s.braid;
    this.braidMat.color.set(s.hairColor);
    // flared pleated cylinder hanging from the waist (cylinder y runs +0.5 top to -0.5 hem)
    const pos = this.skirtMesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = this.skirtBase[i * 3], by = this.skirtBase[i * 3 + 1], bz = this.skirtBase[i * 3 + 2];
      const f = 0.5 - by; // 0 at the waist, 1 at the hem
      const r = s.skirtTop + (s.skirtBottom - s.skirtTop) * f;
      const pleat = 1 + 0.045 * f * Math.cos(Math.atan2(bz, bx) * 24);
      pos.setXYZ(i, bx * r * pleat, by * s.skirtLen, bz * r * pleat);
    }
    pos.needsUpdate = true;
    this.skirtMesh.geometry.computeVertexNormals();
    this.skirtMesh.material.color.set(s.skirtColor);
    this.skirtMesh.position.set(0, s.skirtY - s.skirtLen / 2, 0.005);
    this.beltMesh.scale.set(s.skirtTop + 0.004, 0.028, s.skirtTop + 0.004);
    this.beltMesh.position.set(0, s.skirtY - 0.012, 0.005);
    this.beltMesh.material.color.set(s.beltColor);
    this.buckle.position.set(0, s.skirtY - 0.012, s.skirtTop + 0.012);
  }

  gesture(name, seconds = 3) {
    this.pose = name;
    this.poseT = seconds;
  }

  // timed procedural gesture: stretch, yawn, shy, sleepy, earPerk
  perform(name, seconds = { stretch: 3.4, yawn: 3, shy: 3.6, sleepy: 6, earPerk: 1.6 }[name] ?? 3) {
    this.fx = { name, t: 0, dur: seconds };
    return new Promise((ok) => setTimeout(ok, seconds * 1000));
  }

  // ---- cat ears -------------------------------------------------------------
  buildEars() {
    if (this.ears) this.ears.parent?.remove(this.ears);
    const s = this.settings;
    const head = this.bones?.head;
    if (!head) return;
    this.ears = new THREE.Group();
    this.earMeshes = [];
    for (const side of [-1, 1]) {
      const ear = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.058, 0.13, 3), new THREE.MeshLambertMaterial({ color: s.earColor }));
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.095, 3), new THREE.MeshLambertMaterial({ color: s.earInner }));
      outer.scale.z = 0.38;
      inner.scale.z = 0.3;
      inner.position.set(0, -0.006, 0.012);
      ear.add(outer, inner);
      ear.userData.side = side;
      this.ears.add(ear);
      this.earMeshes.push(ear);
    }
    // small black cross hairpin at the temple
    const pin = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: '#111318' });
    pin.add(new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.009, 0.006), mat), new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.034, 0.006), mat));
    pin.position.set(0.098, 0.115, 0.075);
    pin.rotation.set(0, 0.9, 0.2);
    this.pin = pin;
    this.ears.add(pin);
    head.add(this.ears);
    this.layoutEars();
  }

  layoutEars() {
    if (!this.ears) return;
    const s = this.settings;
    this.ears.visible = s.ears;
    if (this.pin) this.pin.visible = s.hairpin;
    for (const ear of this.earMeshes) {
      const side = ear.userData.side;
      ear.position.set(side * s.earX, s.earY, s.earZ);
      ear.rotation.set(-0.12, 0, -side * s.earTilt);
      ear.scale.setScalar(s.earSize);
      ear.children[0].material.color.set(s.earColor);
      ear.children[0].material.emissive.set(s.earColor).multiplyScalar(0.3);
      ear.children[1].material.color.set(s.earInner);
    }
  }

  // ---- emotion / pose -----------------------------------------------------
  setEmotion(name) {
    this.emotion = EMOTIONS[name] ? name : 'neutral';
    this.emotionHoldUntil = this.t + 6;
    if (name === 'joy' && Math.random() < 0.3) this.gesture('wave', 2.6);
  }

  update(dt, voice = { level: 0, centroid: 0 }) {
    const vrm = this.vrm;
    if (!vrm) return;
    this.t += dt;
    const t = this.t;
    const b = this.bones;
    const sp = (this.speech = lerp(this.speech, clamp01(voice.level * 4), 1 - Math.exp(-dt * 12)));

    // a playing animation clip owns the body; the procedural idle/walk below only runs between clips
    this.mixer?.update(dt);
    if (!this.action) {
      // idle: breathing, weight shift between the legs, slow sway
      const breath = Math.sin(t * 1.6);
      const sway = Math.sin(t * 0.7);
      const shift = Math.sin(t * 0.45 + 1);
      b.hips.position.x = sway * 0.004 + shift * 0.012;
      b.hips.rotation.z = shift * 0.022;
      if (b.leftUpperLeg) b.leftUpperLeg.rotation.z = -shift * 0.022 + 0.01;
      if (b.rightUpperLeg) b.rightUpperLeg.rotation.z = -shift * 0.022 - 0.01;
      b.spine.rotation.set(0.02 + breath * 0.008, sway * 0.025, sway * 0.012 - shift * 0.012);
      b.chest.rotation.set(breath * 0.012 + sp * 0.02, Math.sin(t * 0.5) * 0.02, 0);
      if (b.upperChest) b.upperChest.rotation.set(breath * 0.01, 0, 0);

      // pose scheduler: pick a new idle pose every few seconds, relaxed while talking
      this.poseT -= dt;
      if (this.poseT <= 0) {
        this.pose = sp > 0.15 ? 'relaxed' : IDLE_POSES[Math.floor(Math.random() * IDLE_POSES.length)];
        this.poseT = this.pose === 'shrug' ? 1.4 : 5 + Math.random() * 6;
      }
      const def = POSES[this.pose] ?? {};
      const a = {};
      for (const n of Object.keys(BASE_POSE)) {
        const tgt = def[n] ?? BASE_POSE[n];
        const c = (this.cur[n] ??= [...BASE_POSE[n]]);
        for (let i = 0; i < 3; i++) c[i] = lerp(c[i], tgt[i], 1 - Math.exp(-dt * 3.2));
        a[n] = c;
      }
      const armLift = sp * 0.12 * Math.sin(t * 4.2);
      const wave = this.pose === 'wave' ? Math.sin(t * 9) * 0.4 : 0;
      // walking: turn to the side, swing legs and arms; blends in and out with walkAmt
      const wk = (this.walkAmt = lerp(this.walkAmt, this.walkDir ? 1 : 0, 1 - Math.exp(-dt * 6)));
      if (this.walkDir) this.facing = this.walkDir * 1.1;
      else if (wk < 0.05) this.facing = 0;
      vrm.scene.rotation.y = lerp(vrm.scene.rotation.y, this.facing + (this.baseYaw ?? 0),1 - Math.exp(-dt * 5));
      this.walkPhase += dt * 6.5 * wk;
      const sw = Math.sin(this.walkPhase) * wk;
      const kn = Math.cos(this.walkPhase) * wk;
      const legs = [['left', 1], ['right', -1]];
      for (const [side, k] of legs) {
        const up = b[`${side}UpperLeg`], low = b[`${side}LowerLeg`];
        if (up) up.rotation.x = -sw * k * 0.42;
        if (low) low.rotation.x = Math.max(0, kn * k) * 0.8 * wk;
      }
      b.hips.position.y = this.hipsY0 - Math.abs(Math.cos(this.walkPhase)) * 0.012 * wk;
      const armSwing = sw * 0.4;
      b.leftUpperArm.rotation.set(a.leftUpperArm[0] + armSwing, 0,a.leftUpperArm[2] + sway * 0.015 + breath * 0.01 - armLift * 0.4);
      b.rightUpperArm.rotation.set(a.rightUpperArm[0] - armSwing,0, a.rightUpperArm[2] - sway * 0.015 - breath * 0.01 + armLift);
      b.leftLowerArm.rotation.set(0, a.leftLowerArm[1], 0);
      b.rightLowerArm.rotation.set(0, a.rightLowerArm[1] + sp * 0.25 * (0.5 + 0.5 * Math.sin(t * 3.1)), a.rightLowerArm[2] + wave);
      b.leftShoulder.rotation.z = a.leftShoulder[2] + breath * 0.006;
      b.rightShoulder.rotation.z = a.rightShoulder[2] - breath * 0.006;
      this.braidSegs?.forEach((sg, i) => (sg.position.x = 0.108 + Math.sin(t * 1.3 - i * 0.5) * 0.003 * i + shift * 0.002 * i));
    }

    // procedural gestures (stretch, yawn, shy, sleepy, earPerk) blend over the idle pose; a playing clip keeps the body
    const fx = this.fx;
    let e = 0, fxBlink = 0, fxMouth = 0, fxHead = [0, 0, 0];
    if (fx) {
      fx.t += dt;
      const k = fx.t / fx.dur;
      if (k >= 1) this.fx = null;
      else e = smooth(Math.min(1, k / 0.22, (1 - k) / 0.28));
    }
    if (fx && e > 0) {
      const mix = (bone, x, y, z) => { if (bone) bone.rotation.set(lerp(bone.rotation.x, x, e), lerp(bone.rotation.y, y, e), lerp(bone.rotation.z, z, e)); };
      const body = !this.action;
      if (fx.name === 'stretch') {
        if (body) {
          mix(b.leftUpperArm, -0.1, 0, 1.55); mix(b.rightUpperArm, -0.1, 0, -1.55);
          mix(b.leftLowerArm, 0, -0.1, 0); mix(b.rightLowerArm, 0, 0.1, 0);
          b.spine.rotation.x -= 0.14 * e; b.chest.rotation.x -= 0.1 * e;
          b.hips.position.y += 0.012 * e;
        }
        fxHead = [-0.25 * e, 0, 0]; fxBlink = 0.85 * e;
      } else if (fx.name === 'yawn') {
        if (body) { b.leftShoulder.rotation.z += 0.12 * e; b.rightShoulder.rotation.z -= 0.12 * e; b.spine.rotation.x -= 0.06 * e; }
        fxHead = [-0.2 * e, 0, 0.05 * e]; fxBlink = 0.8 * e; fxMouth = 0.9 * e;
      } else if (fx.name === 'shy') {
        if (body) {
          // hands together in front, fidgeting a little
          const fid = Math.sin(t * 5) * 0.06;
          mix(b.leftUpperArm, -0.3, 0, -0.95); mix(b.rightUpperArm, -0.3, 0, 0.95);
          mix(b.leftLowerArm, 0, 1.35 + fid, 0); mix(b.rightLowerArm, 0, -1.35 - fid, 0);
        }
        fxHead = [0.15 * e, 0.38 * e, 0.08 * e]; fxBlink = 0.25 * e;
      } else if (fx.name === 'sleepy') {
        if (body) { b.spine.rotation.x += 0.2 * e; b.chest.rotation.x += 0.1 * e; }
        fxHead = [0.4 * e, Math.sin(t * 0.8) * 0.06 * e, Math.sin(t * 0.6) * 0.08 * e]; fxBlink = (0.65 + 0.15 * Math.sin(t * 1.3)) * e;
      }
    }
    if (!this.action) this.animateHands(t, dt, sp);
    const earWag = fx?.name === 'earPerk' ? Math.sin(t * 34) * 0.16 * e : 0;

    // head follows the pointer a little, nods while talking
    const nod = sp * 0.05 * Math.sin(t * 5.3);
    const tilt = Math.sin(t * 0.45) * 0.03 + (this.emotion === 'smirk' ? 0.07 : 0);
    const k = 1 - Math.exp(-dt * 4); // the cursor arrives in steps (10 Hz in the overlay), so ease toward it
    this.look.x += (this.pointer.x - this.look.x) * k;
    this.look.y += (this.pointer.y - this.look.y) * k;
    b.neck.rotation.set(nod * 0.5 + fxHead[0] * 0.4, this.look.x * 0.12 + fxHead[1] * 0.4, tilt * 0.5 + fxHead[2] * 0.4);
    b.head.rotation.set(-this.look.y * 0.08 + nod + fxHead[0] * 0.6, this.look.x * 0.16 + Math.sin(t * 0.33) * 0.03 + fxHead[1] * 0.6, tilt + fxHead[2] * 0.6);
    this.lookTarget.position.set(this.look.x * 0.6, (this.headY ?? 1.4) + this.look.y * 0.35, this.camera.position.z);

    // ear twitch
    if (this.ears) {
      const tw = Math.max(0, Math.sin(t * 0.8 + 1)) ** 40;
      this.earMeshes[0].rotation.z = -(-1) * this.settings.earTilt - tw * 0.18 + earWag;
      this.earMeshes[1].rotation.z = -(1) * this.settings.earTilt + tw * 0.1 - earWag;
    }

    // expressions (smoothed)
    if (this.emotionHoldUntil && t > this.emotionHoldUntil && sp < 0.05) {
      this.emotion = 'neutral';
      this.emotionHoldUntil = 0;
    }
    const target = EMOTIONS[this.emotion] ?? {};
    const em = vrm.expressionManager;
    for (const name of ['happy', 'angry', 'sad', 'relaxed', 'surprised']) {
      const want = target[name] ?? 0;
      this.emo[name] = lerp(this.emo[name] ?? 0, want, 1 - Math.exp(-dt * 7));
      em?.setValue(name, this.emo[name]);
    }

    // blink
    const bl = this.blink;
    bl.next -= dt;
    if (bl.next <= 0 && bl.t < 0) bl.t = 0;
    let blinkV = fxBlink;
    if (bl.t >= 0) {
      bl.t += dt;
      blinkV = Math.max(fxBlink, Math.sin(Math.min(1, bl.t / 0.16) * Math.PI));
      if (bl.t > 0.16) {
        bl.t = -1;
        bl.next = 1.8 + Math.random() * 4.2;
      }
    }
    em?.setValue('blink', blinkV);
    const open = Math.max(fxMouth, clamp01(voice.level * 5.5));
    this.updateFace(blinkV, this.emo.happy ?? 0, open);

    // lip sync: open amount from level, vowel from spectral centroid
    const c = voice.centroid;
    const w = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    if (open > 0.02) {
      if (c < 450) { w.ou = 0.5; w.oh = 0.5; }
      else if (c < 900) { w.aa = 1; }
      else if (c < 1500) { w.ee = 0.5; w.aa = 0.5; }
      else { w.ih = 0.8; w.ee = 0.2; }
    }
    for (const k of Object.keys(w)) {
      this.mouth[k] = lerp(this.mouth[k], w[k] * open, 1 - Math.exp(-dt * 22));
      em?.setValue(k, this.mouth[k] * 0.85);
    }

    // skirt wind: against the walking direction (world x), a little more while she bobs
    const wk = this.walkAmt ?? 0, wd = this.walkDir || Math.sign(this.facing) || 0;
    for (const j of this.skirtJoints ?? []) {
      j.settings.gravityDir.set(-wd, -0.25, 0).normalize();
      j.settings.gravityPower = 0.22 * wk;
    }

    // VRM 0.x bones live in a frame turned half a circle about Y from the one all poses and clips are written in:
    // mirror x and z of each normalised bone for the update, then put them back for the next frame.
    const flip = () => { for (const n of this.flipBones ?? []) { n.quaternion.x *= -1; n.quaternion.z *= -1; } const h = this.bones.hips.position; h.x *= -1; h.z *= -1; };
    if (this.flipBones) flip();
    vrm.update(dt);
    if (this.flipBones) flip();
    this.skirtFollowLegs();
  }

  // The skirt bones are rigid under the pelvis, so a thigh swung forward (sitting, stepping) cuts through the hem. After the
  // spring step, rotate each skirt bone about its own origin by a share of the nearby thigh's swing (world-space delta).
  skirtFollowLegs() {
    const joints = this.skirtRoots;
    if (!joints?.length) return;
    const B = this.bones, k = this.skirtFollow ?? { gain: 0.8, reach: 0.16 };
    const Qh = B.hips.getWorldQuaternion(_qa);
    const legs = ['left', 'right'].map((s) => {
      const ql = B[`${s}UpperLeg`].quaternion;
      return { d: new THREE.Quaternion().copy(Qh).multiply(ql).multiply(_qb.copy(Qh).invert()), p: this.vrm.humanoid.getRawBoneNode(`${s}UpperLeg`).getWorldPosition(new THREE.Vector3()) };
    });
    for (const j of joints) {
      const bone = j.bone, P = bone.parent.getWorldQuaternion(_qc), pos = bone.getWorldPosition(_v);
      const D = _qd.identity();
      for (const l of legs) {
        const w = k.gain * Math.exp(-((pos.distanceTo(l.p) / k.reach) ** 2));
        D.multiply(_qe.identity().slerp(l.d, w));
      }
      bone.quaternion.premultiply(_qf.copy(P).invert().multiply(D).multiply(P));
    }
  }

  // render at k times the logical size so a zoomed or high-DPI window stays sharp (W and H stay the drawing units)
  setResolution(k) {
    this.renderer.setPixelRatio(k);
    this.renderer.setSize(this.W, this.H, false);
    this.out.width = Math.round(this.W * k);
    this.out.height = Math.round(this.H * k);
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
  }

  // ---- render + subtitles -------------------------------------------------
  render() {
    this.renderer.render(this.scene, this.camera);
    const { ctx, W, H } = this;
    if (this.transparent) ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this.renderer.domElement, 0, 0, W, H);
    if (this.settings.subtitles && this.subtitle) this.drawSubtitle();
  }

  drawSubtitle() {
    const { ctx, W, H } = this;
    const size = this.settings.subtitleSize;
    ctx.font = `700 ${size}px "Yu Gothic UI","Meiryo","Segoe UI",sans-serif`;
    const maxW = W * 0.82;
    const lines = [];
    let line = '';
    for (const tok of this.subtitle.match(/\s+|[　-鿿＀-￯]|\S+/g) ?? []) {
      if (ctx.measureText(line + tok).width > maxW && line.trim()) { lines.push(line.trim()); line = tok.trimStart(); }
      else line += tok;
    }
    if (line.trim()) lines.push(line.trim());
    const lh = size * 1.35;
    const boxH = lines.length * lh + size * 0.9;
    const y0 = H * (this.settings.subtitleY ?? 0.8) - boxH / 2;
    ctx.fillStyle = 'rgba(12,16,28,0.62)';
    ctx.beginPath();
    ctx.roundRect(W * 0.07, y0, W * 0.86, boxH, 34);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    lines.forEach((l, i) => {
      const y = y0 + size * 0.45 + lh * (i + 0.5);
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(l, W / 2, y);
      ctx.fillStyle = '#fff';
      ctx.fillText(l, W / 2, y);
    });
  }
}
