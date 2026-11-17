import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationFrames, detectClickOnsets, matchCalibration, readLatency, writeLatency } from '../app/veyrnox/_lib/music/beat/beatLatency.mjs';
import { splitPasses } from '../app/veyrnox/_lib/music/beat/beatTakeCapture.mjs';
import { audioSegments, songWindowToContext } from '../app/veyrnox/_lib/music/beat/beatAudioSegments.mjs';
import { createBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { addAudioTrack, setTempo } from '../app/veyrnox/_lib/music/beat/beatOps.mjs';
import { commitRecording } from '../app/veyrnox/_lib/music/beat/beatTakeOps.mjs';
import { drainCapture } from '../app/veyrnox/_lib/music/beat/beatCapture.js';
import { createAudioRecording, takeAsset, maxLaneSeconds, recordingDurationLimit } from '../app/veyrnox/_lib/music/beat/beatAudioRecordingSession.js';
const sr = 48000;
function loopback(frames, delay, missing = [], stray = false, frequency = 2000) {
  const data = new Float32Array(Math.ceil(frames.at(-1) + delay + sr));
  for (let i = 0; i < data.length; i++) data[i] = 0.0002 * Math.sin(i * 0.918);
  for (const [index, at] of frames.entries()) {
    if (missing.includes(index)) continue;
    // The actual calibration waveform: a 2 kHz, 3 ms oscillator with fractional-frame delay.
    for (let i = Math.floor(at + delay); i < at + delay + 144; i++) {
      const x = i - at - delay; data[i] += x < 0 ? 0 : 0.5 * Math.sin(2 * Math.PI * frequency * x / sr);
    }
  }
  if (stray) data[Math.floor(sr * 0.1)] = 1;
  return data;
}
for (const ms of [5, 120, 380]) test(`calibration accepts ${ms} ms within 0.1 ms`, () => {
  const frames = calibrationFrames(sr), result = matchCalibration(detectClickOnsets(loopback(frames, ms * sr / 1000), sr), frames, sr);
  assert.equal(result.ok, true); assert.ok(Math.abs(result.ms - ms) < 0.1);
});
for (const ms of [700, 800, 950]) test(`calibration rejects ${ms} ms instead of aliasing`, () => {
  const frames = calibrationFrames(sr); assert.equal(matchCalibration(detectClickOnsets(loopback(frames, ms * sr / 1000), sr), frames, sr).ok, false);
});
test('missing first click is accepted; extra strong noise and too few detections are refused', () => {
  const frames = calibrationFrames(sr);
  assert.equal(matchCalibration(detectClickOnsets(loopback(frames, 5760, [0]), sr), frames, sr).ok, true);
  assert.equal(matchCalibration(detectClickOnsets(loopback(frames, 5760, [], true), sr), frames, sr).ok, false);
  assert.equal(matchCalibration(detectClickOnsets(loopback(frames, 5760, [0, 1, 2]), sr), frames, sr).ok, false);
});
test('non-integer loopback calibrates, splits, materializes and renders on grid within 1 ms', () => {
  const delay = 1789.4, scheduled = calibrationFrames(sr);
  const calibration = matchCalibration(detectClickOnsets(loopback(scheduled, delay), sr), scheduled, sr); assert.equal(calibration.ok, true);
  const samples = loopback([sr * 2], delay, [], false, 1000), chunks = [{ frame: 0, samples }];
  const passes = splitPasses(chunks, [{ fromSec: 0, toSec: 4, contextTime: 1 }], { sr, rtt: calibration.ms / 1000, groupStartSec: 0, groupEndSec: 4, cycle: false });
  const doc = commitRecording(addAudioTrack(setTempo(createBeat({ id: crypto.randomUUID(), now: 1 }), 120)), { trackId: 't2', start: 0, length: 7680, takes: [{ asset: takeAsset({ id: 'recorded', label: 'Take', samples: passes[0].samples, sampleRate: sr }) }] });
  const rendered = new Float32Array(sr * 4);
  for (const segment of audioSegments(doc, 0, 4)) {
    const offset = Math.round(segment.offsetSec * sr), start = Math.round(segment.songTimeSec * sr);
    for (let i = 0; i < Math.round(segment.durationSec * sr); i++) rendered[start + i] += passes[0].samples[offset + i] * segment.gain;
  }
  const click = detectClickOnsets(rendered, sr, sr)[0];
  assert.ok(Math.abs(click.frame / sr - 1) < 0.001, `offset ${Math.abs(click.frame / sr - 1) * 1000} ms`);
});
test('multiple equal cycle windows in one refill never collapse passes; count-in discarded', () => {
  const rate = 100, windows = songWindowToContext(0, 5, { startSec: -1, contextStart: 10, cycle: { start: 0, end: 1 } });
  const chunks = [{ frame: 1000, samples: Float32Array.from({ length: 500 }, (_, i) => i) }];
  const result = splitPasses(chunks, windows, { sr: rate, groupStartSec: 0, groupEndSec: 1 });
  assert.equal(result.length, 4); assert.deepEqual(result.map(p => p.samples[0]), [100, 200, 300, 400]);
  const hidden = songWindowToContext(0, 1.5, { startSec: 0, contextStart: 0, cycle: { start: 0, end: 1 } });
  assert.deepEqual(splitPasses([{ frame: 0, samples: new Float32Array(150) }], hidden, { sr: rate, groupStartSec: 0, groupEndSec: 1 }).map(p => p.samples.length), [100, 50]);
});
test('latency storage guards every access, devices and expiry', () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) };
  assert.equal(writeLatency('one', 12, storage, 100), true); assert.equal(readLatency('one', storage, 101).ms, 12);
  assert.equal(readLatency('two', storage, 101), null); assert.equal(readLatency('one', storage, 100 + 91 * 86400000), null);
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.equal(readLatency('one', denied), null); assert.equal(writeLatency('one', 12, denied), false);
});
test('finalization is idempotent and releases the lock with suspended context, preserving received audio', async () => {
  let doc = addAudioTrack(setTempo(createBeat({ id: crypto.randomUUID(), now: 1 }), 120)), receive, status;
  const context = { sampleRate: 100, currentTime: 2, state: 'suspended' };
  const capture = { context, ended: false, subscribe(fn) { receive = fn; return () => {}; }, flush() { throw Error('must not flush'); } };
  const rows = [];
  const session = createAudioRecording({ doc, trackId: 't2', range: { start: 0, length: 7680, cycle: false }, capture, rtt: 0.1, contextStart: 0, countIn: false,
    current: () => doc, edit(change) { doc = change(doc); return 'undo'; }, announce() {}, onState(s) { status = s.status; }, stop() {}, checkpointPersist: async () => {}, persist: async row => rows.push(row) });
  session.window({ fromSec: 0, toSec: 4, contextTime: 0 }); receive({ frame: 0, samples: new Float32Array(200).fill(0.25) });
  const first = session.finish(); assert.equal(session.finish(), first); await first;
  assert.equal(status, 'armed'); assert.ok(rows.length); assert.ok(doc.tracks[1].takeGroups.length);
});
test('suspension while waiting for a flush settles promptly', async () => {
  const context = { state: 'running', currentTime: 10 };
  const capture = { context, ended: false, flush() { context.state = 'suspended'; return new Promise(() => {}); } };
  const started = Date.now(); assert.equal(await drainCapture(capture, 1, 0), false); assert.ok(Date.now() - started < 500);
});

