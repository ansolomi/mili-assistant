import GUI from 'lil-gui';
import { Stage, EMOTIONS } from './stage.js';
import { Bridge } from './bridge.js';
import { startOverlay } from './overlay.js';

const params = new URLSearchParams(location.search);
if (params.has('clean')) document.body.classList.add('clean');
const $ = (id) => document.getElementById(id);
const api = async (path, opts) => (await fetch(path, opts)).json();

const saved = await api('/api/settings').catch(() => ({}));
const overlayMode = params.has('overlay');
const stage = new Stage(overlayMode ? { width: 520, height: 800, transparent: true } : { width: 1080, height: 1920 });
Object.assign(stage.settings, saved.stage ?? {});
$('stageWrap').prepend(stage.out);
window.stage = stage;

// ---- chat log --------------------------------------------------------------
const log = $('log');
function say(text, cls = '') {
  const d = document.createElement('div');
  d.className = `msg ${cls}`;
  d.textContent = text;
  log.append(d);
  log.scrollTop = log.scrollHeight;
}

// ---- bridge to the Open-LLM-VTuber server ---------------------------------------
const wsUrl = params.get('ws') ?? saved.wsUrl ?? 'ws://localhost:12393/client-ws';
const bridge = new Bridge(wsUrl, {
  onStatus: (s) => { $('badge').textContent = s; $('badge').className = s === 'connected' ? 'ok' : 'bad'; },
  onSubtitle: (t) => (stage.subtitle = t),
  onEmotion: (e) => e && stage.setEmotion(e),
  onUserText: (t) => say(t, 'me'),
  onAiText: (t) => say(t),
  onInfo: (t) => say(t, 'info'),
  onMic: (on) => $('mic').classList.toggle('on', on),
});
window.bridge = bridge;
bridge.connect();

const unlock = () => { bridge.resume(); $('audioHint').remove(); window.removeEventListener('pointerdown', unlock); };
window.addEventListener('pointerdown', unlock);

const sendText = () => { const t = $('text').value.trim(); if (!t) return; say(t, 'me'); bridge.sendText(t); $('text').value = ''; };
$('send').onclick = sendText;
$('text').onkeydown = (e) => e.key === 'Enter' && sendText();
$('stop').onclick = () => bridge.interrupt();
$('mic').onpointerdown = () => bridge.startMic().catch((e) => say(`Mic: ${e.message}`, 'info'));
window.addEventListener('pointerup', () => bridge.stopMic());
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && document.activeElement !== $('text')) { e.preventDefault(); bridge.startMic().catch(() => {}); } });
window.addEventListener('keyup', (e) => { if (e.code === 'Space') bridge.stopMic(); });
window.addEventListener('pointermove', (e) => { stage.pointer.x = (e.clientX / innerWidth) * 2 - 1; stage.pointer.y = -((e.clientY / innerHeight) * 2 - 1); });

// ---- model + background ---------------------------------------------------------
const models = await api('/api/models');
const backgrounds = await api('/api/backgrounds');
const state = { model: params.get('model') ?? saved.model ?? models.find((m) => /taila/i.test(m)) ?? models.find((m) => /twist/i.test(m)) ?? models[0], background: saved.background ?? 'default' };

// Models that already have their own hair, ears and outfit skip the procedural extras made for Twist-sample.
const OWN_LOOK = { hairTint: false, outfitTint: false, ears: false, hairpin: false, skirt: false, braid: false, cameraCoverage: 1.5, cameraCenterOffset: -0.42 };
let lookBackup = null;
async function loadModel(name) {
  say(`Loading ${name}...`, 'info');
  if (/taila/i.test(name)) { lookBackup ??= Object.fromEntries(Object.keys(OWN_LOOK).map((k) => [k, stage.settings[k]])); Object.assign(stage.settings, OWN_LOOK); }
  else if (lookBackup) { Object.assign(stage.settings, lookBackup); lookBackup = null; }
  const info = await stage.loadVRM(`/data/models/${encodeURIComponent(name)}`);
  console.log('VRM loaded', info);
  say(`Loaded ${info.meta ?? name} (${info.expressions.length} expressions, ${info.hair.length} hair materials)`, 'info');
}
async function loadBackground(name) {
  if (name === 'default') return stage.setBackground(null);
  const img = new Image();
  img.src = `/data/backgrounds/${encodeURIComponent(name)}`;
  await img.decode();
  stage.setBackground(img);
}
if (state.model) await loadModel(state.model).catch((e) => say(`Model failed: ${e.message}`, 'info'));
if (!overlayMode) await loadBackground(state.background).catch(() => stage.setBackground(null));
const clipNames = await api('/api/animations').catch(() => []);
await stage.loadClips(clipNames);
const overlayTick = overlayMode ? await startOverlay({ stage, bridge, say }) : null;

