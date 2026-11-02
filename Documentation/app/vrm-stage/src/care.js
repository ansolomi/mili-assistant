// Gentle self-care nudges, in the spirit of Capri Desktop's Care (PolyForm Noncommercial 1.0.0; ideas only).
// Time counts only while the user is around: more than AWAY of no input resets the working clock.
const AWAY = 10 * 60_000, GAP = 10 * 60_000;
const EVERY = { eyes: 30, stretch: 50, water: 70 }; // working minutes between nudges
export const LINES = {
  eyes: 'look away from the screen for twenty seconds',
  stretch: 'stand up and stretch for a minute',
  water: 'drink some water',
  late: 'it is very late, so go to sleep soon',
  meal: 'it is meal time, so eat something',
};

export function makeCare(now = () => Date.now()) {
  let worked = 0, last = now(), lastNudge = 0, off = false;
  const due = { eyes: EVERY.eyes, stretch: EVERY.stretch, water: EVERY.water }; // next working minute each is due
  const said = new Set(); // "late:<date>", "meal:<date>:<slot>"
  const day = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  // idleMs: time since the last input; returns a nudge kind or null
  function tick(idleMs) {
    const t = now(), d = new Date(t);
    if (idleMs > AWAY) { worked = 0; last = t; due.eyes = EVERY.eyes; due.stretch = EVERY.stretch; due.water = EVERY.water; return null; }
    worked += (t - last) / 60_000;
    last = t;
    if (off || t - lastNudge < GAP) return null;
    const h = d.getHours() + d.getMinutes() / 60;
    let kind = null;
    if ((h >= 23.5 || h < 4) && !said.has(`late:${day(d)}`)) { kind = 'late'; said.add(`late:${day(d)}`); }
    else if ((h >= 12 && h < 13.5) || (h >= 18.5 && h < 20)) {
      const k = `meal:${day(d)}:${h < 15 ? 'noon' : 'eve'}`;
      if (!said.has(k)) { kind = 'meal'; said.add(k); }
    }
    for (const n of Object.keys(EVERY)) if (!kind && worked >= due[n]) { kind = n; due[n] = worked + EVERY[n]; }
    if (kind) lastNudge = t;
    return kind;
  }
  return { tick, off: (v) => { off = v; } };
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('care.js')) {
  const assert = (await import('node:assert')).strict;
  let t = new Date(2026, 10, 2, 9, 0).getTime();
  const c = makeCare(() => t);
  const run = (min, idle = 0) => { const out = []; for (let i = 0; i < min; i++) { t += 60_000; const k = c.tick(idle); if (k) out.push(k); } return out; };
  assert.deepEqual(run(29), []);
  assert.deepEqual(run(1), ['eyes']);
  assert.deepEqual(run(20), ['stretch']); // 50 min
  assert.deepEqual(run(12, 11 * 60_000), []); // away: clock resets
  assert.deepEqual(run(29), []);
  t = new Date(2026, 10, 2, 23, 40).getTime();
  assert.equal(c.tick(0), 'late');
  assert.equal(c.tick(0), null);
  console.log('care ok');
}
