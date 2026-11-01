// Runs Claude Code headless for Mili. Full permissions by request; base folder is the Obsidian vault, free to roam D:\Projects.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PROMPT = 'You are being driven by Mili, a desktop voice companion, from the user\'s Obsidian vault. Read CLAUDE.md in the vault first. '
  + 'Work in D:\\Projects as the task needs. End your final message with one line starting "MILI:" followed by at most two short Japanese sentences that say what you did.';

// `claude` on PATH, else the newest copy bundled with the Claude desktop app
function findExe() {
  const w = spawnSync('where', ['claude.exe'], { windowsHide: true, encoding: 'utf8' });
  if (w.status === 0) return w.stdout.split(/\r?\n/)[0];
  // the store version of the desktop app keeps its files under Packages\Claude_*\LocalCache, not in the real %APPDATA%
  const pk = path.join(process.env.LOCALAPPDATA ?? '', 'Packages');
  const roots = [path.join(process.env.APPDATA ?? '', 'Claude', 'claude-code')];
  if (fs.existsSync(pk)) for (const d of fs.readdirSync(pk)) if (d.startsWith('Claude_')) roots.push(path.join(pk, d, 'LocalCache', 'Roaming', 'Claude', 'claude-code'));
  const num = (v) => v.split('.').map(Number);
  const found = [];
  for (const root of roots.filter((r) => fs.existsSync(r))) for (const v of fs.readdirSync(root)) for (const h of fs.readdirSync(path.join(root, v))) { const f = path.join(root, v, h, 'claude.exe'); if (fs.existsSync(f)) found.push({ v: num(v), f }); }
  found.sort((a, b) => (b.v[0] - a.v[0]) || (b.v[1] - a.v[1]) || (b.v[2] - a.v[2]));
  return found[0]?.f ?? null;
}

export function makeClaude({ cwd, addDir, notes }) {
  const jobs = [];
  let session = null; // follow-ups ("now run the tests") resume the last finished job

  const view = (j) => ({ id: j.id, task: j.task, status: j.status, step: j.step, result: j.result, mili: j.mili, started: j.started, ended: j.ended, cost: j.cost });

  function start(task) {
    const exe = findExe();
    const j = { id: jobs.length + 1, task, status: 'running', step: 'starting', started: Date.now() };
    jobs.push(j);
    if (!exe) { Object.assign(j, { status: 'error', result: 'Claude Code was not found. Install it or the Claude desktop app.', ended: Date.now() }); return view(j); }
    const args = ['-p', task, '--output-format', 'stream-json', '--verbose', '--dangerously-skip-permissions', '--add-dir', addDir, '--append-system-prompt', PROMPT];
    if (session && !jobs.some((o) => o !== j && o.status === 'running')) args.push('--resume', session);
    const p = (j.proc = spawn(exe, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }));
    let buf = '', err = '';
    const onEvent = (e) => {
      if (e.type === 'assistant') for (const c of e.message?.content ?? []) if (c.type === 'tool_use') j.step = `${c.name} ${JSON.stringify(c.input).slice(0, 80)}`;
      if (e.type === 'result') { j.result = e.result; j.cost = e.total_cost_usd; j.error = e.is_error; if (!e.is_error) session = e.session_id; }
    };
    p.stdout.on('data', (d) => { buf += d; const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) try { onEvent(JSON.parse(l)); } catch { /* not json */ } });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { j.result = e.message; j.error = true; });
    p.on('close', () => {
      if (j.status === 'running') j.status = j.error || j.result === undefined ? 'error' : 'done';
      j.result ??= err.trim().slice(0, 400) || 'Claude Code exited without a result';
      j.mili = /^MILI:\s*(.+)$/m.exec(j.result)?.[1];
      j.ended = Date.now();
      delete j.proc;
      try { // every job leaves a note in the vault
        fs.mkdirSync(notes, { recursive: true });
        const stamp = new Date(j.started).toISOString().slice(0, 16).replace(/[:T]/g, '-');
        fs.writeFileSync(path.join(notes, `${stamp} job ${j.id}.md`), `# ${task}\n\n- status: ${j.status}\n- cost: ${j.cost ?? '?'} USD\n\n${j.result}\n`);
      } catch { /* the job result is still in memory */ }
    });
    return view(j);
  }

  function cancel(id) {
    let n = 0;
    for (const j of jobs) if (j.status === 'running' && (!id || j.id === id)) { j.status = 'cancelled'; spawnSync('taskkill', ['/pid', String(j.proc.pid), '/T', '/F'], { windowsHide: true }); n++; }
    return n;
  }

  return { start, cancel, list: () => jobs.map(view) };
}
