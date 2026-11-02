// "Hey Milli": always-on listening that stays on this PC. The mic is cut into utterances by a small energy detector,
// each utterance is transcribed by the local speech model (POST /api/asr -> the brain's SenseVoice) and thrown away
// unless it starts with the wake phrase. Only text that follows the wake phrase reaches her brain.
// The speech model spells her name many ways ("Milie", "Mily", "Millie"), so the match is loose.
export const WAKE = /^\s*(?:hey|hay|hi|ok|okay|ヘイ|へい|ねえ|ねぇ)[\s,.!、。-]*m[iy]+l+[iey]{1,2}\b[\s,.!、。:-]*(.*)$/is;
export const WAKE_JP = /^\s*(?:ヘイ|へい|ねえ|ねぇ|おい)?[\s,、。]*(?:ミリ|ミーリ|ミリー|みり)[\s,、。!！]*(.*)$/s;

// text -> null (not for her) | '' (woken, nothing else said) | 'rest of the sentence'
export function wakeText(text) {
  const m = WAKE.exec(text) ?? WAKE_JP.exec(text);
  return m ? m[1].trim() : null;
}

// Cuts a stream of 16 kHz frames into utterances. push(Float32Array) returns a finished utterance (Float32Array) or null.
export function makeSegmenter({ rate = 16000, minSpeech = 0.35, maxSpeech = 6, hang = 0.7, floorStart = 0.01 } = {}) {
  let floor = floorStart, speech = [], inSpeech = false, quiet = 0, loud = 0, pre = [];
  return {
    get floor() { return floor; },
    push(frame) {
      let s = 0;
      for (const v of frame) s += v * v;
      const rms = Math.sqrt(s / frame.length), dur = frame.length / rate;
      const on = rms > Math.max(0.015, floor * 3);
      if (!inSpeech) {
        floor = floor * 0.98 + rms * 0.02; // learn the room's noise level while nothing is said
        pre.push(frame); if (pre.length > 3) pre.shift();
        loud = on ? loud + dur : 0;
        if (loud >= 0.08) { inSpeech = true; speech = [...pre]; quiet = 0; }
        return null;
      }
      speech.push(frame);
      quiet = on ? 0 : quiet + dur;
      const total = speech.reduce((n, f) => n + f.length, 0) / rate;
      if (quiet >= hang || total >= maxSpeech) {
        inSpeech = false; loud = 0; pre = [];
        const out = new Float32Array(speech.reduce((n, f) => n + f.length, 0));
        let o = 0; for (const f of speech) { out.set(f, o); o += f.length; }
        speech = [];
        return total - quiet >= minSpeech ? out : null;
      }
      return null;
    },
  };
}

// 16-bit mono PCM WAV with the 44-byte header the brain's /asr expects
export function wav(samples, rate = 16000) {
  const b = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const str = (o, t) => { for (let i = 0; i < t.length; i++) b.setUint8(o + i, t.charCodeAt(i)); };
  str(0, 'RIFF'); b.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVEfmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, 'data'); b.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return b.buffer;
}

// Opens the mic and calls onUtterance(Float32Array) for each spoken phrase. Returns { stop }.
export async function listen(onUtterance) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const code = 'registerProcessor("wake",class extends AudioWorkletProcessor{process(i){if(i[0][0])this.port.postMessage(i[0][0].slice());return true}})';
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  const node = new AudioWorkletNode(ctx, 'wake');
  const seg = makeSegmenter();
  node.port.onmessage = (e) => { const u = seg.push(e.data); if (u) onUtterance(u); };
  ctx.createMediaStreamSource(stream).connect(node);
  return { stop() { stream.getTracks().forEach((t) => t.stop()); ctx.close(); } };
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('wake.js')) {
  const assert = (await import('node:assert')).strict;
  for (const [t, r] of [['Hey, Milie, Vole 30.', 'Vole 30.'], ['Hey, Mily.', ''], ['hey milli volume thirty', 'volume thirty'], ['Hey Millie! open spotify', 'open spotify'], ['ヘイ、ミリ、音量を下げて', '音量を下げて'], ['Hey there, how is the weather?', null], ['I said hey to Mike', null], ['milli', null]])
    assert.equal(wakeText(t), r, t);
  const tone = (sec, amp) => Float32Array.from({ length: Math.round(16000 * sec) }, (_, i) => amp * Math.sin(i / 8));
  const seg = makeSegmenter();
  const feed = (a) => { let out = null; for (let i = 0; i + 320 <= a.length; i += 320) out = seg.push(a.subarray(i, i + 320)) ?? out; return out; };
  assert.equal(feed(tone(1, 0.001)), null); // room noise
  assert.equal(feed(tone(1, 0.3)), null); // still speaking
  const u = feed(tone(1, 0.001));
  assert.ok(u && u.length > 16000 * 0.9, 'utterance returned after the pause');
  assert.equal(feed(tone(0.15, 0.3)) ?? feed(tone(1, 0.001)), null); // a click is not speech
  assert.equal(wav(new Float32Array(10)).byteLength, 64);
  console.log('wake ok');
}