test('real static worklet averages stereo, preserves absolute frames and acknowledges the final partial batch', async () => {
  const { readFile } = await import('node:fs/promises'), { runInNewContext } = await import('node:vm');
  let Processor; const messages = [];
  const world = { currentFrame: 4096, Float32Array, AudioWorkletProcessor: class { port = { postMessage: message => messages.push(message) }; }, registerProcessor(name, processor) { assert.equal(name, 'beat-capture'); Processor = processor; } };
  runInNewContext(await readFile(new URL('../public/audio-worklets/beat-capture-worklet.js', import.meta.url), 'utf8'), world);
  const processor = new Processor();
  for (let block = 0; block < 33; block++) { world.currentFrame = 4096 + block * 128; processor.process([[new Float32Array(128).fill(0.25), new Float32Array(128).fill(0.75)]]); }
  assert.equal(messages.length, 1); assert.equal(messages[0].frame, 4096); assert.equal(messages[0].samples.length, 4096); assert.equal(messages[0].samples[4095], 0.5);
  processor.port.onmessage({ data: { type: 'flush', id: 9 } });
  assert.equal(messages[1].frame, 8192); assert.equal(messages[1].samples.length, 128); assert.equal(messages[2].type, 'flushed'); assert.equal(messages[2].id, 9);
});
test('suspension during final batch still persists, commits and releases the recording lock', async () => {
  let doc = addAudioTrack(setTempo(createBeat({ id: crypto.randomUUID(), now: 1 }), 120)), receive, status;
  const context = { sampleRate: 100, currentTime: 2, state: 'running' };
  const capture = { context, ended: false, subscribe(fn) { receive = fn; return () => {}; }, flush() { context.state = 'suspended'; return new Promise(() => {}); } };
  const rows = [];
  const session = createAudioRecording({ doc, trackId: 't2', range: { start: 0, length: 7680, cycle: false }, capture, rtt: 0, contextStart: 0, countIn: false,
    current: () => doc, edit(change) { doc = change(doc); return 'undo'; }, announce() {}, onState(s) { status = s.status; }, stop() {}, checkpointPersist: async () => {}, persist: async row => rows.push(row) });
  session.window({ fromSec: 0, toSec: 4, contextTime: 0 }); receive({ frame: 0, samples: new Float32Array(200).fill(0.25) });
  await session.finish(); assert.equal(status, 'armed'); assert.equal(rows.length, 1); assert.equal(doc.tracks[1].takeGroups.length, 1);
});
test('unexpected commit refusal retains durable rows and retry commits exactly once', async () => {
  let doc = addAudioTrack(setTempo(createBeat({ id: crypto.randomUUID(), now: 1 }), 120)), receive, refuse = true, edits = 0;
  const capture = { context: { sampleRate: 100, currentTime: 2, state: 'suspended' }, ended: false, subscribe(fn) { receive = fn; return () => {}; } };
  const rows = new Map();
  const session = createAudioRecording({ doc, trackId: 't2', range: { start: 0, length: 7680, cycle: false }, capture, rtt: 0, contextStart: 0, countIn: false,
    current: () => doc, edit(change) { if (refuse) return null; edits++; doc = change(doc); return 'undo'; }, announce() {}, onState() {}, stop() {}, persist: async row => rows.set(row.id, row) });
  session.window({ fromSec: 0, toSec: 4, contextTime: 0 }); receive({ frame: 0, samples: new Float32Array(200).fill(0.25) });
  await session.finish(); assert.equal(rows.size, 1); assert.match(session.error, /Try again/);
  refuse = false; await session.retry(); await session.retry(); assert.equal(edits, 1); assert.equal(doc.tracks[1].takeGroups[0].lanes.length, 1);
});

