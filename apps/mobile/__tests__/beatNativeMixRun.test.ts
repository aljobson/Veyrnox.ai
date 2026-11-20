import { createNativeBeatEngine, passThroughCompressor } from '../src/lib/beatNative/nativeContext';
import { createMixRun } from '../src/lib/beatNative/mixRun';
import { createBeatAudioFromEngine } from '../src/lib/beatNative/audio';
import { createBeat, addKitTrack, setTrackGain, stepSeconds, eventTime, type BeatDoc } from '../src/lib/beatNative/doc';
import { addEffect, setEffectParam, addAutomationPoint, setSend, setMaster, type MixDoc } from '../src/lib/beatNative/mix';
import type { Run } from '../src/lib/beatNative/shared';
import { mockAudioContextClass, createMockContext } from './helpers/mockNativeAudio';

type Param = { value: number; setValueAtTime: jest.Mock; linearRampToValueAtTime: jest.Mock; setTargetAtTime: jest.Mock };
type Node = { gain: Param; pan: Param; connect: jest.Mock; disconnect: jest.Mock };
type DetailedRun = Omit<Run, 'channels'> & { bus: Node; channels: Map<string, { input: Node; fader: Node; panner: Node; sends: Record<string, Node>; chain: { input: Node & { threshold: Param; ratio: Param } }[]; schedule: jest.Mock }> };
const make = () => createBeat({ id: '00000000-0000-4000-8000-000000000052' });
function build() {
    const { Ctor, state } = mockAudioContextClass();
    const { engine } = createNativeBeatEngine({ Context: Ctor });
    const start = jest.spyOn(engine, 'startRun'), stop = jest.spyOn(engine, 'stopRun');
    const run = () => start.mock.results.at(-1)!.value as DetailedRun;
    return { engine, context: state.last!.context, start, stop, run, mix: createMixRun(engine) };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('starts every track, returns strip input, updates gain live, and rebuilds topology/tempo/view', async () => {
    const b = build(); let doc = addKitTrack(make(), 'lofi');
    expect(b.mix.sync(doc)).toEqual({ restarted: true });
    expect([...b.run().channels.keys()]).toEqual(doc.tracks.map(t => t.id));
    const strip = b.run().channels.get('t1')!;
    expect(b.mix.destination('t1', doc, 0.1)).toBe(strip.input);
    doc = setTrackGain(doc, 't1', 0.4);
    expect(b.mix.sync(doc)).toEqual({ restarted: false });
    expect(strip.input.gain.setTargetAtTime).toHaveBeenCalledWith(0.4, 0, 0.01);
    doc = addEffect(doc, 't1', 'eq'); expect(b.mix.sync(doc).restarted).toBe(true);
    doc = { ...doc, tempo: { bpm: 120 } }; expect(b.mix.sync(doc).restarted).toBe(true);
    doc = { ...doc, view: 'pattern' } as MixDoc; expect(b.mix.sync(doc).restarted).toBe(true);
    b.mix.stop(); expect(b.stop).toHaveBeenCalledTimes(4); expect(b.mix.meterTap('t1')).toBeNull();
    await b.engine.close();
});
test('G2 drive changes rebuild a single-write shaper without throwing, including replacement docs', async () => {
    const b = build(); let doc = addEffect(make(), 't1', 'distortion');
    b.mix.sync(doc); const old = b.run();
    doc = setEffectParam(doc, 't1', 'f1', 'drive', 30);
    expect(() => b.mix.sync(doc)).not.toThrow(); expect(b.run()).not.toBe(old); expect(b.start).toHaveBeenCalledTimes(2);
    expect(b.mix.sync(doc).restarted).toBe(false);
    b.mix.sync(addEffect(make(), 't1', 'distortion')); expect(b.start).toHaveBeenCalledTimes(3);
    b.mix.stop(); await b.engine.close();
});
test('song automation writes straight-time fader ramps; pattern view does not', async () => {
    const b = build(); let doc = addAutomationPoint(make(), 't1', 'gain', 0, 0.2);
    doc = addAutomationPoint(doc, 't1', 'gain', 960, 0.8);
    b.mix.sync(doc); const param = b.run().channels.get('t1')!.fader.gain;
    b.mix.schedule(doc, 0, 0.1, 2);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.2, 2);
    expect(param.linearRampToValueAtTime).toHaveBeenCalledWith(expect.any(Number), 2.1);
    const pattern = { ...doc, view: 'pattern' } as MixDoc;
    b.mix.sync(pattern); const next = b.run().channels.get('t1')!.fader.gain;
    b.mix.schedule(pattern, 0, 0.1, 3); expect(next.setValueAtTime).not.toHaveBeenCalled();
    b.mix.stop(); await b.engine.close();
});
test('compressor live threshold/ratio updates use value-setting G1 parameters', async () => {
    const b = build(); let doc = addEffect(make(), 't1', 'compressor');
    b.mix.sync(doc); const compressor = b.run().channels.get('t1')!.chain[0].input;
    doc = setEffectParam(setEffectParam(doc, 't1', 'f1', 'threshold', -12), 't1', 'f1', 'ratio', 8);
    expect(() => b.mix.sync(doc)).not.toThrow(); expect(b.start).toHaveBeenCalledTimes(1);
    expect(compressor.threshold.value).toBe(-12); expect(compressor.ratio.value).toBe(8);
    b.mix.stop(); await b.engine.close();
});
test('all inert compressor automation methods set values and return their parameter', () => {
    const node = passThroughCompressor(createMockContext().context) as { threshold: Record<string, any> };
    const param = node.threshold;
    for (const method of ['setValueAtTime', 'setTargetAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime']) {
        expect(param[method](-18, 1, 0.01)).toBe(param); expect(param.value).toBe(-18);
    }
    expect(param.cancelScheduledValues(1)).toBe(param); expect(param.value).toBe(-18);
});
test('sends/master update live within topology, and meter taps follow the current run', async () => {
    const b = build(); let doc = setMaster(setSend(make(), 't1', 'delay', 0.2), { gain: 0.8 });
    b.mix.sync(doc); const tap = b.mix.meterTap('t1'); expect(tap).toBe(b.run().channels.get('t1')!.panner);
    expect(b.mix.meterTap('master')).toBeTruthy();
    doc = setMaster(setSend(doc, 't1', 'delay', 0.7), { gain: 0.6, delay: { feedback: 0.4 } });
    expect(b.mix.sync(doc).restarted).toBe(false);
    expect(b.run().channels.get('t1')!.sends.delay.gain.setTargetAtTime).toHaveBeenCalledWith(0.7, 0, 0.01);
    b.mix.stop(); await b.engine.close();
});

