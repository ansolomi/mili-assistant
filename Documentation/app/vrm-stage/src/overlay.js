// Desktop overlay mode (?overlay=1 inside the Electron window): transparent stage that lives on the desktop.
// She walks along the taskbar, looks around, greets the cursor, perches on the taskbar edge or on the top edge of
// the foreground window (VRMA clips), reacts to clicks with a chat box, and shows what the file explorer is reading.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
const SPEED = 60; // px per second
const PX_PER_M = 640 / 1.8; // window height over camera coverage
const SIT_DROP = 0.45 * PX_PER_M; // feet hang this far below the edge she sits on (at normal size)
const MIN_SCALE = 0.5, MAX_SCALE = 1.6;
const aborted = new Error('aborted'); // thrown inside a behaviour when she is picked up
const DANCES = ['dance_rumba', 'dance_march', 'dance_dab', 'dance_soul_spin', 'dance_silly'];
const CLIPS = ['hang', 'sit_down', 'sit', 'sit_up', 'idle_look', 'wave_fast', 'joyful_jump', 'head_shake', 'idle_dwarf', 'spin', 'cross_jumps', 'arm_stretch', ...DANCES];
const NAP_AFTER = 10 * 60 * 1000; // no cursor movement, clicks or chat for this long: she dozes off on a ledge
const pick = (table) => { let r = Math.random() * table.reduce((s, [w]) => s + w, 0); for (const [w, f] of table) if ((r -= w) < 0) return f; return table[0][1]; };

