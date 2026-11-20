// Spike B1 page: the real web beat engine (app/veyrnox/_lib/music/beat/beatEngine.js) in a bare page.
// It reports to the app over window.ReactNativeWebView.postMessage. Nothing here ships: see build-beat-spike.mjs.
import { createBeatEngine } from '../../../../app/veyrnox/_lib/music/beat/beatEngine.js';
import WORKLET_SOURCE from '../../../../public/audio-worklets/beat-capture-worklet.js';

const post = (o) => { try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch (e) { /* not in a web view */ } };
const $ = (id) => document.getElementById(id);
let engine = null, run = null, scheduler = null;
const BPM = 120, STEP = 60 / BPM / 4, LOOKAHEAD = 0.25, TICK_MS = 60;
// Eight tracks, the real voice code: drums (kit), bass, two synths, piano, organ (held), guitar, wavetable-free pad.
const TRACKS = [
  { id: 'd', instrument: { id: 'drums', preset: '808' }, kind: 'drums' },
  { id: 'b', instrument: { id: 'bass', preset: 'sub' } }, { id: 's1', instrument: { id: 'synth', preset: 'lead' } },
  { id: 's2', instrument: { id: 'synth', preset: 'pad' } }, { id: 'p', instrument: { id: 'piano', preset: 'grand' } },
  { id: 'o', instrument: { id: 'piano', preset: 'organ' } }, { id: 'g', instrument: { id: 'guitar', preset: 'steel' } },
  { id: 'e', instrument: { id: 'piano', preset: 'electric' } },
].map((t) => ({ gain: 0.5, pan: 0, ...t }));
const ROOTS = { b: 36, s1: 72, s2: 60, p: 60, o: 48, g: 52, e: 67 };

function ensure() {
  if (engine) return engine;
  engine = createBeatEngine();
  run = engine.startRun({ tracks: TRACKS.map((t) => ({ ...t, regions: [] })) }, {});
  return engine;
}

// Pad hit: schedule at engine.now(); a worklet probe finds the first non-zero frame leaving the master bus.
let probe = null, padBus = null;
async function installProbe() {
  if (probe || !engine.context.audioWorklet) return;
  // The processor reports the first frame above the floor after each 'arm' message. It listens to the pad bus only,
  // so the eight-track music playing on the master does not trip it.
  const code = `class P extends AudioWorkletProcessor{constructor(){super();this.armed=false;this.port.onmessage=()=>{this.armed=true;};}process(i){const c=i[0]&&i[0][0];if(c&&this.armed){for(let k=0;k<c.length;k++){if(Math.abs(c[k])>1e-4){this.armed=false;this.port.postMessage({frame:currentFrame+k,time:currentTime});break;}}}return true;}}registerProcessor('probe',P);`;
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  await engine.context.audioWorklet.addModule(url);
  const node = new AudioWorkletNode(engine.context, 'probe');
  padBus = engine.context.createGain(); padBus.connect(engine.master); padBus.connect(node); // node has no output
  node.port.onmessage = ({ data }) => { if (pending) finish(data); };
  probe = node;
}
let pending = null;
function finish(data) {
  const p = pending; pending = null;
  const ctx = engine.context;
  // When did that frame reach the context's render clock, in wall time? Compare with the hit's wall time.
  const rendered = (data.frame - p.frame0) / ctx.sampleRate; // seconds of audio clock between schedule and first sample
  const msg = { type: 'pad', source: p.source, jsMs: +(p.scheduledAt - p.hitAt).toFixed(2), graphMs: +(rendered * 1000).toFixed(1),
    baseMs: +(ctx.baseLatency * 1000).toFixed(1), outMs: ctx.outputLatency === undefined ? null : +(ctx.outputLatency * 1000).toFixed(1), nativeToPageMs: p.bridgeMs };
  post(msg); show(`pad ${p.source}: js ${msg.jsMs} ms, graph ${msg.graphMs} ms, base ${msg.baseMs}, out ${msg.outMs}`);
}
async function hit(source, nativeAt) {
  ensure(); await engine.resume(); await installProbe();
  const hitAt = performance.now();
  pending = { source, hitAt, bridgeMs: nativeAt ? Date.now() - nativeAt : null, frame0: Math.round(engine.context.currentTime * engine.context.sampleRate), scheduledAt: 0 };
  probe.port.postMessage('arm');
  engine.playPad('kick', 1, engine.now(), padBus, '808');
  pending.scheduledAt = performance.now();
  setTimeout(() => { if (pending) { pending = null; post({ type: 'note', text: 'probe saw nothing in 800 ms' }); } }, 800);
}

