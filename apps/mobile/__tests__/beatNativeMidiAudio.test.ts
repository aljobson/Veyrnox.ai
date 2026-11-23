import { createBeatAudioFromEngine } from '../src/lib/beatNative/audio';
import { createBeat, setTrackGain, setTrackMute, setTrackPan, setTrackSolo, type BeatDoc } from '../src/lib/beatNative/doc';
import { addInstrumentTrack, addNote, midiRegions, type Instrument } from '../src/lib/beatNative/midi';
import type { BeatEngine, Run } from '../src/lib/beatNative/shared';
import { deferred, PROJECT } from './beatNativeFixtures';
const piano: Instrument = { engine: 'voice', id: 'piano', preset: 'grand' };
function setup(instrument = piano, tick = 0) {
    let doc = addInstrumentTrack(createBeat({ id: PROJECT }), instrument);
    const { track, region } = midiRegions(doc)[0];
    doc = addNote(doc, region.clipId, [tick, 1920, 60, 100]);
    let now = 0, fire = () => {};
    const voices: { run?: Run; release: jest.Mock; stop: jest.Mock }[] = [];
    const node = () => ({ gain: { value: 1 }, pan: { value: 0 }, connect: jest.fn() });
    const engine = {
        live: {}, context: { currentTime: 0, sampleRate: 44100, state: 'running', destination: {}, createGain: node, createStereoPanner: node, resume: async () => {}, close: async () => {} },
        now: () => now, resume: jest.fn(async () => {}), close: jest.fn(async () => {}), startRun: jest.fn(() => ({})),
        stopRun: jest.fn((run: Run) => voices.filter(v => v.run === run).forEach(v => v.stop(now))), setTrackMix: jest.fn(), playPad: jest.fn(), click: jest.fn(),
        playMidi: jest.fn((_track: unknown, _pitch: number, _velocity: number, _at: number, run?: Run) => {
            const voice = { run, release: jest.fn(), stop: jest.fn(), endTime: Infinity, ended: new Promise<void>(() => {}) }; voices.push(voice); return voice;
        }),
    };
    const audio = createBeatAudioFromEngine({ engine: engine as unknown as BeatEngine, setTimer: fn => { fire = fn; return 1; }, clearTimer: jest.fn() });
    return { audio, engine, voices, track, read: () => doc, edit: (op: (d: BeatDoc) => BeatDoc) => { doc = op(doc); }, advance: (t: number) => { now = t; fire(); } };
}
test('MIDI schedules at song offsets with release, on a cancellable transport run', async () => {
    const f = setup(piano, 60); await f.audio.play(f.read);
    const run = f.engine.startRun.mock.results[0].value;
    // N5: MIDI plays through the song's mix run (strips, effects, automation), not a bare run.
    expect(f.engine.startRun).toHaveBeenCalledWith(expect.objectContaining({ kind: 'veyrnox.music.beat' }), expect.objectContaining({ onError: expect.any(Function) }));
    const at = 0.1 + 60 * 60 / (92 * 960);
    expect(f.engine.playMidi).toHaveBeenCalledWith(expect.objectContaining({ instrument: piano }), 60, 100, at, run, 1);
    expect(f.voices[0].release).toHaveBeenCalledWith(at + 1920 * 60 / (92 * 960));
    expect(f.engine.playPad).toHaveBeenCalled(); f.audio.stop();
});
test('MIDI recording range exposes both clocks and schedules existing accompaniment through its mix run', async () => {
    const f = setup(piano, 0);
    const result = await f.audio.playRange!({ getDoc: f.read, startTick: 0, endTick: 3840, cycle: null,
        countInBars: 1, assetMode: 'all-supported', onWindow: () => {} });
    expect(f.audio.now!()).toBe(0);
    expect(result.contextStart).toBeCloseTo(0.1);
    expect(result.recordContextStart).toBeGreaterThan(result.contextStart);
    f.advance(result.recordContextStart);
    const run = f.engine.startRun.mock.results[0].value;
    expect(f.engine.playMidi).toHaveBeenCalledWith(expect.objectContaining({ id: f.track.id }), 60, 100, result.recordContextStart, run, 1);
    expect(f.voices[0].release).toHaveBeenCalledWith(result.recordContextStart + 1920 * 60 / (92 * 960));
    f.audio.stop(); expect(f.engine.stopRun).toHaveBeenCalledWith(run);
});
test.each(['mute', 'solo', 'gain', 'pan'])('%s updates an already sounding voice even with no new onset', async change => {
    const f = setup(); await f.audio.play(f.read); const run = f.engine.startRun.mock.results[0].value;
    f.engine.setTrackMix.mockClear(); const count = f.engine.playMidi.mock.calls.length;
    if (change === 'mute') f.edit(d => setTrackMute(d, f.track.id, true));
    if (change === 'solo') f.edit(d => setTrackSolo(d, d.tracks[0].id, true));
    if (change === 'gain') f.edit(d => setTrackGain(d, f.track.id, 0.3));
    if (change === 'pan') f.edit(d => setTrackPan(d, f.track.id, -0.5));
    f.advance(0.001);
    expect(f.engine.playMidi).toHaveBeenCalledTimes(count);
    expect(f.engine.setTrackMix).toHaveBeenCalledWith(run, f.track.id, change === 'mute' || change === 'solo' ? 0 : change === 'gain' ? 0.3 : 1, change === 'pan' ? -0.5 : 0);
    f.audio.stop();
});
test('setTrackMix synchronizes transport and live voices immediately; undo is read on tick', async () => {
    const f = setup(); await f.audio.play(f.read); const run = f.engine.startRun.mock.results[0].value;
    f.edit(d => setTrackMute(d, f.track.id, true)); f.audio.setTrackMix(f.track.id, { gain: 0, pan: 0.4 });
    expect(f.engine.setTrackMix).toHaveBeenCalledWith(run, f.track.id, 0, 0.4);
    expect(f.engine.setTrackMix).toHaveBeenCalledWith(f.engine.live, f.track.id, 0, 0.4);
    f.edit(d => setTrackMute(d, f.track.id, false)); f.advance(0.002);
    expect(f.engine.setTrackMix).toHaveBeenCalledWith(run, f.track.id, 1, 0); f.audio.stop();
});
test('Stop cancels queued MIDI drum onsets but leaves held keys playing; replay creates a fresh run', async () => {
    const f = setup({ engine: 'voice', id: 'drums', preset: '808' }, 60);
    await f.audio.noteOn('held', f.track, 36, 90); const key = f.voices[0];
    await f.audio.play(f.read); const run = f.engine.startRun.mock.results[0].value;
    const queued = f.voices[1]; expect(f.engine.playMidi.mock.calls[1][3]).toBeGreaterThan(0);
    f.audio.stop(); expect(f.engine.stopRun).toHaveBeenCalledWith(run); expect(queued.stop).toHaveBeenCalled();
    expect(key.stop).not.toHaveBeenCalled(); expect(key.release).not.toHaveBeenCalled();
    f.audio.noteOff('held'); expect(key.release).toHaveBeenCalledWith(0);
    await f.audio.play(f.read); expect(f.engine.startRun).toHaveBeenCalledTimes(2);
    expect(f.engine.startRun.mock.results[1].value).not.toBe(run); await f.audio.close();
});
test('muted tracks schedule no MIDI notes, keys ignore duplicates and invalid pitches, close releases keys', async () => {
    const f = setup(); f.edit(d => setTrackMute(d, f.track.id, true)); await f.audio.play(f.read);
    expect(f.engine.playMidi).not.toHaveBeenCalled();
    await f.audio.noteOn('a', f.track, 60, 72); await f.audio.noteOn('a', f.track, 62, 72);
    await f.audio.noteOn('bad', f.track, 109, 72); expect(f.engine.playMidi).toHaveBeenCalledTimes(1);
    expect(f.engine.playMidi).toHaveBeenCalledWith(expect.objectContaining({ instrument: piano }), 60, 72, 0, f.engine.live, 0);
    await f.audio.close(); expect(f.voices[0].release).toHaveBeenCalledWith(0); expect(f.engine.close).toHaveBeenCalled();
});
test.each([piano, { engine: 'voice', id: 'drums', preset: '808' } as Instrument])('auditions four notes on live with releases', async instrument => {
    const f = setup(); await f.audio.audition(instrument);
    expect(f.engine.playMidi.mock.calls.map(c => c[1])).toEqual(instrument.id === 'drums' ? [36, 38, 42, 46] : [48, 52, 55, 60]);
    f.voices.forEach((v, i) => { expect(v.run).toBe(f.engine.live); expect(v.release).toHaveBeenCalledWith(i * 0.18 + 0.25); });
});
test('stop or noteOff during resume cancels pending starts', async () => {
    const f = setup(), gate = deferred(); f.engine.resume.mockReturnValue(gate.promise);
    const playing = f.audio.play(f.read), key = f.audio.noteOn('key', f.track, 60, 100);
    f.audio.stop(); f.audio.noteOff('key'); gate.resolve(); await Promise.all([playing, key]);
    expect(f.engine.startRun).not.toHaveBeenCalled(); expect(f.engine.playMidi).not.toHaveBeenCalled();
});

test('swing delays odd steps once and releases at the region boundary', async () => {
    const f = setup(piano, 240), step = 60 / 92 / 4;
    f.edit(d => ({ ...d, swing: 0.5, tracks: d.tracks.map(track => track.id === f.track.id ? { ...track, regions: track.regions.map(region => ({ ...region, length: 480 })) } : track) }));
    await f.audio.play(f.read); expect(f.engine.playMidi).not.toHaveBeenCalled();
    f.advance(0.15);
    expect(f.engine.playMidi).toHaveBeenCalledTimes(1);
    expect(f.engine.playMidi.mock.calls[0][3]).toBeCloseTo(0.1 + step * 1.25);
    expect(f.voices[0].release.mock.calls[0][0]).toBeCloseTo(0.1 + step * 2);
    f.advance(1); expect(f.engine.playMidi).toHaveBeenCalledTimes(1); f.audio.stop();
});