export async function startOverlay({ stage, bridge, say, switchModel }) {
  document.body.classList.add('overlay');
  const s = stage.settings;
  s.cameraCoverage = 1.8 * (stage.H / 640); // she stays the same size on screen however big the window is
  s.subtitleY = 0.1;
  s.subtitleSize = 24;
  s.cameraCenterOffset = s.cameraCoverage / 2 - 0.03 - stage.headY; // feet at the bottom edge of the window
  stage.frameCamera();

  const ov = window.overlay && { ...window.overlay, setPos: (x, y) => Number.isFinite(x) && Number.isFinite(y) && window.overlay.setPos(x, y) }; // drop NaN positions instead of crashing the main process
  if (!ov) return () => {}; // opened in a normal browser: transparent look only
  await stage.loadClips(CLIPS);
  const b = await ov.bounds(); // width and height change with her size
  const area = b.area;
  let floorY = area.y + area.height - b.height + 6;
  let sc = 1;
  const st = { lastActive: performance.now(), napAfter: NAP_AFTER, x: b.x, y: floorY, dragged: false, drag: false, press: null, walk: true, chat: false, over: false, busy: false, goal: null, arrive: null, tween: null, follow: null, idle: 4, fg: null, cursor: { x: 0, y: 0 }, lastGreet: -99, hover: 0 };
  ov.setPos(st.x, st.y);

  const box = document.getElementById('ovChat');
  const pane = document.getElementById('ovPane'), chips = document.getElementById('ovFiles'), picker = document.getElementById('ovFile');
  let files = []; // paths of attachments saved in the vault, waiting for Send
  const drawChips = () => {
    chips.replaceChildren(...files.map((f, i) => {
      const s = document.createElement('span'), x = document.createElement('b');
      s.textContent = f.split(/[\\/]/).pop(); x.textContent = '×'; x.onclick = () => { files.splice(i, 1); drawChips(); };
      s.append(x); return s;
    }));
  };
  const setChat = (on) => {
    st.chat = on; st.lastActive = performance.now();
    pane.style.display = on ? 'flex' : 'none';
    if (on) { ov.focus(); setTimeout(() => box.focus(), 150); } // the window takes focus asynchronously
    else { box.value = ''; files = []; drawChips(); }
    ov.ignore(!(on || st.over));
  };
  // Attachments go to Jarvis: with files and no trigger word the message becomes "jarvis, /work <text> <paths>".
  const compose = () => {
    const text = box.value.trim();
    if (!files.length) return text;
    if (TYPED.test(text)) return `${text} Attached files: ${files.map((f) => `"${f}"`).join(' ')}`; // an explicit claude, task keeps its route
    const m = JARVIS.exec(text);
    const task = (m ? m[1] : text) || 'Look at the attached files and tell me what they are.';
    return `jarvis, ${/^\//.test(task) ? task : '/work ' + task} Attached files: ${files.map((f) => `"${f}"`).join(' ')}`;
  };
  const send = () => {
    if (!box.value.trim() && !files.length) return;
    const shown = box.value.trim() || '(attachments)';
    const msg = compose();
    say(files.length ? `${shown} [${files.length} file${files.length > 1 ? 's' : ''}]` : shown, 'me'); bridge.sendText(msg); setChat(false);
  };
  box.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') setChat(false);
  };
  document.getElementById('ovSend').onclick = send;
  document.getElementById('ovAttach').onclick = () => picker.click();
  const attach = async (list) => {
    for (const f of list) {
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name || '') }, body: f }).then((x) => x.json()).catch(() => ({}));
      if (r.path) files.push(r.path); else say(`${f.name || 'File'} not saved: ${r.error ?? 'upload failed'}`, 'info');
    }
    drawChips(); box.focus();
  };
  picker.onchange = () => { attach([...picker.files]); picker.value = ''; };
  box.addEventListener('paste', (e) => { const l = [...(e.clipboardData?.files ?? [])]; if (l.length) { e.preventDefault(); attach(l); } });
  pane.addEventListener('dragover', (e) => { e.preventDefault(); pane.classList.add('drop'); });
  pane.addEventListener('dragleave', () => pane.classList.remove('drop'));
  pane.addEventListener('drop', (e) => { e.preventDefault(); pane.classList.remove('drop'); attach([...e.dataTransfer.files]); });

  // the window is click-through except over her opaque pixels
  window.addEventListener('pointermove', (e) => {
    const r = stage.out.getBoundingClientRect();
    const cw = stage.out.width, ch = stage.out.height; // the canvas is drawn at a higher resolution than W x H when she is enlarged
    const px = Math.floor(((e.clientX - r.left) / r.width) * cw), py = Math.floor(((e.clientY - r.top) / r.height) * ch);
    const hit = !!e.target.closest?.('#ovMic') || (px >= 0 && py >= 0 && px < cw && py < ch && stage.ctx.getImageData(px, py, 1, 1).data[3] > 20);
    if (hit !== st.over) { st.over = hit; if (!st.chat && !st.drag) ov.ignore(!hit); }
    if (st.press && !st.drag && Math.hypot(e.screenX - st.press.x, e.screenY - st.press.y) > 6) pickUp();
  });

  // press and hold to carry her; a plain click opens the chat box
  const pickUp = () => {
    st.drag = st.dragged = true; st.lastActive = performance.now();
    st.goal = null; st.follow = null; stage.walkDir = 0;
    st.arrive?.();
    if (st.tween) { const t = st.tween; st.tween = null; t.ok(); }
    stage.stopClip(); // also ends a pending clip, so a running behaviour wakes up and sees `dragged`
    ov.drag(true);
  };
  const drop = async () => {
    const wasDrag = st.drag;
    st.press = null; st.drag = false;
    if (!wasDrag) return;
    ov.drag(false);
    Object.assign(b, await ov.bounds());
    st.x = b.x; st.y = b.y;
    if (st.y < floorY - 4) st.tween = { from: st.y, to: floorY, t: 0, dur: 0.5, ease: (t) => t * t, ok() {} }; // she drops back to the taskbar
  };
  window.addEventListener('pointerdown', (e) => { if (st.over && !st.chat && !e.target.closest?.('#ovMic')) st.press = { x: e.screenX, y: e.screenY }; });
  window.addEventListener('pointerup', () => { const click = st.press && !st.drag; st.press = null; if (click) setChat(true); else drop(); });
  window.addEventListener('blur', drop);

  // size: mouse wheel over her, or the tray menu; remembered between runs
  const setScale = async (v) => {
    const onFloor = Math.abs(st.y - floorY) < 8;
    sc = clamp(v, MIN_SCALE, MAX_SCALE);
    Object.assign(b, await ov.scale(sc));
    floorY = area.y + area.height - b.height + 6;
    st.x = b.x; st.y = onFloor ? floorY : b.y;
    ov.report({ scale: sc });
    await sleep(0.15); // the page's pixel ratio follows the zoom a moment later
    stage.setResolution(clamp(window.devicePixelRatio, 1, 2.5));
    try { localStorage.setItem('mili.scale', String(sc)); } catch { /* private mode: not remembered */ }
  };

  // voice: Ctrl+Alt+M (or the panel) starts listening, the same again sends it
  const onMic = bridge.h.onMic;
  const micBtn = document.getElementById('ovMic');
  bridge.h.onMic = (on) => { onMic?.(on); ov.report({ mic: on }); micBtn.classList.toggle('on', on); if (on) say('Listening... press Ctrl+Alt+M or the mic to send', 'info'); };
  const micToggle = () => (bridge.mic ? bridge.stopMic() : bridge.startMic().catch((e) => say(`Mic: ${e.message}`, 'info')));
  micBtn.onclick = micToggle;
  ov.on('mic-toggle', micToggle);
  // her mood shows in her body now and then (cooldown 40 s so a chatty reply does not turn into a dance)
  const onEmotion = bridge.h.onEmotion;
  let lastMood = -99;
  bridge.h.onEmotion = (name) => {
    onEmotion?.(name);
    if (!name || name === 'neutral' || stage.t - lastMood < 40 || Math.random() > 0.35) return;
    const how = { joy: () => window.mili.react(() => stage.playClip('joyful_jump')), anger: () => window.mili.react(() => stage.playClip('head_shake')),
      sadness: () => !st.busy && stage.perform('sleepy', 4), surprise: () => !st.busy && stage.perform('earPerk'), fear: () => !st.busy && stage.perform('shy') }[name];
    if (how) { lastMood = stage.t; how(); }
  };

  // Claude Code: "claude, <task>" typed, or "hey claude, <task>" spoken, skips her LLM and starts a headless job.
  // Voice waits 4 s first (speech recognition can mishear) so Ctrl+Alt+C can still stop it.
  const TYPED = /^\s*(?:(?:hey|ok|okay)[\s,]+)?(?:claude|クロード)[\s,、:：.。-]+(.+)$/is;
  const SPOKEN = /^\s*(?:(?:hey|ok|okay)[\s,]+(?:claude|cloud|clod|claud)|クロード)[\s,、:：.。-]+(.+)$/is;
  let pending = null;
  const cancelClaude = () => { if (pending) { clearTimeout(pending); pending = null; say('Cancelled', 'info'); } fetch('/api/claude/cancel', { method: 'POST' }); };
  const runClaude = (task) => fetch('/api/claude', { method: 'POST', body: JSON.stringify({ task }) }).then(() => say(`Claude Code: ${task}`, 'info'));
  const sendText = bridge.sendText.bind(bridge);
  const CLOUD = /^\s*cloud[\s,、:：.。-]+(.+)$/is; // typed only: "cloud, <task>" queues it in the cloud room
  const runCloud = async (task) => {
    say(`Cloud room: ${task}`, 'info');
    const r = await fetch('/api/cloud', { method: 'POST', body: JSON.stringify({ task }) }).then((x) => x.json()).catch((e) => ({ ok: false, error: e.message }));
    sendText(r.ok ? '[Task queued in the cloud Claude Code room] Tell me in one short Japanese sentence that it was sent; the answer will be on claude.ai.' : `[Cloud room failed] Tell me briefly in Japanese that it failed. Reason: ${String(r.error).slice(0, 150)}`);
  };
  const JARVIS = /^\s*jarvis[\s,、:：.。-]+(.+)$/is; // typed only: "jarvis, <task>" goes to the Jarvis bridge (/note, /ask, /work ...)
  const runJarvis = async (message) => {
    say(`Jarvis: ${message}`, 'info');
    const r = await fetch('/api/jarvis', { method: 'POST', body: JSON.stringify({ message }) }).then((x) => x.json()).catch((e) => ({ error: e.message }));
    if (r.error) return sendText(`[Jarvis failed] Tell me briefly in Japanese that it failed. Reason: ${String(r.error).slice(0, 150)}`);
    say(`Jarvis (tier ${r.tier}): ${r.reply.slice(0, 300)}`, 'info');
    sendText(`[Jarvis answered] Tell me in one or two short Japanese sentences: ${r.reply.slice(0, 300)}`);
  };
  const MODEL = /^\s*model\b[\s,、:：.。-]*(.*)$/is; // typed only: "model, arisa" swaps her look; "model" lists them
  bridge.sendText = (t) => { const c = CLOUD.exec(t), j = JARVIS.exec(t), m = TYPED.exec(t), md = MODEL.exec(t); if (md) switchModel(md[1].trim()).catch((e) => say(`Model failed: ${e.message}`, 'info')); else if (c) runCloud(c[1]); else if (j) runJarvis(j[1]); else if (m) runClaude(m[1]); else sendText(t); };
  const onUserText = bridge.h.onUserText;
  bridge.h.onUserText = (t) => {
    onUserText?.(t);
    const m = SPOKEN.exec(t);
    if (!m) return;
    bridge.interrupt(); // the brain already started answering the transcript
    say(`Sending to Claude Code in 4 s (Ctrl+Alt+C cancels): ${m[1]}`, 'info');
    clearTimeout(pending);
    pending = setTimeout(() => { pending = null; runClaude(m[1]); }, 4000);
  };
  ov.on('claude-cancel', cancelClaude);
  const told = new Set();
  let first = true;
  setInterval(async () => { // other sessions can make her speak: POST /api/say {"text": ...}
    for (const t of await fetch('/api/inbox').then((x) => x.json()).catch(() => [])) { say(`Message: ${t}`, 'info'); sendText(`[Message from another Claude Code session] Tell me in one or two short Japanese sentences: ${t}`); }
  }, 2000);
  setInterval(async () => {
    const jobs = await fetch('/api/claude').then((x) => x.json()).catch(() => null);
    if (!jobs) return;
    ov.report({ claude: jobs.filter((j) => j.status === 'running').length });
    for (const j of jobs) {
      if (j.status === 'running' || told.has(j.id)) continue;
      told.add(j.id);
      if (first) continue; // finished before she started: nothing new to report
      say(`Claude Code (${j.status}): ${j.result?.slice(0, 300)}`, 'info');
      window.mili?.react(() => stage.playClip(j.status === 'done' ? 'joyful_jump' : 'head_shake'));
      if (j.status === 'done') bridge.sendText(`[Claude Code finished "${j.task.slice(0, 80)}"] Tell me in one or two short Japanese sentences: ${j.mili ?? j.result.slice(0, 300)}`);
      else if (j.status === 'error') bridge.sendText(`[Claude Code failed] Tell me briefly in Japanese that it failed. Reason: ${j.result.slice(0, 200)}`);
    }
    first = false;
  }, 3000);
  window.addEventListener('wheel', (e) => { if (st.over && !st.drag) setScale(sc * (e.deltaY < 0 ? 1.06 : 1 / 1.06)); });
  ov.on('scale', setScale);
  let saved = NaN;
  try { saved = Number(localStorage.getItem('mili.scale')); } catch { /* not remembered */ }
  if (saved && saved !== 1) { await setScale(saved); ov.setPos(st.x, st.y); }
  else stage.setResolution(clamp(window.devicePixelRatio, 1, 2.5));

  ov.on('cursor', (p) => {
    if (Math.hypot(p.x - st.cursor.x, p.y - st.cursor.y) > 6) st.lastActive = performance.now();
    st.cursor = p;
    stage.pointer.x = clamp((p.x - (st.x + b.width / 2)) / 900, -1, 1);
    stage.pointer.y = clamp(-(p.y - (st.y + b.height - 544 * sc)) / 600, -1, 1);
  });
  ov.on('fg', (w) => (st.fg = w));
  ov.on('toggle-walk', () => { st.walk = !st.walk; ov.report({ walk: st.walk }); say(st.walk ? 'Walking again' : 'Staying put', 'info'); });
  ov.on('learn', () => fetch('/api/learn', { method: 'POST' }));

  // show what the file explorer is reading
  let reading = false;
  setInterval(async () => {
    const r = await fetch('/api/learn').then((x) => x.json()).catch(() => null);
    if (!r) return;
    if (r.running && stage.speech < 0.05) { stage.subtitle = `Reading ${r.current ?? 'files'}...`; reading = true; }
    else if (reading) { stage.subtitle = ''; reading = false; }
  }, 3000);

  // ---- movement primitives ----
  const pad = () => (b.width - 360 * sc) / 2; // empty room either side of her inside the window
  const walkTo = (x) => new Promise((ok) => { st.goal = clamp(x, area.x - 60 - pad(), area.x + area.width - b.width + 60 + pad()); st.arrive = ok; });
  const tweenY = (to, dur, ease = (t) => t) => new Promise((ok) => { st.tween = { from: st.y, to, t: 0, dur, ease, ok }; });

  // a window whose top edge leaves room for her to sit on it
  const perchWindow = () => {
    const w = st.fg;
    return w && !w.max && w.w >= 350 && w.y >= 360 * sc && w.y < area.y + area.height - 200 ? w : null;
  };

  async function perch(nap = false) {
    const win = perchWindow();
    // shortcut: no window handle, so the window is tracked by size; if it closes she sits on until the timer ends
    let anchor = win && Math.random() < 0.7 ? { ...win } : null;
    const edge = () => (anchor ? anchor.y : area.y + area.height);
    const seatY = () => edge() + SIT_DROP * sc - b.height + 6;
    const check = () => { if (st.dragged) throw aborted; }; // picked up: give up the rest of the behaviour
    await walkTo(anchor ? anchor.x + anchor.w * (0.25 + Math.random() * 0.5) - b.width / 2 : area.x + Math.random() * (area.width - b.width));
    check();
    const off = anchor ? st.x - anchor.x : 0;
    stage.playClip('hang', { hold: true }); // reaches up, then pulls herself onto the edge
    await tweenY(seatY(), 0.9, (t) => 1 - (1 - t) ** 3);
    check();
    await stage.playClip('sit_down', { hold: true });
    check();
    stage.playClip('sit', { loop: true });
    st.follow = anchor ? () => ({ x: anchor.x + off, y: seatY() }) : null;
    const start = performance.now();
    const until = start + (nap ? Infinity : (20 + Math.random() * 25) * 1000);
    while (performance.now() < until && !st.dragged && !(nap && st.lastActive > start)) {
      const w = st.fg;
      if (anchor && w && !w.max && Math.abs(w.w - anchor.w) < 40) anchor = { ...w };
      if (!stage.fx) { if (nap) stage.perform('sleepy', 6); else if (Math.random() < 0.04) stage.perform('yawn'); } // head and eyes only, the sit clip keeps the body
      await sleep(0.4);
    }
    check();
    st.follow = null;
    await stage.playClip('sit_up');
    await tweenY(floorY, 0.5, (t) => t * t);
    if (nap) { await stage.perform('yawn'); check(); await stage.perform('stretch'); }
  }

  // small reactions that do not need her to walk anywhere
  const dance = async () => { const n = DANCES[Math.floor(Math.random() * DANCES.length)]; await stage.playClip(n); if (Math.random() < 0.5) await stage.playClip(n); };
  const stretch = () => (Math.random() < 0.5 ? stage.perform('stretch') : stage.playClip('arm_stretch'));
  async function react(how) { // used for events (job finished, emotions); skipped while she is busy
    if (st.busy || st.drag || st.chat) return;
    st.busy = true; st.dragged = false;
    try { await how(); } catch (e) { if (e !== aborted) console.warn('react failed', e); }
    stage.stopClip(); st.busy = false; st.idle = 5 + Math.random() * 15;
  }

  async function lookAround() { await stage.playClip('idle_look'); }
  async function cheer() { await stage.playClip('wave_fast'); }

  async function act() {
    st.busy = true;
    st.dragged = false;
    try {
      await pick([
        [30, () => walkTo(area.x - 60 + Math.random() * (area.width - b.width + 120))],
        [10, lookAround], [18, perch], [5, cheer], [7, stretch], [5, () => stage.perform('yawn')], [5, () => stage.perform('earPerk')],
        [3, () => stage.perform('shy')], [7, dance], [4, () => stage.playClip('joyful_jump')], [4, () => stage.playClip('spin')],
        [2, () => stage.playClip('idle_dwarf')], [2, () => stage.playClip('cross_jumps')],
      ])();
    } catch (e) { if (e !== aborted) console.warn('overlay act failed', e); }
    stage.stopClip();
    st.busy = false;
    st.idle = 5 + Math.random() * 15;
  }

  // debug hook: window.mili.perch() from devtools forces a behaviour
  async function startNap() {
    st.busy = true; st.dragged = false;
    try { await perch(true); } catch (e) { if (e !== aborted) console.warn('nap failed', e); }
    stage.stopClip(); st.busy = false; st.idle = 5 + Math.random() * 15; st.lastActive = performance.now();
  }
  window.mili = { perch: () => { st.busy = true; return perch().finally(() => { st.busy = false; }); }, nap: startNap, lookAround, cheer, react, play: (n) => react(() => stage.playClip(n)), perform: (n) => react(() => stage.perform(n)), state: st };

  return (dt) => {
    if (st.drag) return; // the main process is moving the window under the cursor
    // keep moving whatever she is doing: tweens (climbing) and following a moving window
    if (st.tween) {
      const w = st.tween;
      w.t += dt;
      const k = Math.min(1, w.t / w.dur);
      st.y = w.from + (w.to - w.from) * w.ease(k);
      if (k >= 1) { st.tween = null; w.ok(); }
      ov.setPos(st.x, st.y);
    } else if (st.follow) {
      const p = st.follow();
      if (Math.abs(p.y - st.y) > 0.5 || Math.abs(p.x - st.x) > 0.5) { st.x = p.x; st.y = p.y; ov.setPos(st.x, st.y); }
    }

    // greet the cursor when it lingers near her
    const c = st.cursor, dx = c.x - (st.x + b.width / 2), dy = c.y - (st.y + b.height - 320 * sc);
    st.hover = Math.abs(dx) < 140 && Math.abs(dy) < 260 ? st.hover + dt : 0;
    if (st.hover > 1.5 && stage.t - st.lastGreet > 90 && !st.chat && !stage.action) { st.lastGreet = stage.t; stage.gesture('wave', 3); }

    const talking = stage.speech > 0.05 || st.chat;
    if (st.goal !== null) {
      if (!st.walk || talking) { stage.walkDir = 0; return; }
      const dir = Math.sign(st.goal - st.x);
      stage.walkDir = dir;
      stage.pose = 'relaxed';
      stage.poseT = 1;
      st.x += dir * SPEED * dt;
      ov.setPos(st.x, st.y);
      if (Math.abs(st.goal - st.x) < 3) { st.goal = null; stage.walkDir = 0; st.arrive?.(); }
      return;
    }
    stage.walkDir = 0;
    if (st.busy || !st.walk || talking) return;
    if (performance.now() - st.lastActive > st.napAfter) return void startNap();
    st.idle -= dt;
    if (st.idle <= 0) act();
  };
}