// Eight tracks for as long as asked, scheduled with a lookahead like the real scheduler does.
let nextStep = 0, stepAt = 0, startedAt = 0, notes = 0, underruns = 0, lastTime = 0, lastWall = 0;
function tick() {
  const ctx = engine.context;
  while (stepAt < ctx.currentTime + LOOKAHEAD) {
    const s = nextStep % 16, bar = Math.floor(nextStep / 16) % 4;
    if (s % 4 === 0 || s === 10) engine.playPad('kick', 0.9, stepAt, engine.master, '808'), notes++;
    if (s === 4 || s === 12) engine.playPad('snare', 0.8, stepAt, engine.master, '808'), notes++;
    if (s % 2 === 0) engine.playPad('hat', 0.5, stepAt, engine.master, '808'), notes++;
    const chord = [0, 5, 7, 3][bar];
    const play = (id, pitch, vel, len) => { const tr = TRACKS.find((t) => t.id === id); const v = engine.playMidi(tr, pitch, vel, stepAt, run, 0.5); notes++; if (v?.stop) v.stop(stepAt + len); };
    if (s % 4 === 0) play('b', ROOTS.b + chord, 100, STEP * 3);
    if (s % 2 === 1) play('s1', ROOTS.s1 + chord + [0, 4, 7, 12][(s >> 1) % 4], 70, STEP * 1.5);
    if (s === 0) { play('s2', ROOTS.s2 + chord, 70, STEP * 15); play('o', ROOTS.o + chord, 60, STEP * 15); }
    if (s % 8 === 0) { play('p', ROOTS.p + chord, 90, STEP * 6); play('p', ROOTS.p + chord + 7, 90, STEP * 6); }
    if (s % 4 === 2) play('g', ROOTS.g + chord, 80, STEP * 3);
    if (s % 4 === 3) play('e', ROOTS.e + chord, 70, STEP * 2);
    nextStep++; stepAt += STEP;
  }
  const wall = performance.now();
  if (lastWall && wall - lastWall > 400) underruns++; // the page's timer starved: a throttled or suspended web view
  lastWall = wall;
  const t = (wall - startedAt) / 1000;
  const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  if (Math.floor(t) !== lastTime) { lastTime = Math.floor(t); post({ type: 'beat', tracks: TRACKS.length, seconds: lastTime, notes, heapMb: heap, state: ctx.state, audioTime: +ctx.currentTime.toFixed(2), stalls: underruns, hidden: document.hidden }); show(`${TRACKS.length} tracks, ${lastTime}s, ${notes} notes, ctx ${ctx.state}, stalls ${underruns}`); }
}
async function start() {
  ensure(); await engine.resume();
  if (scheduler) return;
  stepAt = engine.now() + 0.1; nextStep = 0; startedAt = performance.now(); notes = 0; underruns = 0; lastWall = 0;
  scheduler = setInterval(tick, TICK_MS);
  document.addEventListener('visibilitychange', () => post({ type: 'visibility', hidden: document.hidden, ctx: engine.context.state, audioTime: engine.context.currentTime }));
  engine.context.onstatechange = () => post({ type: 'ctxstate', state: engine.context.state });
}
function stop() { if (scheduler) clearInterval(scheduler); scheduler = null; engine?.stopRun(run); run = engine?.startRun({ tracks: TRACKS.map((t) => ({ ...t, regions: [] })) }, {}); }

// Capability report: what ADR-0349 and the engine need from this web view.
async function capabilities() {
  const c = engine?.context;
  const out = { type: 'caps', ua: navigator.userAgent.slice(0, 90), secure: window.isSecureContext, origin: location.origin,
    audioContext: !!(window.AudioContext || window.webkitAudioContext), worklet: !!(c?.audioWorklet) || typeof AudioWorkletNode !== 'undefined',
    getUserMedia: !!navigator.mediaDevices?.getUserMedia, mediaRecorder: typeof MediaRecorder !== 'undefined', indexedDB: typeof indexedDB !== 'undefined',
    offline: typeof OfflineAudioContext !== 'undefined' || typeof webkitOfflineAudioContext !== 'undefined', sampleRate: c?.sampleRate ?? null,
    baseLatencyMs: c ? +(c.baseLatency * 1000).toFixed(1) : null, outputLatency: c && c.outputLatency !== undefined ? +(c.outputLatency * 1000).toFixed(1) : 'unsupported',
    permissionsPolicyMic: document.permissionsPolicy?.allowsFeature?.('microphone') ?? 'no api' };
  try { const est = await navigator.storage?.estimate?.(); out.storageQuotaMb = est ? Math.round(est.quota / 1048576) : null; } catch (e) { out.storageQuotaMb = null; }
  // The real capture worklet, loaded from a blob (the app page has no same-origin /audio-worklets path).
  try {
    ensure(); const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
    await engine.context.audioWorklet.addModule(url); new AudioWorkletNode(engine.context, 'beat-capture'); out.captureWorklet = 'loaded from blob';
  } catch (e) { out.captureWorklet = `failed: ${String(e.message || e).slice(0, 80)}`; }
  post(out); show(JSON.stringify(out, null, 1));
}
async function micProbe() {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }); s.getTracks().forEach((t) => t.stop()); post({ type: 'mic', ok: true }); show('mic: granted'); }
  catch (e) { post({ type: 'mic', ok: false, name: e.name }); show('mic: ' + e.name); }
}
function show(text) { const el = $('out'); if (el) el.textContent = text; }

window.__b1 = { hit: (nativeAt) => hit('native', nativeAt), start, stop, caps: capabilities, mic: micProbe };
document.addEventListener('DOMContentLoaded', () => {
  $('start').onclick = start; $('stop').onclick = stop; $('caps').onclick = capabilities; $('mic').onclick = micProbe;
  $('pad').addEventListener('pointerdown', () => hit('web'));
  window.addEventListener('error', (e) => post({ type: 'error', message: String(e.message || 'error').slice(0, 160) }));
  window.addEventListener('unhandledrejection', (e) => post({ type: 'error', message: String(e.reason?.message || e.reason).slice(0, 160) }));
  post({ type: 'ready' });
});