for (const sampleRate of [44100, 48000, 96000]) test(`capture stops at the mono WAV/song limit at ${sampleRate} Hz`, async () => {
  const maxSeconds = Math.min(600, Math.floor((60e6 - 44) / (2 * sampleRate)));
  assert.equal(maxLaneSeconds(sampleRate), maxSeconds);
  assert.ok(44 + maxSeconds * sampleRate * 2 <= 60e6);
  if (maxSeconds < 600) assert.ok(44 + (maxSeconds + 1) * sampleRate * 2 > 60e6);
  const doc = addAudioTrack(setTempo(createBeat({ id: crypto.randomUUID(), now: 1 }), 120));
  let receive, stops = 0; const messages = [];
  const capture = { context: { sampleRate, currentTime: maxSeconds + 10, state: 'suspended' }, subscribe(fn) { receive = fn; return () => {}; } };
  const session = createAudioRecording({ doc, trackId: 't2', range: { start: 0, length: 600 * 1920, cycle: false }, capture, rtt: 0.04, contextStart: 0, countIn: true,
    current: () => doc, edit() { assert.fail('No scheduler window: no take to commit'); }, announce: m => messages.push(m), onState() {}, stop() { stops++; }, persist: async () => {} });
  // Sparse messages exercise the real stop callback without allocating ten
  // minutes of silence. No windows means no materialization in this test.
  const last = Math.round((2 + 0.04 + maxSeconds) * sampleRate);
  receive({ frame: last - 2, samples: new Float32Array(1) }); assert.equal(stops, 0);
  receive({ frame: last - 1, samples: new Float32Array(2) }); assert.equal(stops, 1);
  assert.match(messages.at(-1), sampleRate === 96000 ? /60 MB upload limit/ : /Recording limit reached/);
  await session.finish();
  const range = { start: 0, length: 100 * 1920, cycle: true };
  assert.equal(recordingDurationLimit(range, 120, sampleRate, 8).seconds, 600, 'short cycle lanes may continue beyond one lane duration');
  assert.equal(recordingDurationLimit(range, 120, sampleRate, 3).seconds, 300, 'existing lanes reduce remaining passes');
  assert.equal(recordingDurationLimit({ ...range, maxSeconds: 15 }, 120, sampleRate, 8).seconds, 15, 'device storage may stop sooner');
});
for (const cycle of [false, true]) test(`96 kHz ${cycle ? 'cycle' : 'checkpointed single'} final block never materializes an oversized lane`, async () => {
  const sampleRate = 96000, limit = maxLaneSeconds(sampleRate), rows = [], messages = [];
  let doc = addAudioTrack(setTempo(createBeat({ id: crypto.randomUUID(), now: 1 }), 120)), receive, finish;
  const capture = { context: { sampleRate, currentTime: limit + 1, state: 'suspended' }, subscribe(fn) { receive = fn; return () => {}; } };
  const session = createAudioRecording({ doc, trackId: 't2', range: { start: 0, length: 313 * 1920, cycle }, capture, rtt: 0, contextStart: 0, countIn: false,
    current: () => doc, edit(change) { doc = change(doc); return true; }, announce: m => messages.push(m), onState() {}, stop() { finish = session.finish(); }, checkpointPersist: async () => {}, persist: async row => rows.push(row) });
  session.window({ fromSec: 0, toSec: 313, contextTime: 0 });
  // The final block straddles the size boundary. Earlier absent chunks are silence.
  receive({ frame: limit * sampleRate - 2, samples: new Float32Array([0.25, 0.5, 0.75, 1]) }); await finish;
  assert.equal(rows.length, 1);
  for (const row of rows) assert.equal(row.samples.length, limit * sampleRate);
  assert.equal(rows[0].samples.at(-1), 0.5); assert.ok(44 + rows[0].samples.length * 2 <= 60e6);
  assert.equal(doc.tracks[1].takeGroups[0].length, (cycle ? 313 : 312) * 1920, 'cycle keeps its range; single pass ends at the size limit');
  assert.equal(doc.tracks[1].regions[0].length, 312 * 1920, 'the absent remainder is silent, never looped');
  assert.match(messages.at(-2), /60 MB/);
});

