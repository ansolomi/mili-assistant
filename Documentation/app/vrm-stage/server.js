// Minimal static + API server: serves the built app (dist/), models and backgrounds from ../../data,
// persists settings, and saves recordings (WebM -> MP4 via ffmpeg when available).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeLearner } from './learn.js';
import { makeClaude } from './claude.js';
import { makePc, PRESETS } from './pc.js';
import { makeEyes } from './eyes.js';
import { makeDiscord } from './discord.js';
import { makeRemote, isLocal } from './remote.js';
import net from 'node:net';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const data = path.resolve(here, '..', '..', 'data');
const port = Number(process.env.PORT ?? 8765);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.vrm': 'model/gltf-binary', '.vrma': 'model/gltf+json', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const learner = makeLearner(data);
setTimeout(() => learner.run(), 60_000); // gentle background pass shortly after start, then hourly
setInterval(() => learner.run(), 3_600_000);
const vault = process.env.MILI_VAULT ?? "D:\\Projects\\Alvin's Vault";
const claude = makeClaude({ cwd: vault, addDir: path.dirname(vault), notes: path.join(vault, 'Mili jobs'), sessionFile: path.join(data, 'claude-session.json'), cloudFile: path.join(data, 'cloud-session.json') });
const inbox = []; // things other sessions asked her to say; the overlay drains it
const say = (text, kind) => inbox.push(kind ? { text, kind } : text); // kind tells the overlay how to voice it
const pc = makePc(data, say);
const discord = makeDiscord(data);
const eyes = makeEyes({ say, pc, dataDir: data });
const settingsFile = path.join(data, 'stage-settings.json');

