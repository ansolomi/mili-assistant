// PC control for Mili, modelled on the ideas in Capri Desktop (lachydotmcg/capri-desktop, PolyForm Noncommercial 1.0.0): a permission
// gate with presets, reminders and routines, and quick actions (open, media, shortcuts, windows, power).
// Ideas only, no Capri code is copied. State lives in data/security.json and data/reminders.json.
//
// Gate: every action belongs to one switch. Switch on = she just does it, off = she asks first (the caller shows a yes/no).
// Paying is never automatic: switch 7 is always "ask", even in Blackwall (the user's choice).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const NAMES = ['Open apps and sites', 'Music, media and volume', 'Shortcuts', 'Windows', 'Power', 'Mouse and keyboard', 'Sends', 'Pays', 'Extra steps', 'Secrets', 'Wake word'];
export const PRESETS = { lockdown: 0, guarded: 3, trusted: 7, blackwall: 11 }; // number of switches on, from the top
export const PAYS = 7;
const OPEN = 0, MEDIA = 1, KEYS = 2, WINDOWS = 3, POWER = 4;

const run = (script, env = {}) => new Promise((ok) => {
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, env: { ...process.env, ...env } });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('error', (e) => ok({ ok: false, msg: e.message }));
  p.on('close', (c) => ok({ ok: c === 0, msg: out.trim().slice(0, 300) }));
});

const KEYS_CS = 'Add-Type -Namespace M -Name K -MemberDefinition \'[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, int f, int e);\';'
  + 'function Press($ks){ foreach($k in $ks){[M.K]::keybd_event($k,0,0,0)}; [array]::Reverse($ks); foreach($k in $ks){[M.K]::keybd_event($k,0,2,0)} };';
const VK = { screenshot: [0x5b, 0x10, 0x53], gamebar: [0x5b, 0x47], captions: [0x5b, 0x11, 0x4c], desktop: [0x5b, 0x44], taskview: [0x5b, 0x09], mute: [0xad], volup: [0xaf], voldown: [0xae], playpause: [0xb3], next: [0xb0], previous: [0xb1] };
const APPS = { calculator: 'calc', notepad: 'notepad', paint: 'mspaint', explorer: 'explorer', files: 'explorer', settings: 'ms-settings:', terminal: 'wt', cmd: 'cmd', chrome: 'chrome', edge: 'msedge', firefox: 'firefox', spotify: 'spotify', discord: 'discord', steam: 'steam', code: 'code', vscode: 'code', word: 'winword', excel: 'excel', powerpoint: 'powerpnt', obsidian: 'obsidian' };

