// Discord Rich Presence over the local IPC pipe (no packages, no network from us: the Discord app talks to its servers).
// Needs a Discord application ID of your own (discord.com/developers/applications, "New Application", name it Mili, copy the
// Application ID), saved with `discord id <number>` or in data/discord.json {"clientId": "..."}.
// Shows what she is doing ("Hanging out on your desktop", "Running a Claude Code job"...). Optional art: upload an image
// named "mili" under Rich Presence > Art Assets in the same application.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

export const frame = (op, obj) => { const j = Buffer.from(JSON.stringify(obj)); const h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(j.length, 4); return Buffer.concat([h, j]); };

export function makeDiscord(dataDir) {
  const file = path.join(dataDir, 'discord.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } };
  let cfg = read(), sock = null, ready = false, error = null, last = null, started = Date.now(), buf = Buffer.alloc(0);
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(cfg, null, 1)); } catch { /* kept in memory */ } };

  function connect(i = 0) {
    if (sock || !cfg.clientId || cfg.on === false) return;
    if (i > 9) { error = 'Discord is not running (no IPC pipe)'; return; }
    const s = net.connect(String.raw`\\?\pipe\discord-ipc-` + i);
    s.on('connect', () => { sock = s; error = null; s.write(frame(0, { v: 1, client_id: cfg.clientId })); });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
        const m = JSON.parse(buf.subarray(8, 8 + buf.readInt32LE(4)).toString() || '{}');
        buf = buf.subarray(8 + buf.readInt32LE(4));
        if (m.evt === 'READY') { ready = true; if (last) set(last); }
        if (m.evt === 'ERROR' || m.code) error = m.data?.message ?? m.message ?? 'Discord refused the application ID';
      }
    });
    s.on('error', () => { if (!sock) connect(i + 1); });
    s.on('close', () => { if (sock === s) { sock = null; ready = false; } });
  }
  function set(state) {
    last = state;
    if (!ready || !sock) return connect();
    sock.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: String(Date.now()), args: { pid: process.pid, activity: { details: 'Mili, desktop companion', state: String(state).slice(0, 120), timestamps: { start: Math.floor(started / 1000) }, assets: { large_image: 'mili', large_text: 'Mili' } } } }));
  }
  function stop() { try { sock?.write(frame(1, { cmd: 'SET_ACTIVITY', nonce: 'x', args: { pid: process.pid } })); sock?.end(); } catch { /* gone */ } sock = null; ready = false; }
  function config({ clientId, on }) {
    if (clientId !== undefined) { if (!/^\d{17,20}$/.test(String(clientId))) return false; cfg.clientId = String(clientId); }
    if (on !== undefined) cfg.on = !!on;
    save(); stop(); error = null; connect();
    return true;
  }
  connect();
  return { set, config, status: () => ({ configured: !!cfg.clientId, on: cfg.on !== false, connected: ready, error }) };
}

if (process.argv[1]?.endsWith('discord.js')) {
  const assert = (await import('node:assert')).strict;
  const f = frame(1, { a: 1 });
  assert.equal(f.readInt32LE(0), 1); assert.equal(f.readInt32LE(4), 7); assert.equal(f.subarray(8).toString(), '{"a":1}');
  console.log('discord ok');
}
