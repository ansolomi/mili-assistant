// Mili's eyes and hands on the screen: a screenshot goes to the local vision model only (Ollama), never to the internet.
//   look(question)     one answer about what is on screen
//   watch(condition)   check every 20 s and say when it is true (lookout)
//   along()            a short comment every ~45 s about what is on screen (watch-along)
//   gui(task)          a vision loop that clicks and types, gated by the Mouse switch, stopped by cancel()
//   find(words)        file finder over the learner's folders
// Ideas follow Capri Desktop (PolyForm Noncommercial 1.0.0); no Capri code is copied.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MODEL = process.env.EYES_MODEL ?? 'qwen3-vl:8b-instruct';
const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const SHOT_W = 1280;
const PAYS = /\b(buy|purchase|pay|checkout|check out|place order|confirm order|subscribe|donate|transfer|add to cart)\b/i;
const SKIP_DIR = /^(node_modules|\.git|dist|build|__pycache__|\.venv|venv|AppData|\$Recycle\.Bin)$/i;
const SKIP_FILE = /(\.env|secret|password|passwd|token|credential|id_rsa|\.pem|\.key|\.pfx|wallet)/i;

const ps = (script, env = {}) => new Promise((ok) => {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, ...env } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('error', (e) => ok({ ok: false, out: e.message }));
  p.on('close', (c) => ok({ ok: c === 0, out: out.trim() }));
});

const DPI = 'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;';
async function shot() { // -> base64 png, scaled to SHOT_W wide
  const f = path.join(os.tmpdir(), `mili-shot-${process.pid}.png`);
  const r = await ps(`${DPI} $b=[Windows.Forms.Screen]::PrimaryScreen.Bounds; $w=${SHOT_W}; $h=[int]($b.Height*$w/$b.Width);`
    + '$s=New-Object Drawing.Bitmap $b.Width,$b.Height; $g=[Drawing.Graphics]::FromImage($s); $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size);'
    + '$t=New-Object Drawing.Bitmap $s,$w,$h; $t.Save($env:MILI_F,[Drawing.Imaging.ImageFormat]::Png)', { MILI_F: f });
  if (!r.ok) throw new Error(`screenshot failed: ${r.out.slice(0, 120)}`);
  const b = fs.readFileSync(f).toString('base64');
  fs.rmSync(f, { force: true });
  return b;
}

async function vision(system, user, img, json = false) {
  const r = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', body: JSON.stringify({ model: MODEL, stream: false, ...(json ? { format: 'json' } : {}), options: { num_ctx: 8192, temperature: 0.2 },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user, images: [img] }] }) });
  if (!r.ok) throw new Error(`ollama ${r.status}`);
  return (await r.json()).message.content.trim();
}