const listDir = (sub, exts) => (fs.existsSync(path.join(data, sub)) ? fs.readdirSync(path.join(data, sub)).filter((f) => exts.includes(path.extname(f).toLowerCase())) : []);
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const remote = makeRemote(data, port);
const handle = async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  // /api/claude runs with full permissions: refuse requests from other websites and rebinding hosts.
  const self = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!isLocal(req)) { // a phone over Tailscale: token plus a short allowlist (remote.js)
    const r = remote.gate(req, url, p);
    if (r) { res.writeHead(r.code, r.headers); return res.end(r.text ?? ''); }
  } else if (!self.includes(req.headers.host) || (req.headers.origin && !self.some((s) => req.headers.origin === `http://${s}`))) { res.writeHead(403); return res.end('forbidden'); }
  if (p === '/api/models') return json(res, listDir('models', ['.vrm']));
  if (p === '/api/animations') return json(res, listDir('animations', ['.vrma']).map((f) => f.slice(0, -5)));
  if (p === '/api/backgrounds') return json(res, listDir('backgrounds', ['.png', '.jpg', '.jpeg', '.webp']));
  if (p === '/api/learn') return json(res, req.method === 'POST' ? { started: await learner.run() } : learner.status());
  if (p === '/api/claude') {
    if (req.method !== 'POST') return json(res, claude.list());
    let task;
    try { ({ task } = JSON.parse((await body(req)).toString() || '{}')); } catch { return json(res, { error: 'invalid JSON' }, 400); }
    return task ? json(res, claude.start(String(task))) : json(res, { error: 'task required' }, 400);
  }
  if ((p === '/api/upload' || p === '/api/image') && req.method === 'POST') { // attachment -> vault, so Claude jobs and Jarvis can Read it
    const images = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
    let name = '';
    try { name = decodeURIComponent(String(req.headers['x-filename'] ?? '')); } catch { /* bad header: fall back to the content type */ }
    const named = path.extname(name).slice(1).toLowerCase();
    const ext = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'docx', 'txt', 'md', 'csv', 'json'].includes(named) ? named : images[req.headers['content-type']];
    const buf = await body(req);
    if (!ext || !buf.length || buf.length > 15_000_000) return json(res, { error: 'png, jpeg, webp, gif, pdf, docx, txt, md, csv or json up to 15 MB' }, 400);
    const dir = path.join(vault, 'Inbox', ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext) ? 'images' : 'files');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const stem = path.basename(name, path.extname(name)).replace(/[^\w.-]+/g, '_').slice(0, 40); // no spaces, so the path survives in a message
    const file = path.join(dir, `${stamp}${stem ? '-' + stem : ''}.${ext}`);
    fs.writeFileSync(file, buf);
    return json(res, { path: file });
  }
  if (p === '/api/jarvis' && req.method === 'POST') { // hand a message to the Jarvis bridge (restricted tools, tiered)
    let message;
    try { ({ message } = JSON.parse((await body(req)).toString() || '{}')); } catch { return json(res, { error: 'invalid JSON' }, 400); }
    if (!message) return json(res, { error: 'message required' }, 400);
    try {
      const r = await fetch(process.env.JARVIS_URL ?? 'http://127.0.0.1:8787/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: String(message) }) });
      return json(res, await r.json(), r.status);
    } catch (e) { return json(res, { error: `Jarvis bridge not reachable: ${e.message}` }, 502); }
  }
  if (p === '/api/claude/session') return json(res, req.method === 'POST' ? { reset: claude.reset() ?? true } : { id: claude.session(), cwd: vault });
  if (p === '/api/cloud') {
    if (req.method !== 'POST') return json(res, { configured: !!claude.cloudId() });
    let task;
    try { ({ task } = JSON.parse((await body(req)).toString() || '{}')); } catch { return json(res, { error: 'invalid JSON' }, 400); }
    return task ? json(res, claude.cloud(String(task))) : json(res, { error: 'task required' }, 400);
  }
  if (p === '/api/say' && req.method === 'POST') { // localhost only (the server listens on 127.0.0.1)
    let text;
    try { ({ text } = JSON.parse((await body(req)).toString() || '{}')); } catch { return json(res, { error: 'invalid JSON' }, 400); }
    if (!text) return json(res, { error: 'text required' }, 400);
    inbox.push(String(text).slice(0, 500));
    return json(res, { queued: inbox.length });
  }
  if (p === '/api/security') { // GET the switches; POST {preset} or {switch, on}
    if (req.method === 'POST') {
      let b;
      try { b = JSON.parse((await body(req)).toString() || '{}'); } catch { return json(res, { error: 'invalid JSON' }, 400); }
      const ok = b.preset in PRESETS ? pc.setPreset(b.preset) : pc.setSwitch(Number(b.switch), b.on);
      if (!ok) return json(res, { error: 'unknown preset or locked switch' }, 400);
    }
    return json(res, pc.security());
  }
  if (p === '/api/pc' && req.method === 'POST') {
    let b;
    try { b = JSON.parse((await body(req)).toString() || '{}'); } catch { return json(res, { error: 'invalid JSON' }, 400); }
    return json(res, await pc.act(b));
  }
  if (p === '/api/pc/confirm' && req.method === 'POST') {
    let b;
    try { b = JSON.parse((await body(req)).toString() || '{}'); } catch { return json(res, { error: 'invalid JSON' }, 400); }
    return json(res, await pc.confirm(Number(b.id) || pc.lastAsk(), !!b.yes));
  }
  if (p === '/api/reminders') {
    if (req.method === 'POST') {
      let b;
      try { b = JSON.parse((await body(req)).toString() || '{}'); } catch { return json(res, { error: 'invalid JSON' }, 400); }
      if (b.text && b.due) pc.addReminder(b.text, Number(b.due));
      else if ('remove' in b) pc.removeReminder(Number(b.remove) || 0);
      else if (b.routine) pc.setRoutine(b.routine, b.steps);
      else return json(res, { error: 'text+due, remove, or routine+steps' }, 400);
    }
    return json(res, pc.state());
  }
  if (p === '/api/eyes' && req.method === 'POST') { // {op: look|watch|along|stop|gui|answer|find|status, ...}
    let b;
    try { b = JSON.parse((await body(req)).toString() || '{}'); } catch { return json(res, { error: 'invalid JSON' }, 400); }
    try {
      if (b.op === 'look') return json(res, { ok: true, msg: await eyes.look(b.question) });
      if (b.op === 'watch') return json(res, eyes.watch(String(b.condition ?? ''), !!b.repeat));
      if (b.op === 'along') return json(res, eyes.watchAlong());
      if (b.op === 'stop') return json(res, { stopped: eyes.cancel() });
      if (b.op === 'gui') return json(res, await eyes.gui(String(b.task ?? '')));
      if (b.op === 'answer') return json(res, { ok: eyes.guiAnswer(!!b.yes) });
      if (b.op === 'find') return json(res, { files: eyes.find(String(b.words ?? '')) });
      if (b.op === 'status') return json(res, eyes.status());
    } catch (e) { return json(res, { ok: false, msg: e.message }); }
    return json(res, { error: 'unknown op' }, 400);
  }
  if (p === '/api/asr' && req.method === 'POST') { // WAV in, text out, via the brain's local speech model (used by the wake word)
    const buf = await body(req);
    if (buf.length < 44 || buf.length > 2_000_000) return json(res, { error: 'wav up to 2 MB' }, 400);
    try {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: 'audio/wav' }), 'wake.wav');
      const r = await fetch(process.env.BRAIN_URL ?? 'http://127.0.0.1:12393/asr', { method: 'POST', body: fd });
      return json(res, await r.json(), r.status);
    } catch (e) { return json(res, { error: `speech model not reachable: ${e.message}` }, 502); }
  }
  if (p === '/api/discord') { // GET status; POST {clientId?, on?} to configure or {state} to update the presence line
    if (req.method === 'POST') {
      let b;
      try { b = JSON.parse((await body(req)).toString() || '{}'); } catch { return json(res, { error: 'invalid JSON' }, 400); }
      if (b.state) discord.set(b.state);
      else if (!discord.config(b)) return json(res, { error: 'the application ID is a 17 to 20 digit number' }, 400);
    }
    return json(res, discord.status());
  }
  if (p === '/api/inbox') return json(res, inbox.splice(0));
  if (p === '/api/claude/cancel' && req.method === 'POST') return json(res, { cancelled: claude.cancel(Number(url.searchParams.get('id')) || 0) });
  if (p === '/api/settings') {
    if (req.method === 'POST') { fs.writeFileSync(settingsFile, await body(req)); return json(res, { ok: true }); }
    return json(res, fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {});
  }
  if (p === '/api/recordings' && req.method === 'POST') {
    const dir = path.join(data, 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const webm = path.join(dir, `reel-${stamp}.webm`);
    fs.writeFileSync(webm, await body(req));
    const mp4 = webm.replace(/\.webm$/, '.mp4');
    const ff = spawn('ffmpeg', ['-y', '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', mp4], { stdio: 'ignore' });
    ff.on('error', () => json(res, { webm: path.basename(webm) }));
    ff.on('close', (code) => !res.writableEnded && json(res, code === 0 ? { webm: path.basename(webm), mp4: path.basename(mp4) } : { webm: path.basename(webm) }));
    return;
  }
  if (p.startsWith('/data/')) {
    const f = path.resolve(data, p.slice(6));
    return f.startsWith(data) ? serveFile(res, f) : (res.writeHead(403), res.end());
  }
  const f = path.resolve(dist, '.' + (p === '/' ? '/index.html' : p));
  return f.startsWith(dist) ? serveFile(res, f) : (res.writeHead(403), res.end());
};
// Phone chat: tunnel the brain's websocket for authenticated remote requests only (the brain itself stays on localhost).
const upgrade = (req, sock, head) => {
  if (isLocal(req) || !remote.authed(req) || new URL(req.url, 'http://x').pathname !== '/client-ws') return sock.destroy();
  const up = net.connect(Number(process.env.BRAIN_PORT ?? 12393), '127.0.0.1', () => {
    const h = Object.entries(req.headers).filter(([k]) => /^(upgrade|connection|sec-websocket-)/.test(k)).map(([k, v]) => `${k}: ${v}`);
    up.write(`GET /client-ws HTTP/1.1\r\nHost: 127.0.0.1\r\n${h.join('\r\n')}\r\n\r\n`);
    if (head.length) up.write(head);
    sock.pipe(up); up.pipe(sock);
  });
  up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
};
const listen = (host, msg) => { const s = http.createServer(handle); s.on('upgrade', upgrade); s.listen(port, host, () => console.log(msg)); return s; };
listen('127.0.0.1', `VRM stage on http://localhost:${port}`);
if (remote.ip) listen(remote.ip, `Phone link: http://${remote.ip}:${port}/?t=<token in data/remote.json>`); // Tailscale address only, never 0.0.0.0
