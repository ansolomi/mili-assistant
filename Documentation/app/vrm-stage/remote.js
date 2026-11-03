// Remote access over Tailscale: a random token (data/remote.json) in a cookie, and a short allowlist of what a phone may reach.
// Anything that controls the PC (/api/pc, /api/eyes, /api/claude, /api/say, uploads, security) is never reachable from here.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const TS = 'C:\\Program Files\\Tailscale\\tailscale.exe';
const loop = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
// `tailscale serve` (HTTPS) forwards from loopback but adds these headers, so those requests are remote too.
export const isLocal = (req) => loop(req.socket.remoteAddress) && !req.headers['x-forwarded-for'] && !req.headers['tailscale-user-login'];

const SAFE_API = new Set(['/api/models', '/api/animations', '/api/backgrounds']);
export const allowed = (p, method) => {
  if (p === '/client-ws') return true;
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (SAFE_API.has(p) || p === '/api/settings') return true;
  if (p.startsWith('/data/')) return /^\/data\/(models|backgrounds|animations)\//.test(p) && !p.includes('..');
  return !p.startsWith('/api/');
};

export function makeRemote(dataDir, port) {
  const file = path.join(dataDir, 'remote.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  if (!cfg.token) { cfg.token = crypto.randomBytes(16).toString('hex'); fs.writeFileSync(file, JSON.stringify(cfg)); }
  let ip = process.env.MILI_TS_IP ?? null, name = null;
  if (!ip) try { ip = execFileSync(TS, ['ip', '-4'], { encoding: 'utf8', timeout: 5000 }).trim().split(/\s+/)[0] || null; } catch { /* Tailscale not installed or signed out */ }
  try { name = JSON.parse(execFileSync(TS, ['status', '--json'], { encoding: 'utf8', timeout: 5000 })).Self?.DNSName?.replace(/\.$/, '') ?? null; } catch { /* no name yet */ }

  const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const cookie = (req) => /(?:^|;\s*)mili_t=([0-9a-f]+)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
  const authed = (req) => same(cookie(req), cfg.token);
  const hostOk = (h = '') => { const n = h.replace(/:\d+$/, ''); return n === ip || n.endsWith('.ts.net'); };

  // null = carry on, otherwise the response to send
  function gate(req, url, p) {
    if (!hostOk(req.headers.host)) return { code: 403, text: 'forbidden' };
    if (url.searchParams.get('t') && same(url.searchParams.get('t'), cfg.token)) { // first visit from the link: keep the token in a cookie, then drop it from the address
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return { code: 302, headers: { Location: p, 'Set-Cookie': `mili_t=${cfg.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure}` } };
    }
    if (!authed(req)) return { code: 401, text: 'Open the link from Mili (it carries the access token).' };
    if (!allowed(p, req.method)) return { code: 403, text: 'not available remotely' };
    return null;
  }
  return { gate, authed, ip, name, link: (base) => `${base}/?t=${cfg.token}` };
}

if (process.argv[1]?.endsWith('remote.js')) {
  const assert = (await import('node:assert')).strict;
  for (const [p, m, ok] of [['/', 'GET', true], ['/assets/x.js', 'GET', true], ['/client-ws', 'GET', true], ['/api/models', 'GET', true], ['/api/settings', 'GET', true], ['/api/settings', 'POST', false],
    ['/api/pc', 'POST', false], ['/api/eyes', 'POST', false], ['/api/claude', 'GET', false], ['/api/say', 'POST', false], ['/api/security', 'GET', false], ['/api/inbox', 'GET', false],
    ['/data/security.json', 'GET', false], ['/data/remote.json', 'GET', false], ['/data/models/a.vrm', 'GET', true], ['/data/models/../remote.json', 'GET', false], ['/api/upload', 'POST', false]])
    assert.equal(allowed(p, m), ok, `${m} ${p}`);
  assert.equal(isLocal({ socket: { remoteAddress: '127.0.0.1' }, headers: {} }), true);
  assert.equal(isLocal({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'tailscale-user-login': 'a' } }), false);
  assert.equal(isLocal({ socket: { remoteAddress: '100.1.2.3' }, headers: {} }), false);
  console.log('remote ok');
}
