// Turns typed or spoken text into a PC command. Pure functions, no DOM, so `node src/commands.js` runs the self-check below.
// Ideas follow Capri Desktop (PolyForm Noncommercial 1.0.0); the code is written for Mili.
const UNITS = { s: 1, sec: 1, second: 1, m: 60, min: 60, minute: 60, h: 3600, hr: 3600, hour: 3600 };
const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };

// "in 10 minutes" / "at 5pm" / "at 17:30" / "tomorrow at 9" -> epoch ms, or null
export function parseWhen(s, now = new Date()) {
  const t = s.trim().toLowerCase();
  let m = /^in\s+(\d+|a|an|one|two|three|five|ten|fifteen|twenty|thirty)\s*(s|sec|seconds?|m|min|minutes?|h|hr|hours?)$/.exec(t);
  if (m) return now.getTime() + (NUM[m[1]] ?? Number(m[1])) * 1000 * UNITS[m[2].replace(/s$/, '')];
  m = /^(tomorrow\s+)?at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t) ?? /^(tomorrow)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(t);
  if (!m) return null;
  let h = Number(m[2]);
  const min = Number(m[3] ?? 0);
  if (m[4] === 'pm' && h < 12) h += 12;
  if (m[4] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (m[1]) d.setDate(d.getDate() + 1);
  else if (d <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

const WHEN = String.raw`(in\s+\w+\s*(?:s|sec|seconds?|m|min|minutes?|h|hr|hours?)|(?:tomorrow\s+)?at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|tomorrow\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)`;
const R = {
  remindA: new RegExp(`^remind me\\s+${WHEN}\\s+to\\s+(.+)$`, 'i'), // remind me in 10 minutes to stretch
  remindB: new RegExp(`^remind me\\s+(?:to\\s+)?(.+?)\\s+${WHEN}$`, 'i'), // remind me to stretch in 10 minutes
};
const SHORTCUTS = { screenshot: 'screenshot', 'screen shot': 'screenshot', 'game bar': 'gamebar', captions: 'captions', 'show desktop': 'desktop', 'task view': 'taskview' };

// -> { kind, ... } | null.  kinds: remind, reminders, forget-reminders, routine-save, routine-run, routines, routine-forget,
//    pc (a body for /api/pc), security, security-set, yes, no, stop, status
export function parse(text, routines = []) {
  const t = text.trim().replace(/[.!]+$/, '');
  let m;
  if (/^(yes|yeah|yep|sure|ok(ay)?|do it|go ahead|allow( it)?|はい)$/i.test(t)) return { kind: 'yes' };
  if (/^(no|nope|nah|don'?t|cancel|deny|いいえ)$/i.test(t)) return { kind: 'no' };
  if ((m = R.remindA.exec(t))) return { kind: 'remind', text: m[2], when: m[1] };
  if ((m = R.remindB.exec(t))) return { kind: 'remind', text: m[1], when: m[2] };
  if (/^(my )?reminders$|^what are my reminders$/i.test(t)) return { kind: 'reminders' };
  if (/^(clear|forget|cancel) (all )?(my )?reminders$/i.test(t)) return { kind: 'forget-reminders' };
  if ((m = /^(?:save )?routine\s+(.+?)\s*[:=]\s*(.+)$/i.exec(t))) return { kind: 'routine-save', name: m[1], steps: m[2] };
  if (/^(my )?routines$/i.test(t)) return { kind: 'routines' };
  if ((m = /^(?:forget|delete) routine\s+(.+)$/i.exec(t))) return { kind: 'routine-forget', name: m[1] };
  const flat = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  if ((m = /^(?:run|start|do)\s+(?:routine\s+)?(.+)$/i.exec(t)) && routines.some((r) => r.name === flat(m[1]))) return { kind: 'routine-run', name: flat(m[1]) };
  if (routines.some((r) => r.name === flat(t))) return { kind: 'routine-run', name: flat(t) };
  if (/^security$|^permissions$/i.test(t)) return { kind: 'security' };
  if ((m = /^(?:security|permissions?)\s+(lockdown|guarded|trusted|blackwall)$/i.exec(t)) || (m = /^(lockdown|blackwall) mode$/i.exec(t))) return { kind: 'security-set', preset: m[1].toLowerCase() };
  if ((m = /^(allow|don'?t allow|disallow)\s+(open|media|shortcuts?|windows?|power|mouse|sends?|extra|secrets?|wake)/i.exec(t))) {
    const idx = { open: 0, media: 1, shortcut: 2, window: 3, power: 4, mouse: 5, send: 6, extra: 8, secret: 9, wake: 10 }[m[2].toLowerCase().replace(/s$/, '')];
    return { kind: 'security-switch', index: idx, on: m[1].toLowerCase() === 'allow' };
  }
  if (/^(stop|cancel|abort|nevermind|never mind|stop (it|that|this|everything|working))$/i.test(t)) return { kind: 'stop' };
  if (/^(status|progress|what are you (doing|up to)|how'?s it going|are you (done|finished)( yet)?|what'?s taking so long)\??$/i.test(t)) return { kind: 'status' };
  // quick PC actions (each is gated by the server)
  if ((m = /^(?:open|launch|start)\s+(?!routine\b)(.+)$/i.exec(t))) return { kind: 'pc', body: { action: 'open', target: m[1].replace(/^(the|my)\s+/i, '') } };
  if ((m = /^go to\s+(\S+\.\S+)$/i.exec(t))) return { kind: 'pc', body: { action: 'open', target: m[1] } };
  if ((m = /^(play|pause|resume|next|skip|previous|mute|unmute)(?: (?:the )?(?:music|song|track|media|video))?$/i.exec(t))) {
    const w = m[1].toLowerCase();
    return { kind: 'pc', body: { action: 'media', what: { resume: 'play', skip: 'next', unmute: 'mute' }[w] ?? w } };
  }
  if ((m = /^(?:set )?(?:the )?volume (?:to )?(\d{1,3})\s*%?$/i.exec(t)) || (m = /^volume (\d{1,3})$/i.exec(t))) return { kind: 'pc', body: { action: 'volume', level: Number(m[1]) } };
  if (/^(louder|volume up|turn it up|turn up the volume)$/i.test(t)) return { kind: 'pc', body: { action: 'volume', dir: 'up' } };
  if (/^(quieter|volume down|turn it down|turn down the volume)$/i.test(t)) return { kind: 'pc', body: { action: 'volume', dir: 'down' } };
  if (SHORTCUTS[flat(t)] || (m = /^take a (screenshot|screen shot)$/i.exec(t))) return { kind: 'pc', body: { action: 'shortcut', name: SHORTCUTS[flat(m?.[1] ?? t)] } };
  if ((m = /^(?:switch to|focus|go to)\s+(.+)$/i.exec(t))) return { kind: 'pc', body: { action: 'window', what: 'switch', title: m[1] } };
  if ((m = /^close\s+(.+)$/i.exec(t))) return { kind: 'pc', body: { action: 'window', what: 'close', title: m[1] } };
  if (/^lock( the)?( pc| computer| screen)?$/i.test(t)) return { kind: 'pc', body: { action: 'power', what: 'lock' } };
  if ((m = /^(sleep|shut ?down|restart|reboot)( the)?( pc| computer)?$/i.exec(t))) return { kind: 'pc', body: { action: 'power', what: { 'shut down': 'shutdown', shutdown: 'shutdown', reboot: 'restart' }[m[1].toLowerCase()] ?? m[1].toLowerCase() } };
  if (/^cancel (the )?shut ?down$/i.test(t)) return { kind: 'pc', body: { action: 'power', what: 'cancel' } };
  return null;
}

// Paying never runs unasked: any job text that sounds like spending money needs a yes first.
export const paysWords = (s) => /\b(buy|purchase|pay|checkout|check out|order|book|subscribe|donate|transfer|top ?up|add to cart|place (an )?order)\b/i.test(s);

// "actually ..." / "instead ..." while a job runs: amend the task
export const amendment = (s) => /^(actually|instead|wait|no,? |rather|change (it|that)|make it)\b/i.test(s.trim());

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('commands.js')) {
  const assert = (await import('node:assert')).strict;
  const now = new Date(2026, 10, 2, 10, 0, 0);
  assert.equal(parseWhen('in 10 minutes', now), now.getTime() + 600000);
  assert.equal(parseWhen('in an hour', now), now.getTime() + 3600000);
  assert.equal(new Date(parseWhen('at 5pm', now)).getHours(), 17);
  assert.equal(new Date(parseWhen('at 9am', now)).getDate(), 3); // already past today -> tomorrow
  assert.equal(new Date(parseWhen('tomorrow at 7:30', now)).getMinutes(), 30);
  assert.equal(parse('remind me in 10 minutes to stretch').text, 'stretch');
  assert.equal(parse('remind me to call mum at 5pm').when, 'at 5pm');
  const r = [{ name: 'good night', steps: 'x' }];
  assert.equal(parse('good night!', r).kind, 'routine-run');
  assert.equal(parse('run routine good night', r).name, 'good night');
  assert.equal(parse('routine focus: open code; volume 20').steps, 'open code; volume 20');
  assert.deepEqual(parse('open spotify').body, { action: 'open', target: 'spotify' });
  assert.equal(parse('volume 30').body.level, 30);
  assert.equal(parse('security blackwall').preset, 'blackwall');
  assert.equal(parse('allow power').index, 4);
  assert.equal(parse('shut down').body.what, 'shutdown');
  assert.equal(parse('take a screenshot').body.name, 'screenshot');
  assert.equal(parse('yes').kind, 'yes');
  assert.equal(parse('how is the weather today'), null);
  assert.ok(paysWords('book a flight') && !paysWords('open a notebook'));
  console.log('commands ok');
}