// ---- settings GUI -------------------------------------------------------------------
const s = stage.settings;
const gui = new GUI({ title: 'Stage settings', width: 280 });
gui.close();
gui.add(state, 'model', models).onFinishChange(loadModel);
gui.add(state, 'background', ['default', ...backgrounds]).onFinishChange(loadBackground);
const hair = gui.addFolder('Hair & ears');
hair.add(s, 'hairTint').onChange(() => stage.applyHair());
hair.addColor(s, 'hairColor').onChange(() => stage.applyHair());
hair.add(s, 'outfitTint').onChange(() => stage.applyOutfit());
hair.addColor(s, 'topColor').onChange(() => stage.applyOutfit());
hair.addColor(s, 'bottomColor').onChange(() => stage.applyOutfit());
hair.add(s, 'hairpin').onChange(() => stage.layoutEars());
const refreshParts = () => { stage.layoutParts(); stage.applyOutfit(); };
for (const k of ['skirt', 'braid']) hair.add(s, k).onChange(refreshParts);
for (const k of ['skirtColor', 'beltColor', 'skinColor']) hair.addColor(s, k).onChange(refreshParts);
for (const [k, lo, hi] of [['skirtY', -0.1, 0.3], ['skirtLen', 0.1, 0.6], ['skirtTop', 0.08, 0.2], ['skirtBottom', 0.12, 0.4]]) hair.add(s, k, lo, hi, 0.001).onChange(refreshParts);
hair.add(s, 'ears').onChange(() => stage.layoutEars());
hair.addColor(s, 'earColor').onChange(() => stage.layoutEars());
hair.addColor(s, 'earInner').onChange(() => stage.layoutEars());
for (const [k, lo, hi] of [['earX', 0, 0.2], ['earY', 0.05, 0.35], ['earZ', -0.15, 0.15], ['earTilt', 0, 1], ['earSize', 0.5, 2]]) hair.add(s, k, lo, hi, 0.001).onChange(() => stage.layoutEars());
const cam = gui.addFolder('Camera');
cam.add(s, 'cameraCoverage', 0.5, 2.5, 0.01).onChange(() => stage.frameCamera());
cam.add(s, 'cameraCenterOffset', -1, 0.3, 0.01).onChange(() => stage.frameCamera());
cam.add(s, 'fov', 15, 50, 1).onChange(() => stage.frameCamera());
const sub = gui.addFolder('Subtitles');
sub.add(s, 'subtitles');
sub.add(s, 'subtitleSize', 24, 80, 1);
const test = gui.addFolder('Test');
for (const e of Object.keys(EMOTIONS)) test.add({ go: () => stage.setEmotion(e) }, 'go').name(e);
for (const pn of ['relaxed', 'handsBack', 'handsFront', 'shrug', 'wave']) test.add({ go: () => stage.gesture(pn, 6) }, 'go').name(`pose: ${pn}`);
const clips = gui.addFolder('Animation clips');
for (const n of clipNames) clips.add({ go: () => stage.playClip(n, { hold: /^(lay|sit|hang)/.test(n) }) }, 'go').name(n);
clips.add({ go: () => stage.stopClip() }, 'go').name('stop');
test.add({ go: () => api('/api/learn', { method: 'POST' }).then((r) => say(r.started ? 'Exploring files...' : 'Already exploring', 'info')) }, 'go').name('explore files');
test.add({ go: () => { stage.subtitle = 'Hello! This is a subtitle test.'; setTimeout(() => (stage.subtitle = ''), 3000); } }, 'go').name('subtitle');
gui.add({ save: async () => { await api('/api/settings', { method: 'POST', body: JSON.stringify({ stage: s, model: state.model, background: state.background, wsUrl }) }); say('Settings saved', 'info'); } }, 'save').name('Save settings');

// ---- reel recording (video + her voice, saved as MP4 by the server) ------------------------
let rec = null;
$('rec').onclick = () => {
  if (rec) { rec.stop(); return; }
  bridge.resume();
  const stream = stage.out.captureStream(30);
  bridge.dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const mime = ['video/webm;codecs=vp9,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const chunks = [];
  rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    $('rec').classList.remove('on');
    $('rec').textContent = 'Saving...';
    const r = await api('/api/recordings', { method: 'POST', body: new Blob(chunks, { type: 'video/webm' }) });
    say(`Saved ${r.mp4 ?? r.webm}`, 'info');
    $('rec').textContent = 'Record reel';
    rec = null;
  };
  rec.start(1000);
  $('rec').classList.add('on');
  $('rec').textContent = 'Stop recording';
};

// ---- main loop ------------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  stage.update(dt, bridge.voice());
  overlayTick?.(dt);
  stage.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
