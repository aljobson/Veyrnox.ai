import { createBeatAudioFromEngine } from '../src/lib/beatNative/audio';
import { createNativeBeatEngine } from '../src/lib/beatNative/nativeContext';
import { addAutomationPoint, addEffect } from '../src/lib/beatNative/mix';
import { createBeat, type BeatAsset, type BeatDoc } from '../src/lib/beatNative/doc';
import { createTakePlayback } from '../src/lib/beatNative/takePlayback';
import { addAudioTrack, commitRecording, takeAsset } from '../src/lib/beatNative/takeShared';
import { fixedDoc } from './beatNativeFixtures';
import { fakeContext, takeRow } from './beatNativeTakeFixtures';
import { mockAudioContextClass } from './helpers/mockNativeAudio';

jest.mock('../src/lib/beatNative/takeShared', () => ({ ...jest.requireActual('../src/lib/beatNative/takeShared'), configureNativeTakeStorage: jest.fn() }));

const make = () => createBeat({ id: '00000000-0000-4000-8000-000000000053' });
function build(options: { assets?: { load: jest.Mock }; onAssetError?: jest.Mock } = {}) {
    const { Ctor } = mockAudioContextClass();
    const { engine } = createNativeBeatEngine({ Context: Ctor });
    const start = jest.spyOn(engine, 'startRun');
    const pad = jest.spyOn(engine, 'playPad').mockImplementation(() => undefined as never);
    return { engine, start, pad, audio: createBeatAudioFromEngine({ engine, ...options }) };
}
function withSong(doc: BeatDoc): BeatDoc {
    const added = addAudioTrack(doc), track = added.tracks.at(-1)!;
    const asset: BeatAsset = { source: 'song', ref: { songId: '1', versionId: '2', jobId: '3' }, name: 'Backing song',
        durationSec: 2, bpm: null, sourceChannels: 2, encodedBytes: 100 };
    return { ...added, assets: { ...added.assets, song: asset }, tracks: added.tracks.map(item => item.id === track.id ? { ...item,
        regions: [{ id: 'song-region', start: 0, length: 1920, assetId: 'song', phaseSec: 0, gainDb: 0, fadeIn: null, fadeOut: null, reverse: false }] } : item) };
}
const range = (doc: () => BeatDoc) => ({ getDoc: doc, startTick: 0, endTick: 3840, cycle: null, countInBars: 0 as const,
    assetMode: 'all-supported' as const, onWindow: () => undefined });

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('recording playback runs the song through the mix graph and exposes its meters', async () => {
    const b = build(), doc = addEffect(make(), 't1', 'eq');
    expect(b.audio.meterTap('t1')).toBeNull();
    await b.audio.playRange!(range(() => doc));
    jest.spyOn(b.engine, 'now').mockReturnValue(1);
    jest.advanceTimersByTime(30);
    expect(b.start).toHaveBeenCalledTimes(1);
    expect(b.start.mock.calls[0][0]).toBe(doc);
    expect(b.audio.meterTap('t1')).not.toBeNull();
    b.audio.stop();
    expect(b.audio.meterTap('t1')).toBeNull();
    await b.audio.close();
});

test('recording playback schedules automation for each song window', async () => {
    const b = build(), doc = addAutomationPoint(make(), 't1', 'gain', 0, 0.5);
    const schedules: unknown[] = [];
    b.start.mockRestore();
    const real = b.engine.startRun.bind(b.engine);
    (jest.spyOn(b.engine, 'startRun') as unknown as jest.Mock).mockImplementation((d: never, o: never) => { const run = real(d, o); run.channels?.get('t1') && (run.channels.get('t1')!.schedule = (w: unknown) => { schedules.push(w); }); return run; });
    await b.audio.playRange!(range(() => doc));
    jest.spyOn(b.engine, 'now').mockReturnValue(1);
    jest.advanceTimersByTime(30);
    expect(schedules.length).toBeGreaterThan(0);
    await b.audio.close();
});

test('a mixer failure during recording never ends the take', async () => {
    const b = build(), doc = { ...make(), metronome: true };
    const click = jest.spyOn(b.engine, 'click');
    b.start.mockImplementation(() => { throw new Error('graph failed'); });
    await b.audio.playRange!(range(() => doc));
    expect(click).toHaveBeenCalledWith(0.1, true, expect.anything());
    expect(b.pad).toHaveBeenCalled();
    jest.spyOn(b.engine, 'now').mockReturnValue(1);
    expect(() => jest.advanceTimersByTime(60)).not.toThrow();
    expect(b.audio.isPlaying()).toBe(true);
    await b.audio.close();
});

test('offline backing audio stays silent without blocking or stopping recording transport', async () => {
    const error = Object.assign(new Error('offline'), { status: 0 }), onAssetError = jest.fn();
    const b = build({ assets: { load: jest.fn(async () => { throw error; }) }, onAssetError }), doc = withSong(make());
    await expect(b.audio.playRange!(range(() => doc))).resolves.toBeDefined();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(b.audio.isPlaying()).toBe(true); expect(onAssetError).toHaveBeenCalledWith('Backing song', error);
    jest.spyOn(b.engine, 'now').mockReturnValue(1); jest.advanceTimersByTime(60);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(b.audio.isPlaying()).toBe(true); await b.audio.close();
});

test('take playback tells the mixer when each piece ends', async () => {
    const { context } = fakeContext(), base = addAudioTrack({ ...fixedDoc(), tempo: { bpm: 120 } }), row = { ...takeRow(), samples: new Float32Array(10000), length: 10000 };
    const doc = commitRecording(base, { trackId: base.tracks.at(-1)!.id, start: 0, length: 15360, takes: [{ asset: takeAsset(row) }] });
    const output = jest.fn(() => context.destination);
    const player = createTakePlayback(context, async () => row, output);
    await player.window(doc, { fromSec: 0, toSec: 30, contextTime: 1 }, { startSec: 0, endSec: 30 });
    expect(output).toHaveBeenCalled();
    const [, , until] = output.mock.calls[0] as unknown as [string, BeatDoc, number];
    expect(until).toBeGreaterThan(1); // Context start 1 s plus the piece's length.
});
