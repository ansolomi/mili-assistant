// Minimal static + API server: serves the built app (dist/), models and backgrounds from ../../data,
// persists settings, and saves recordings (WebM -> MP4 via ffmpeg when available).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeLearner } from './learn.js';
import { makeClaude } from './claude.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const data = path.resolve(here, '..', '..', 'data');
const port = Number(process.env.PORT ?? 8765);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.vrm': 'model/gltf-binary', '.vrma': 'model/gltf+json', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' };
const learner = makeLearner(data);
setTimeout(() => learner.run(), 60_000); // gentle background pass shortly after start, then hourly
setInterval(() => learner.run(), 3_600_000);
const vault = process.env.MILI_VAULT ?? "D:\\Projects\\Alvin's Vault";
const claude = makeClaude({ cwd: vault, addDir: path.dirname(vault), notes: path.join(vault, 'Mili jobs') });
const settingsFile = path.join(data, 'stage-settings.json');

const listDir = (sub, exts) => (fs.existsSync(path.join(data, sub)) ? fs.readdirSync(path.join(data, sub)).filter((f) => exts.includes(path.extname(f).toLowerCase())) : []);
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });

function serveFile(res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
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
}).listen(port, '127.0.0.1', () => console.log(`VRM stage on http://localhost:${port}`));