test('partial 600 second take allocates only captured samples, and sparse gaps keep their clock', () => {
  const windows = [{ fromSec: 0, toSec: 600, contextTime: 0 }];
  const chunks = [{ frame: 0, samples: new Float32Array(48000).fill(1) }, { frame: 48128, samples: new Float32Array(128).fill(2) }];
  const [part] = splitPasses(chunks, windows, { sr, groupStartSec: 0, groupEndSec: 600, cycle: false });
  assert.equal(part.samples.length, 48256); assert.equal(part.samples[48000], 0); assert.equal(part.samples[48128], 2);
  const [compact] = splitPasses(chunks.slice(1), windows, { sr, groupStartSec: 0, groupEndSec: 600, compact: true });
  assert.equal(compact.offset, 48128); assert.equal(compact.samples.length, 128);
});
test('worklet flushes before an absent input block and stamps the next batch after the gap', async () => {
  const { readFile } = await import('node:fs/promises'), { runInNewContext } = await import('node:vm');
  let Processor; const messages = [];
  const world = { currentFrame: 0, Float32Array, AudioWorkletProcessor: class { port = { postMessage: m => messages.push(m) }; }, registerProcessor(name, p) { Processor = p; } };
  runInNewContext(await readFile(new URL('../public/audio-worklets/beat-capture-worklet.js', import.meta.url), 'utf8'), world);
  const processor = new Processor();
  processor.process([[new Float32Array(128).fill(1)]]); world.currentFrame = 128; processor.process([[]]);
  assert.equal(messages[0].frame, 0); assert.equal(messages[0].samples.length, 128);
  world.currentFrame = 256; processor.process([[new Float32Array(128).fill(2)]]); processor.send();
  assert.equal(messages[1].frame, 256); assert.equal(messages[1].samples[0], 2);
});
function recordingHarness(options = {}) {
  let doc = addAudioTrack(setTempo(createBeat({ id: crypto.randomUUID(), now: 1 }), 120)), receive, state, settled = 0, stops = 0;
  const capture = { context: { sampleRate: 100, currentTime: 30, state: 'suspended' }, subscribe(fn) { receive = fn; return () => {}; } };
  const session = createAudioRecording({ doc, trackId: 't2', range: { start: 0, length: 600 * 1920, cycle: false }, capture, rtt: 0, contextStart: 0, countIn: false,
    current: () => doc, edit(change) { doc = change(doc); return true; }, announce() {}, onState(s) { state = s; }, stop() { stops++; }, onSettled() { settled++; }, persist: async () => {}, checkpointPersist: async () => {}, ...options });
  session.window({ fromSec: 0, toSec: 600, contextTime: 0 });
  return { session, receive: chunk => receive(chunk), get state() { return state; }, get settled() { return settled; }, get stops() { return stops; } };
}
test('10 s checkpoints split/write only new audio, with offsets, and final materialization runs once', async () => {
  const chunks = [], final = [];
  const h = recordingHarness({ checkpointPersist: async (row, offset) => chunks.push({ row, offset }), persist: async row => final.push(row) });
  for (let i = 0; i < 3; i++) h.receive({ frame: i * 1000, samples: new Float32Array(1000).fill(i + 1) });
  await h.session.finish();
  assert.deepEqual(chunks.map(c => [c.offset, c.row.samples.length]), [[0, 1000], [1000, 1000], [2000, 1000]]);
  assert.equal(final.length, 1); assert.equal(final[0].samples.length, 3000); assert.equal(final[0].samples[2000], 3);
});
test('checkpoint exceptions surface a failure and stop; empty commit clears failure and settles', async () => {
  const h = recordingHarness();
  assert.doesNotThrow(() => h.receive({ frame: 0, get samples() { throw Error('checkpoint failed'); } }));
  assert.equal(h.session.error, 'checkpoint failed'); assert.equal(h.stops, 1);
  await h.session.finish(); assert.equal(h.session.error, ''); assert.equal(h.settled, 1); assert.equal(h.state.status, 'armed');
});
test('async checkpoint rejection stops capture and successful final persistence clears it', async () => {
  const h = recordingHarness({ checkpointPersist: async () => { throw Error('disk failed'); } });
  h.receive({ frame: 0, samples: new Float32Array(1000) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.session.error, 'disk failed'); assert.equal(h.stops, 1);
  await h.session.finish(); assert.equal(h.session.error, ''); assert.equal(h.settled, 1);
});
test('discard after a failed commit retires durable take ids and clears pending failure', async () => {
  let ids; const h = recordingHarness({ edit: () => false, discard: async values => { ids = values; } });
  h.receive({ frame: 0, samples: new Float32Array(200) }); await h.session.finish();
  assert.match(h.session.error, /Try again/);
  await h.session.discard(); assert.equal(ids.length, 1); assert.equal(h.session.error, ''); assert.equal(h.settled, 1); assert.equal(h.state.error, '');
});

test('a failed checkpoint prevents later queued prefixes from hiding unsaved audio at commit', async () => {
  const store = await import('../app/veyrnox/_lib/music/beat/beatTakeStore.js');
  const { memoryBeatTakeStorage } = await import('./musicBeatTakeStorageFixture.mjs');
  const { adapter } = memoryBeatTakeStorage(); let attempts = 0;
  const putChunk = adapter.putChunk; adapter.putChunk = async chunk => (++attempts === 2 ? false : putChunk(chunk));
  store.configureBeatTakeStorage(adapter);
  const h = recordingHarness({ persist: store.putBeatTake, checkpointPersist: store.appendBeatTake });
  for (let i = 0; i < 3; i++) h.receive({ frame: i * 1000, samples: new Float32Array(1000).fill(i + 1) });
  await h.session.finish(); assert.equal(h.session.error, '');
  store.configureBeatTakeStorage(adapter); await store.hydrateBeatTakes();
  const row = await store.loadBeatTake(store.beatTakes()[0].id);
  assert.equal(row.samples.length, 3000); assert.equal(row.samples[0], 1); assert.equal(row.samples[1000], 2); assert.equal(row.samples[2000], 3);
});