// Each case changes topology just before an already queued hit. Odd steps include swing.
test.each([0.005, 0.015, 0.020])('retains queued hits until actual swung onset + 30ms (lead %s)', async lead => {
    const b = build(); let fire = () => {}; const clear = jest.fn();
    let doc: BeatDoc = { ...make(), tempo: { bpm: 240 }, swing: 0.5 };
    doc = { ...doc, patterns: { ...doc.patterns, [doc.currentPattern]: { rows: { ...doc.patterns[doc.currentPattern].rows, snare: [], hat: [], kick: [[0, 100], [1, 100], [2, 100], [3, 100], [4, 100]] } } } };
    const played = jest.spyOn(b.engine, 'playPad');
    const audio = createBeatAudioFromEngine({ engine: b.engine, setTimer: fn => { fire = fn; return 1; }, clearTimer: clear });
    const steps: number[] = [];
    await audio.play(() => doc, step => steps.push(step));
    const old = b.run(), oldInput = old.channels.get('t1')!.input;
    const seconds = stepSeconds(doc.tempo.bpm);
    b.context.currentTime = 0.02; fire(); // queues odd step 1 into the original run
    const onset = eventTime(0.1 + seconds, 1, doc.tempo.bpm, doc.swing);
    expect(played.mock.calls.map(call => call[2])).toEqual([0.1, onset]);
    b.context.currentTime = onset - lead;
    doc = addEffect(doc, 't1', 'eq'); fire();
    const replacement = b.run(); expect(replacement).not.toBe(old);
    expect(b.stop).not.toHaveBeenCalled(); expect(old.bus.gain.linearRampToValueAtTime).not.toHaveBeenCalled();
    expect(played.mock.calls[0][3]).toBe(oldInput); expect(played.mock.calls[1][3]).toBe(oldInput);
    for (const call of played.mock.calls.slice(2)) expect(call[3]).toBe(replacement.channels.get('t1')!.input);
    b.context.currentTime = onset + 0.029; fire(); expect(b.stop).not.toHaveBeenCalled();
    b.context.currentTime = onset + 0.031; fire(); expect(b.stop).toHaveBeenCalledWith(old);
    expect(old.bus.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0, b.context.currentTime + 0.01);
    expect(new Set(steps).size).toBe(steps.length);
    const hits = played.mock.calls;
    expect(new Set(hits.map(c => c[2])).size).toBe(hits.length);
    hits.forEach((call, i) => expect(call[2]).toBeCloseTo(eventTime(0.1 + i * seconds, i, 240, 0.5)));
    audio.stop(); expect(audio.meterTap('t1')).toBeNull(); expect(clear).toHaveBeenCalled(); await audio.close();
});
test('an unused retired run stops on the next sync, and stop handles every pending run immediately', async () => {
    const b = build(), doc = make(); b.mix.sync(doc); const old = b.run();
    const fx = addEffect(doc, 't1', 'eq'); b.mix.sync(fx); expect(b.stop).not.toHaveBeenCalled();
    b.mix.sync(fx); expect(b.stop).toHaveBeenCalledWith(old);
    b.mix.destination('t1', fx, 100); b.mix.sync(addEffect(fx, 't1', 'delay'));
    b.mix.stop(); expect(b.stop).toHaveBeenCalledTimes(3); await b.engine.close();
});
test.each(['sync', 'destination', 'schedule', 'playPad'])('timer errors in %s stop all runs and notify once', async phase => {
    const b = build(); let fire = () => {};
    let doc = make(); const onError = jest.fn(), timer = jest.fn(fn => { fire = fn; return 1; });
    const audio = createBeatAudioFromEngine({ engine: b.engine, setTimer: timer, clearTimer: jest.fn() });
    await audio.play(() => doc, undefined, onError); const old = b.run();
    const error = new Error('engine failure');
    if (phase === 'sync') { doc = addEffect(doc, 't1', 'eq'); b.start.mockImplementationOnce(() => { throw error; }); }
    if (phase === 'destination') {
        const original = b.engine.setTrackMix.bind(b.engine); let calls = 0;
        jest.spyOn(b.engine, 'setTrackMix').mockImplementation((...args) => { if (++calls > 1) throw error; return original(...args); });
    }
    if (phase === 'schedule') old.channels.get('t1')!.schedule = jest.fn(() => { throw error; });
    if (phase === 'playPad') jest.spyOn(b.engine, 'playPad').mockImplementation(() => { throw error; });
    const scheduled = timer.mock.calls.length; b.context.currentTime = 0.3;
    expect(() => fire()).not.toThrow(); expect(audio.isPlaying()).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1); expect(onError).toHaveBeenCalledWith(error);
    expect(timer).toHaveBeenCalledTimes(scheduled); expect(b.stop).toHaveBeenCalledWith(old);
    await audio.close();
});
test('an effect the native context cannot build is reported once per run, never hidden', async () => {
    const b = build(); const onEffectError = jest.fn();
    const mix = createMixRun(b.engine, onEffectError);
    (b.context as unknown as Record<string, unknown>).createConvolver = () => { throw new Error('no convolver'); };
    let doc = addEffect(addEffect(make(), 't1', 'reverb'), 't1', 'reverb');
    expect(() => mix.sync(doc)).not.toThrow();
    expect(onEffectError).toHaveBeenCalledTimes(1);
    doc = addEffect(doc, 't1', 'eq'); mix.sync(doc);
    expect(onEffectError).toHaveBeenCalledTimes(2);
    mix.stop(); await b.engine.close();
});
test('a UI stop or close never throws when a run fails to release', async () => {
    const b = build(); const onError = jest.fn(), error = new Error('release failed');
    const audio = createBeatAudioFromEngine({ engine: b.engine, setTimer: jest.fn(() => 1), clearTimer: jest.fn() });
    await audio.play(() => make(), undefined, onError);
    b.stop.mockImplementation(() => { throw error; });
    expect(() => audio.stop()).not.toThrow();
    expect(audio.isPlaying()).toBe(false); expect(onError).toHaveBeenCalledWith(error);
    await audio.play(() => make(), undefined, onError);
    await expect(audio.close()).resolves.toBeUndefined();
});
