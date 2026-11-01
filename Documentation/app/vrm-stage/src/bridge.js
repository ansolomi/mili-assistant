import { EMOTION_BY_INDEX } from './stage.js';

const stripTags = (s) => (s ?? '').replace(/\[[a-z]+\]/gi, '').replace(/\s+/g, ' ').trim();

// WebSocket client for Open-LLM-VTuber (/client-ws) plus audio playback with a lip-sync analyser and push-to-talk.
export class Bridge {
  constructor(url, handlers = {}) {
    this.url = url;
    this.h = handlers;
    this.queue = [];
    this.playing = false;
    this.synthDone = false;
    this.source = null;
    this.retry = 0;
    this.ctx = new AudioContext();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.dest = this.ctx.createMediaStreamDestination(); // tapped by the recorder
    this.analyser.connect(this.ctx.destination);
    this.analyser.connect(this.dest);
    this.td = new Float32Array(this.analyser.fftSize);
    this.fd = new Uint8Array(this.analyser.frequencyBinCount);
  }

  connect() {
    this.h.onStatus?.('connecting');
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => { this.retry = 0; this.h.onStatus?.('connected'); };
    ws.onclose = () => {
      this.h.onStatus?.('disconnected');
      this.stopAudio();
      setTimeout(() => this.connect(), Math.min(10000, 1000 * 2 ** this.retry++));
    };
    ws.onmessage = (e) => { try { this.onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  }

  send(obj) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj)); }
  sendText(text) { this.resume(); this.send({ type: 'text-input', text }); }
  interrupt() { this.stopAudio(); this.send({ type: 'interrupt-signal', text: '' }); }
  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  onMessage(m) {
    switch (m.type) {
      case 'audio': this.queue.push(m); this.pump(); break;
      case 'synthesis-complete': this.synthDone = true; this.maybeFinish(); break;
      case 'user-input-transcription': this.h.onUserText?.(m.text); break;
      case 'full-text': this.h.onInfo?.(m.text); break;
      case 'control':
        if (m.text === 'interrupt') this.stopAudio();
        if (m.text === 'conversation-chain-start') { this.synthDone = false; this.h.onThinking?.(true); }
        if (m.text === 'conversation-chain-end') this.h.onThinking?.(false);
        break;
      case 'error': this.h.onInfo?.(`Error: ${m.message}`); break;
    }
  }

  async pump() {
    if (this.playing) return;
    const m = this.queue.shift();
    if (!m) return this.maybeFinish();
    this.playing = true;
    const text = stripTags(m.display_text?.text);
    const idx = m.actions?.expressions?.[0];
    this.h.onEmotion?.(typeof idx === 'number' ? EMOTION_BY_INDEX[idx] : idx);
    this.h.onSubtitle?.(text);
    if (text) this.h.onAiText?.(text);
    if (!m.audio) { setTimeout(() => this.finishClip(), 2200); return; }
    try {
      const bin = Uint8Array.from(atob(m.audio), (c) => c.charCodeAt(0));
      const buf = await this.ctx.decodeAudioData(bin.buffer);
      const src = (this.source = this.ctx.createBufferSource());
      src.buffer = buf;
      src.connect(this.analyser);
      src.onended = () => { if (this.source === src) this.finishClip(); };
      src.start();
    } catch (e) { console.error('audio decode', e); this.finishClip(); }
  }

  finishClip() { this.source = null; this.playing = false; this.pump(); }

  maybeFinish() {
    if (this.synthDone && !this.playing && !this.queue.length) {
      this.synthDone = false;
      this.send({ type: 'frontend-playback-complete' });
      setTimeout(() => this.h.onSubtitle?.(''), 1500);
    }
  }

  stopAudio() {
    this.queue = [];
    this.playing = false;
    try { this.source?.stop(); } catch { /* already stopped */ }
    this.source = null;
    this.h.onSubtitle?.('');
  }

  // Current voice level and spectral centroid for lip sync.
  voice() {
    this.analyser.getFloatTimeDomainData(this.td);
    let s = 0;
    for (const v of this.td) s += v * v;
    const level = Math.sqrt(s / this.td.length);
    this.analyser.getByteFrequencyData(this.fd);
    let num = 0, den = 0;
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    for (let i = 1; i < this.fd.length; i++) { num += i * hz * this.fd[i]; den += this.fd[i]; }
    return { level, centroid: den ? num / den : 0 };
  }

  // ---- push to talk: 16 kHz mono float chunks, like the stock web client ----
  async startMic() {
    if (this.mic) return;
    this.resume();
    this.stopAudio();
    this.send({ type: 'interrupt-signal', text: '' });
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const code = 'registerProcessor("cap",class extends AudioWorkletProcessor{process(i){if(i[0][0])this.port.postMessage(i[0][0].slice());return true}})';
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
    const node = new AudioWorkletNode(ctx, 'cap');
    let buf = [];
    node.port.onmessage = (e) => {
      buf.push(...e.data);
      if (buf.length >= 4096) { this.send({ type: 'mic-audio-data', audio: buf }); buf = []; }
    };
    ctx.createMediaStreamSource(stream).connect(node);
    this.mic = { stream, ctx, flush: () => { if (buf.length) this.send({ type: 'mic-audio-data', audio: buf }); buf = []; } };
    this.h.onMic?.(true);
  }

  stopMic() {
    const m = this.mic;
    if (!m) return;
    this.mic = null;
    m.flush();
    m.stream.getTracks().forEach((t) => t.stop());
    m.ctx.close();
    this.send({ type: 'mic-audio-end' });
    this.h.onMic?.(false);
  }
}
