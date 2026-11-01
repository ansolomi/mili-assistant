// Desktop overlay mode (?overlay=1 inside the Electron window): transparent stage that lives on the desktop.
// She walks along the taskbar, looks around, greets the cursor, perches on the taskbar edge or on the top edge of
// the foreground window (VRMA clips), reacts to clicks with a chat box, and shows what the file explorer is reading.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const sleep = (s) => new Promise((ok) => setTimeout(ok, s * 1000));
const SPEED = 60; // px per second
const PX_PER_M = 640 / 1.8; // window height over camera coverage
const SIT_DROP = 0.45 * PX_PER_M; // feet hang this far below the edge she sits on
const CLIPS = ['hang', 'sit_down', 'sit', 'sit_up', 'idle_look', 'wave_fast'];

export async function startOverlay({ stage, bridge, say }) {
  document.body.classList.add('overlay');
  const s = stage.settings;
  s.cameraCoverage = 1.8;
  s.subtitleY = 0.1;
  s.subtitleSize = 24;
  s.cameraCenterOffset = s.cameraCoverage / 2 - 0.03 - stage.headY; // feet at the bottom edge of the window
  stage.frameCamera();

  const ov = window.overlay && { ...window.overlay, setPos: (x, y) => Number.isFinite(x) && Number.isFinite(y) && window.overlay.setPos(x, y) }; // drop NaN positions instead of crashing the main process
  if (!ov) return () => {}; // opened in a normal browser: transparent look only
  await stage.loadClips(CLIPS);
  const b = await ov.bounds();
  const area = b.area;
  const floorY = area.y + area.height - b.height + 6;
  const st = { x: b.x, y: floorY, walk: true, chat: false, over: false, busy: false, goal: null, arrive: null, tween: null, follow: null, idle: 4, fg: null, cursor: { x: 0, y: 0 }, lastGreet: -99, hover: 0 };
  ov.setPos(st.x, st.y);

  const box = document.getElementById('ovChat');
  const setChat = (on) => {
    st.chat = on;
    box.style.display = on ? 'block' : 'none';
    if (on) { ov.focus(); setTimeout(() => box.focus(), 150); } else // the window takes focus asynchronously box.value = '';
    ov.ignore(!(on || st.over));
  };
  box.onkeydown = (e) => {
    if (e.key === 'Enter' && box.value.trim()) { say(box.value.trim(), 'me'); bridge.sendText(box.value.trim()); setChat(false); }
    if (e.key === 'Escape') setChat(false);
  };

  // the window is click-through except over her opaque pixels
  window.addEventListener('pointermove', (e) => {
    const r = stage.out.getBoundingClientRect();
    const px = Math.floor(((e.clientX - r.left) / r.width) * stage.W), py = Math.floor(((e.clientY - r.top) / r.height) * stage.H);
    const hit = px >= 0 && py >= 0 && px < stage.W && py < stage.H && stage.ctx.getImageData(px, py, 1, 1).data[3] > 20;
    if (hit !== st.over) { st.over = hit; if (!st.chat) ov.ignore(!hit); }
  });
  window.addEventListener('pointerdown', () => { if (st.over && !st.chat) setChat(true); });

  ov.on('cursor', (p) => {
    st.cursor = p;
    stage.pointer.x = clamp((p.x - (st.x + b.width / 2)) / 900, -1, 1);
    stage.pointer.y = clamp(-(p.y - (st.y + b.height * 0.2)) / 600, -1, 1);
  });
  ov.on('fg', (w) => (st.fg = w));
  ov.on('toggle-walk', () => { st.walk = !st.walk; say(st.walk ? 'Walking again' : 'Staying put', 'info'); });
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
  const walkTo = (x) => new Promise((ok) => { st.goal = clamp(x, area.x - 60, area.x + area.width - b.width + 60); st.arrive = ok; });
  const tweenY = (to, dur, ease = (t) => t) => new Promise((ok) => { st.tween = { from: st.y, to, t: 0, dur, ease, ok }; });

  // a window whose top edge leaves room for her to sit on it
  const perchWindow = () => {
    const w = st.fg;
    return w && !w.max && w.w >= 350 && w.y >= 360 && w.y < area.y + area.height - 200 ? w : null;
  };

  async function perch() {
    const win = perchWindow();
    // shortcut: no window handle, so the window is tracked by size; if it closes she sits on until the timer ends
    let anchor = win && Math.random() < 0.7 ? { ...win } : null;
    const edge = () => (anchor ? anchor.y : area.y + area.height);
    const seatY = () => edge() + SIT_DROP - b.height + 6;
    await walkTo(anchor ? anchor.x + anchor.w * (0.25 + Math.random() * 0.5) - b.width / 2 : area.x + Math.random() * (area.width - b.width));
    const off = anchor ? st.x - anchor.x : 0;
    stage.playClip('hang', { hold: true }); // reaches up, then pulls herself onto the edge
    await tweenY(seatY(), 0.9, (t) => 1 - (1 - t) ** 3);
    await stage.playClip('sit_down', { hold: true });
    stage.playClip('sit', { loop: true });
    st.follow = anchor ? () => ({ x: anchor.x + off, y: seatY() }) : null;
    const until = performance.now() + (20 + Math.random() * 25) * 1000;
    while (performance.now() < until) {
      const w = st.fg;
      if (anchor && w && !w.max && Math.abs(w.w - anchor.w) < 40) anchor = { ...w };
      await sleep(0.4);
    }
    st.follow = null;
    await stage.playClip('sit_up');
    await tweenY(floorY, 0.5, (t) => t * t);
  }

  async function lookAround() { await stage.playClip('idle_look'); }
  async function cheer() { await stage.playClip('wave_fast'); }

  async function act() {
    st.busy = true;
    try {
      const r = Math.random();
      if (r < 0.45) await walkTo(area.x - 60 + Math.random() * (area.width - b.width + 120));
      else if (r < 0.65) await lookAround();
      else if (r < 0.9) await perch();
      else await cheer();
    } catch (e) { console.warn('overlay act failed', e); }
    stage.stopClip();
    st.busy = false;
    st.idle = 5 + Math.random() * 15;
  }

  // debug hook: window.mili.perch() from devtools forces a behaviour
  window.mili = { perch: () => { st.busy = true; return perch().finally(() => { st.busy = false; }); }, lookAround, cheer, state: st };

  return (dt) => {
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
    const c = st.cursor, dx = c.x - (st.x + b.width / 2), dy = c.y - (st.y + b.height * 0.5);
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
    st.idle -= dt;
    if (st.idle <= 0) act();
  };
}
