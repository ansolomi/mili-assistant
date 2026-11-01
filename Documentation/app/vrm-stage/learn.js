// File explorer: reads text files from chosen folders, has the local model summarise them, and keeps
//   data/knowledge/notes.json       per-file summary + facts about the user
//   data/knowledge/digest.md        compact knowledge digest (injected into her system prompt by the brain)
//   data/knowledge/personality.md   evolving personality notes, rewritten after each pass
// Folders and limits live in data/knowledge/config.json (created on first run, edit freely).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MODEL = process.env.LEARN_MODEL ?? 'qwen3-vl:8b-instruct';
const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const TEXT = new Set(['.md', '.txt', '.py', '.js', '.ts', '.tsx', '.jsx', '.cs', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.html', '.css', '.yaml', '.yml', '.toml', '.csv', '.ps1', '.sh', '.ini']);
const SKIP_DIR = /^(node_modules|\.git|dist|build|__pycache__|\.venv|venv|edge-profile|recordings|models|downloads|logs|knowledge|vtuber-assistant|Open-LLM-VTuber|\.cache|AppData)$/i;
const SKIP_FILE = /(\.env|secret|password|passwd|token|credential|id_rsa|\.pem|\.key|\.pfx|wallet|seed|lock\.json|package-lock)/i; // never read anything that looks like a credential

export function makeLearner(dataDir) {
  const dir = path.join(dataDir, 'knowledge');
  const f = (n) => path.join(dir, n);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(f('config.json'))) {
    const home = os.homedir();
    fs.writeFileSync(f('config.json'), JSON.stringify({ roots: [path.join(home, 'Desktop'), path.join(home, 'Documents'), 'D:\\Projects'], filesPerPass: 10, maxBytes: 200000, maxDepth: 5 }, null, 2));
  }
  const read = (n, d) => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')); } catch { return d; } };
  const status = { running: false, current: null, lastRun: null, processed: 0, error: null };

  function* walk(root, depth, max) {
    let ents;
    try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP_DIR.test(e.name)) continue;
      const p = path.join(root, e.name);
      if (e.isDirectory()) { if (depth < max) yield* walk(p, depth + 1, max); }
      else if (TEXT.has(path.extname(e.name).toLowerCase()) && !SKIP_FILE.test(e.name)) yield p;
    }
  }

  async function ask(system, user) {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: 'POST',
      body: JSON.stringify({ model: MODEL, stream: false, format: 'json', options: { num_ctx: 8192, temperature: 0.3 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    return JSON.parse((await r.json()).message.content);
  }

  async function run() {
    if (status.running) return false;
    Object.assign(status, { running: true, error: null, processed: 0 });
    (async () => {
      try {
        const cfg = read('config.json', {});
        const notes = read('notes.json', {});
        const todo = [];
        for (const root of cfg.roots ?? []) {
          for (const p of walk(root, 0, cfg.maxDepth ?? 5)) {
            let st; try { st = fs.statSync(p); } catch { continue; }
            if (st.size < 40 || st.size > (cfg.maxBytes ?? 200000)) continue;
            if (notes[p]?.mtime === st.mtimeMs) continue;
            todo.push({ p, mtime: st.mtimeMs });
          }
        }
        todo.sort((a, b) => b.mtime - a.mtime); // newest first
        for (const { p, mtime } of todo.slice(0, cfg.filesPerPass ?? 10)) {
          status.current = path.basename(p);
          const text = fs.readFileSync(p, 'utf8').slice(0, 6000);
          try {
            const r = await ask(
              'You read one file from the user\'s computer. Reply with JSON {"summary": "2 sentences on what this file is", "facts": ["short facts about the user: name, projects, interests, tools, preferences, habits. Only what the file really shows. Empty list if none."]}',
              `Path: ${p}\n\n${text}`);
            notes[p] = { mtime, summary: String(r.summary ?? '').slice(0, 400), facts: (r.facts ?? []).map(String).slice(0, 6) };
          } catch (e) { notes[p] = { mtime, summary: '', facts: [], error: e.message }; }
          status.processed++;
          fs.writeFileSync(f('notes.json'), JSON.stringify(notes, null, 1));
        }
        status.current = 'her thoughts';
        await rebuild(notes, status.processed > 0);
        status.lastRun = new Date().toISOString();
      } catch (e) { status.error = e.message; }
      Object.assign(status, { running: false, current: null });
    })();
    return true;
  }

  async function rebuild(notes, learnedNew) {
    const entries = Object.entries(notes).filter(([, n]) => n.summary).sort((a, b) => b[1].mtime - a[1].mtime);
    const facts = [...new Set(entries.flatMap(([, n]) => n.facts).map((x) => x.trim()).filter(Boolean))].slice(0, 30);
    const lines = entries.slice(0, 20).map(([p, n]) => `- ${path.basename(p)} (${path.basename(path.dirname(p))}): ${n.summary}`);
    const digest = `${facts.length ? `Things you have learned about the user from their files:\n${facts.map((x) => `- ${x}`).join('\n')}\n\n` : ''}Files you have read recently:\n${lines.join('\n')}\n`;
    fs.writeFileSync(f('digest.md'), digest.slice(0, 3800));
    if (!learnedNew) return;
    const old = fs.existsSync(f('personality.md')) ? fs.readFileSync(f('personality.md'), 'utf8') : '';
    try {
      const r = await ask(
        'You maintain the evolving personality notes of Mili, a warm, curious desktop companion. Given her current notes and what she has newly learned about the user, rewrite the notes as JSON {"notes": ["at most 8 short bullets: interests she has grown, how she likes to talk to this user, small running jokes or things to ask about next"]}. Keep stable traits, add growth, never invent facts about the user.',
        `Current notes:\n${old || '(none yet)'}\n\nWhat she knows now:\n${digest.slice(0, 2500)}`);
      const notesList = (r.notes ?? []).map(String).slice(0, 8);
      if (notesList.length) fs.writeFileSync(f('personality.md'), notesList.map((x) => `- ${x}`).join('\n').slice(0, 1500));
    } catch { /* keep the old personality notes */ }
  }

  return { run, status: () => ({ ...status, notes: Object.keys(read('notes.json', {})).length }) };
}