const SENDKEYS = { enter: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', backspace: '{BACKSPACE}', delete: '{DELETE}', up: '{UP}', down: '{DOWN}', left: '{LEFT}', right: '{RIGHT}', home: '{HOME}', end: '{END}', pagedown: '{PGDN}', pageup: '{PGUP}', space: ' ' };
const escapeKeys = (t) => t.replace(/[+^%~(){}[\]]/g, '{$&}');
function keyCode(k) { // "ctrl+s", "enter"
  const parts = String(k).toLowerCase().split('+').map((x) => x.trim());
  const key = parts.pop();
  const mods = parts.map((m) => ({ ctrl: '^', control: '^', alt: '%', shift: '+' })[m] ?? '').join('');
  return mods + (SENDKEYS[key] ?? (key.length === 1 ? key : null) ?? '');
}

const MOUSE = 'Add-Type -Namespace M -Name U -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);\';';
const click = (x, y, n = 1, right = false) => ps(`${DPI}${MOUSE} $b=[Windows.Forms.Screen]::PrimaryScreen.Bounds; [M.U]::SetCursorPos([int]($b.Width*${x}/1000),[int]($b.Height*${y}/1000)); Start-Sleep -Milliseconds 120;`
  + `1..${n}|%{[M.U]::mouse_event(${right ? '8' : '2'},0,0,0,0);[M.U]::mouse_event(${right ? '16' : '4'},0,0,0,0);Start-Sleep -Milliseconds 60}`);
const scroll = (dy) => ps(`${MOUSE} [M.U]::mouse_event(0x800,0,0,${dy > 0 ? -360 : 360},0)`);
const send = (keys) => ps(`${DPI} [Windows.Forms.SendKeys]::SendWait($env:MILI_K)`, { MILI_K: keys });

const GUI_SYSTEM = 'You control a Windows PC by looking at screenshots. Coordinates are 0-1000 fractions of the screenshot width (x) and height (y). '
  + 'Reply with ONE JSON object: {"action":"click|double_click|right_click|type|key|scroll|wait|done|fail","x":0,"y":0,"text":"","dy":0,"reason":"short"}. '
  + 'click/double_click/right_click need x and y of the centre of the target. type needs text. key needs text like "enter" or "ctrl+s". scroll needs dy (positive = down). '
  + 'Use done when the task is finished and fail when it cannot be done. Do one small step at a time. Never enter passwords, card numbers or personal details unless the task text itself contains them.';

export function makeEyes({ say, pc, dataDir }) {
  let cancelled = false, guiJob = null, lookout = null, along = null;

  async function look(question) {
    const q = question || 'Describe what is on the screen in two short sentences.';
    return vision('You look at a screenshot of the user\'s screen and answer briefly in English. Never read out passwords or card numbers.', q, await shot());
  }

  function watch(condition, repeat = false) {
    clearInterval(lookout?.timer);
    const w = (lookout = { condition, repeat, busy: false });
    w.timer = setInterval(async () => {
      if (w.busy) return;
      w.busy = true;
      try {
        const a = await vision('Answer only YES or NO.', `Is this true right now on the screen: ${condition}?`, await shot());
        if (/^\s*yes/i.test(a)) { say(`I see it: ${condition}`, 'lookout'); if (!repeat) { clearInterval(w.timer); lookout = null; } }
      } catch { /* try again next tick */ }
      w.busy = false;
    }, 20000);
    return { ok: true, msg: `watching for: ${condition}` };
  }

  function watchAlong() {
    clearInterval(along?.timer);
    const memory = [];
    const w = (along = { busy: false });
    w.timer = setInterval(async () => {
      if (w.busy) return;
      w.busy = true;
      try {
        const a = await vision('You watch a video or stream together with the user. Say ONE short, friendly reaction (max 20 words) about what just happened. If nothing is playing or nothing changed, reply exactly: NONE',
          `Earlier you said: ${memory.slice(-3).join(' | ') || 'nothing yet'}. React to what is on screen now, without repeating yourself.`, await shot());
        if (a && !/^none/i.test(a)) { memory.push(a); say(a, 'along'); }
      } catch { /* skip this tick */ }
      w.busy = false;
    }, 45000);
    return { ok: true, msg: 'watching along' };
  }
  const stopWatching = () => { const n = (lookout ? 1 : 0) + (along ? 1 : 0); clearInterval(lookout?.timer); clearInterval(along?.timer); lookout = along = null; return n; };

  // ---- computer use: screenshot -> model picks one step -> do it -> repeat ----
  function gui(task) {
    return pc.gate(5, `Allow me to use the mouse and keyboard for: "${task.slice(0, 80)}"? (yes / no)`, () => startGui(task));
  }
  function startGui(task) {
    if (guiJob) return { ok: false, msg: 'a screen task is already running' };
    cancelled = false;
    const job = (guiJob = { task, step: 'starting', n: 0, waiting: null });
    (async () => {
      const history = [];
      let outcome = 'stopped';
      try {
        for (; job.n < 15 && !cancelled; job.n++) {
          const raw = await vision(GUI_SYSTEM, `Task: ${task}\nSteps so far: ${history.slice(-6).join('; ') || 'none'}\nWhat is the next single step?`, await shot(), true);
          let a;
          try { a = JSON.parse(raw); } catch { history.push('(unreadable reply)'); continue; }
          job.step = `${a.action} ${a.reason ?? ''}`.slice(0, 100);
          if (a.action === 'done') { outcome = `done: ${a.reason ?? ''}`; break; }
          if (a.action === 'fail') { outcome = `could not: ${a.reason ?? ''}`; break; }
          const key = JSON.stringify([a.action, a.x, a.y, a.text]);
          if (history.filter((h) => h === key).length >= 2) { outcome = 'stuck, I stopped'; break; }
          history.push(key);
          if (PAYS.test(`${a.reason ?? ''} ${a.text ?? ''}`)) { // paying is never automatic
            const ok = await new Promise((res) => { job.waiting = res; say('This step looks like a payment. Allow it? (yes / no)', 'ask'); setTimeout(() => res(false), 120000); });
            job.waiting = null;
            if (!ok) { outcome = 'stopped before a payment'; break; }
          }
          if (cancelled) break;
          const x = Math.min(1000, Math.max(0, Number(a.x) || 0)), y = Math.min(1000, Math.max(0, Number(a.y) || 0));
          if (a.action === 'click') await click(x, y);
          else if (a.action === 'double_click') await click(x, y, 2);
          else if (a.action === 'right_click') await click(x, y, 1, true);
          else if (a.action === 'type') await send(escapeKeys(String(a.text ?? '')));
          else if (a.action === 'key') { const k = keyCode(a.text); if (k) await send(k); }
          else if (a.action === 'scroll') await scroll(Number(a.dy) || 3);
          await new Promise((r) => setTimeout(r, 900));
        }
        if (cancelled) outcome = 'stopped';
        else if (job.n >= 15 && outcome === 'stopped') outcome = 'out of steps';
      } catch (e) { outcome = `error: ${e.message}`; }
      guiJob = null;
      say(`Screen task ${outcome}`, 'gui');
    })();
    return { ok: true, msg: 'on it, press Ctrl+Alt+C to stop me' };
  }
  const guiAnswer = (yes) => { if (guiJob?.waiting) { guiJob.waiting(yes); return true; } return false; };
  const cancel = () => { cancelled = true; guiAnswer(false); const n = (guiJob ? 1 : 0) + stopWatching(); return n; };

  // ---- file finder: names only, newest first, never credential-looking files ----
  function find(words, limit = 8) {
    const terms = String(words).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    let roots = [path.join(os.homedir(), 'Desktop'), path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Downloads'), 'D:\\Projects'];
    try { roots = JSON.parse(fs.readFileSync(path.join(dataDir, 'knowledge', 'config.json'), 'utf8')).roots.concat(roots[2]); } catch { /* defaults */ }
    const hits = [];
    const walk = (dir, depth) => {
      if (hits.length > 400) return;
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.') || SKIP_DIR.test(e.name)) continue;
        const p = path.join(dir, e.name), n = e.name.toLowerCase();
        if (e.isDirectory()) { if (depth < 6) walk(p, depth + 1); continue; }
        if (!SKIP_FILE.test(e.name) && terms.every((t) => n.includes(t))) { try { hits.push({ p, m: fs.statSync(p).mtimeMs }); } catch { /* vanished */ } }
      }
    };
    for (const r of roots) walk(r, 0);
    return hits.sort((a, b) => b.m - a.m).slice(0, limit).map((h) => h.p);
  }

  return { look, watch, watchAlong, stopWatching, gui, guiAnswer, cancel, find, status: () => ({ gui: guiJob && { task: guiJob.task, step: guiJob.step, n: guiJob.n }, lookout: lookout?.condition, along: !!along }) };
}