export function makePc(dataDir, say) {
  const secFile = path.join(dataDir, 'security.json');
  const remFile = path.join(dataDir, 'reminders.json');
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const write = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v, null, 1)); } catch { /* kept in memory */ } };

  let sec = read(secFile, null) ?? { preset: 'blackwall', on: Array(11).fill(true) };
  sec.on[PAYS] = false;
  const asks = new Map(); // id -> () => Promise, waiting for a yes
  let askId = 0;

  const setPreset = (name) => {
    if (!(name in PRESETS)) return false;
    sec = { preset: name, on: NAMES.map((_, i) => i < PRESETS[name] && i !== PAYS) };
    write(secFile, sec);
    return true;
  };
  const setSwitch = (i, v) => { if (i === PAYS || !NAMES[i]) return false; sec.on[i] = !!v; sec.preset = 'custom'; write(secFile, sec); return true; };
  const security = () => ({ preset: sec.preset, switches: NAMES.map((n, i) => ({ name: n, on: sec.on[i], locked: i === PAYS })) });

  // ---- reminders and routines ----
  let store = read(remFile, { reminders: [], routines: [] });
  const save = () => write(remFile, store);
  const missed = store.reminders.filter((r) => !r.said && r.due <= Date.now()).length;
  let nextId = store.reminders.reduce((m, r) => Math.max(m, r.id), 0) + 1;
  const addReminder = (text, due) => { const r = { id: nextId++, text: String(text).slice(0, 200), due, said: false }; store.reminders.push(r); save(); return r; };
  const removeReminder = (id) => { const n = store.reminders.length; store.reminders = store.reminders.filter((r) => (id ? r.id !== id : r.said)); save(); return n - store.reminders.length; };
  const key = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const setRoutine = (name, steps) => { store.routines = store.routines.filter((r) => key(r.name) !== key(name)); if (steps) store.routines.push({ name: key(name), steps: String(steps).slice(0, 600) }); save(); };
  const tick = () => {
    for (const r of store.reminders) if (!r.said && r.due <= Date.now()) { r.said = true; say(`${r.text}${Date.now() - r.due > 120000 ? ' (it was due a while ago)' : ''}`, 'reminder'); }
    if (store.reminders.some((r) => r.said)) { store.reminders = store.reminders.filter((r) => !r.said || Date.now() - r.due < 60000); save(); }
  };
  setInterval(tick, 10000);
  setTimeout(() => { if (missed) say(`You have ${missed} reminder${missed > 1 ? 's' : ''} that came due while I was off.`); tick(); }, 15000);

  // ---- actions ----
  const target = (t) => {
    const s = String(t).trim();
    if (/^https?:\/\/\S+$/i.test(s)) return s;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`;
    return APPS[key(s)] ?? s;
  };
  const doAction = async (a) => {
    switch (a.action) {
      case 'open': {
        const t = target(a.target);
        if (/[\r\n|;&<>`$]/.test(t)) return { ok: false, msg: 'that name looks unsafe' };
        const r = await run('Start-Process -FilePath $env:MILI_T', { MILI_T: t });
        return { ...r, msg: r.ok ? `opened ${a.target}` : `couldn't open ${a.target}` };
      }
      case 'media': {
        const k = { play: 'playpause', pause: 'playpause', toggle: 'playpause', next: 'next', previous: 'previous', mute: 'mute' }[a.what];
        if (!k) return { ok: false, msg: 'unknown media command' };
        return run(`${KEYS_CS} Press @(${VK[k].join(',')})`);
      }
      case 'volume': {
        if (typeof a.level === 'number') { // 2 percent per step: drop to 0, then climb
          const n = Math.round(Math.min(100, Math.max(0, a.level)) / 2);
          return run(`${KEYS_CS} 1..50|%{Press @(${VK.voldown[0]})}; 1..${n}|%{Press @(${VK.volup[0]})}`);
        }
        const n = Math.min(25, Math.max(1, a.steps ?? 5));
        return run(`${KEYS_CS} 1..${n}|%{Press @(${VK[a.dir === 'down' ? 'voldown' : 'volup'][0]})}`);
      }
      case 'shortcut': return VK[a.name] ? run(`${KEYS_CS} Press @(${VK[a.name].join(',')})`) : { ok: false, msg: 'unknown shortcut' };
      case 'window': {
        const t = String(a.title ?? '').slice(0, 80);
        if (a.what === 'close') return run('$p=Get-Process|?{$_.MainWindowTitle -and $_.MainWindowTitle -like "*$env:MILI_T*"}; if(!$p){exit 1}; $p|%{[void]$_.CloseMainWindow()}', { MILI_T: t });
        return run('$ok=(New-Object -ComObject WScript.Shell).AppActivate($env:MILI_T); if(!$ok){exit 1}', { MILI_T: t });
      }
      case 'power': {
        const s = { lock: 'rundll32.exe user32.dll,LockWorkStation', sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0', shutdown: 'shutdown /s /t 60', restart: 'shutdown /r /t 60', cancel: 'shutdown /a' }[a.what];
        return s ? run(s) : { ok: false, msg: 'unknown power command' };
      }
    }
    return { ok: false, msg: 'unknown action' };
  };
  const switchOf = (a) => ({ open: OPEN, media: MEDIA, volume: MEDIA, shortcut: KEYS, window: WINDOWS, power: POWER })[a.action];
  const describe = (a) => ({ open: `open ${a.target}`, media: `${a.what} the media`, volume: 'change the volume', shortcut: `press ${a.name}`, window: `${a.what ?? 'switch to'} ${a.title}`, power: `${a.what} the PC` })[a.action] ?? a.action;

  // Run fn if switch `sw` is on (and `always` is false), else return a question that /api/pc/confirm answers.
  async function gate(sw, question, fn, always = false) {
    if (sec.on[sw] && !always) return fn();
    const id = ++askId;
    asks.set(id, fn);
    setTimeout(() => asks.delete(id), 120000);
    return { ask: question, id };
  }
  async function act(a) {
    const sw = switchOf(a);
    if (sw === undefined) return { ok: false, msg: 'unknown action' };
    return gate(sw, `Allow me to ${describe(a)}? (yes / no)`, () => doAction(a), a.action === 'power' && (a.what === 'shutdown' || a.what === 'restart')); // these ask whatever the preset
  }
  async function confirm(id, yes) {
    const f = asks.get(id);
    asks.delete(id);
    return f && yes ? f() : { ok: false, msg: f ? 'ok, cancelled' : 'that question expired' };
  }
  // The last unanswered question, for a bare "yes" or "no".
  const lastAsk = () => [...asks.keys()].pop() ?? 0;

  return { gate, security, setPreset, setSwitch, act, confirm, lastAsk, addReminder, removeReminder, setRoutine, state: () => ({ reminders: store.reminders.filter((r) => !r.said), routines: store.routines }) };
}
