import * as shared from '../src/lib/beatNative/exportShared';
import * as takes from '../src/lib/beatNative/takeShared';
import { nativeExportBytes, nativeStemLoadBytes, prepareExportBuffers, renderNativeExport } from '../src/lib/beatNative/exportRender';
import { addAudioRegion, type BeatDoc, type BeatRemoteAsset } from '../src/lib/beatNative/doc';
import { BEAT_SOUNDS, soundAsset, soundDuration } from '../src/lib/beatNative/labs';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import { wrapNativeContext, type NativeOfflineContext } from '../src/lib/beatNative/nativeContext';
import { fixedDoc } from './beatNativeFixtures';
import { takeIO, takeRow } from './beatNativeTakeFixtures';
import { offlineFixture, exportOptions } from './beatNativeExportFixtures';
import type { NativeExportAssetSession } from '../src/lib/beatNative/nativeExportAssets';
import { NATIVE_INFLATE_PEAK_BYTES, STEM_ZIP_LIMIT } from '../src/lib/beatNative/stemArchive';
// Native export owns prepared buffers and must never load browser state/signing modules.
jest.mock('../../../app/veyrnox/_lib/music/beat/beatAssets.js', () => { throw new Error('browser assets imported'); });
jest.mock('../../../app/veyrnox/_lib/music/beat/beatSongAsset.js', () => { throw new Error('browser song assets imported'); });
beforeEach(() => { takes.configureBeatTakeStorage(createTakeFiles(takeIO())); });
afterEach(() => jest.restoreAllMocks());
const takeDoc = async (reverse = false) => {
    const row = { ...takeRow(), sampleRate: 48000, samples: new Float32Array([0.2, -0.4, 0.6]), length: 3 };
    await takes.putBeatTake(row);
    const doc = addAudioRegion(fixedDoc(), takes.takeAsset(row), null, 0);
    doc.tracks.at(-1)!.regions[0].reverse = reverse;
    return { doc, row };
};
const soundDoc = (sound = BEAT_SOUNDS[0], reverse = false) => {
    const doc = addAudioRegion(fixedDoc(), soundAsset(sound, fixedDoc().tempo.bpm), null, 0);
    doc.tracks.at(-1)!.regions[0].reverse = reverse;
    return { doc, id: shared.usedAssets(doc).at(-1)! };
};
test.each([16, 24] as const)('runs the actual shared song renderer and creates stereo %i-bit WAV', async bitDepth => {
    const { Context, starts } = offlineFixture(), doc = fixedDoc(), consume = jest.fn(async () => {});
    const reached = jest.spyOn(shared, 'renderSong');
    await renderNativeExport(doc, { ...exportOptions, bitDepth }, consume, { Context });
    expect(reached).toHaveBeenCalledWith(doc, expect.objectContaining({ range: 'song', buffers: expect.any(Map), originSec: 0 }));
    const result = consume.mock.calls[0] as unknown as [{ bytes: ArrayBuffer; report: { gaps: string[] } }];
    const view = new DataView(result[0].bytes), frames = starts.mock.calls.at(-1)![1];
    expect(String.fromCharCode(...new Uint8Array(result[0].bytes, 0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(2); expect(view.getUint32(24, true)).toBe(48000); expect(view.getUint16(34, true)).toBe(bitDepth);
    expect(result[0].bytes.byteLength).toBe(44 + frames * 2 * bitDepth / 8);
    expect(result[0].report.gaps).not.toContain('dynamicsCompressor');
});
test('native take buffers include a reversed copy; song export never imports browser assets', async () => {
    const { doc, row } = await takeDoc(true), { Context } = offlineFixture();
    const map = await prepareExportBuffers(doc, new Context(1, 1, 48000)), id = shared.usedAssets(doc)[0];
    expect(map.get(id)?.buffer?.getChannelData(0)).toEqual(row.samples);
    expect(map.get(id)?.reverse?.getChannelData(0)).toEqual(row.samples.slice().reverse());
    const render = jest.spyOn(shared, 'renderSong'), consume = jest.fn(async () => {});
    await renderNativeExport(doc, exportOptions, consume, { Context });
    expect(render).toHaveBeenCalled(); expect(consume).toHaveBeenCalledTimes(1);
    // References held by the spy also see the cleared map after the render.
    expect(render.mock.calls[0][1].buffers.size).toBe(0);
});
test.each([16, 24] as const)('exports a Starter Sound through copied stereo 48 kHz buffers at %i-bit', async bitDepth => {
    const { doc, id } = soundDoc(), fixture = offlineFixture(), consume = jest.fn(async () => {});
    const original = shared.renderSong; let prepared: shared.PCMBuffer | undefined;
    jest.spyOn(shared, 'renderSong').mockImplementation((input, options) => {
        prepared = options.buffers.get(id)?.buffer;
        return original(input, options);
    });
    await renderNativeExport(doc, { ...exportOptions, bitDepth }, consume, { Context: fixture.Context });
    const soundFrames = Math.round(soundDuration(BEAT_SOUNDS[0].id, doc.tempo.bpm) * 48000);
    expect(fixture.starts.mock.calls).toContainEqual([2, soundFrames, 48000]);
    expect(prepared).toMatchObject({ numberOfChannels: 2, length: soundFrames, sampleRate: 48000 });
    expect(prepared).not.toBe(fixture.rendered[0]);
    const result = consume.mock.calls[0] as unknown as [{ bytes: ArrayBuffer }];
    const wav = result[0].bytes, view = new DataView(wav);
    expect(String.fromCharCode(...new Uint8Array(wav, 0, 4))).toBe('RIFF');
    expect(view.getUint16(22, true)).toBe(2); expect(view.getUint32(24, true)).toBe(48000); expect(view.getUint16(34, true)).toBe(bitDepth);
});
test('Starter Sound copies and reverses every rendered channel', async () => {
    const { doc, id } = soundDoc(BEAT_SOUNDS[0], true), fixture = offlineFixture();
    const make = (channels: number, length: number, rate: number) => {
        const context = new fixture.Context(channels, length, rate), start = context.startRendering.bind(context);
        context.startRendering = async () => {
            const result = await start();
            result.getChannelData(0).set([0.1, 0.2, 0.3]); result.getChannelData(1).set([-0.1, -0.2, -0.3]);
            return result;
        };
        return wrapNativeContext(context, { gaps: [], latencyHint: 'offline' }) as NativeOfflineContext;
    };
    const map = await prepareExportBuffers(doc, new fixture.Context(1, 1, 48000), { make });
    const entry = map.get(id)!;
    expect(entry.buffer).not.toBe(fixture.rendered[0]);
    expect([...entry.buffer!.getChannelData(0).slice(0, 3)]).toEqual([...new Float32Array([0.1, 0.2, 0.3])]);
    expect([...entry.reverse!.getChannelData(0).slice(-3)]).toEqual([...new Float32Array([0.3, 0.2, 0.1])]);
    expect([...entry.reverse!.getChannelData(1).slice(-3)]).toEqual([...new Float32Array([-0.3, -0.2, -0.1])]);
});
test('renders an FX Starter Sound through the authoritative native offline path', async () => {
    const fx = BEAT_SOUNDS.find(sound => sound.category === 'FX')!, { doc } = soundDoc(fx), fixture = offlineFixture();
    await renderNativeExport(doc, exportOptions, async () => {}, { Context: fixture.Context });
    expect(fixture.starts.mock.calls).toContainEqual([2, Math.round(soundDuration(fx.id, doc.tempo.bpm) * 48000), 48000]);
});
test('passes complete mixed take and Starter Sound buffers to the shared renderer', async () => {
    const row = { ...takeRow('mixed-take'), sampleRate: 48000, samples: new Float32Array([0.25, -0.5]), length: 2 };
    await takes.putBeatTake(row);
    let doc = addAudioRegion(fixedDoc(), takes.takeAsset(row), null, 0);
    doc = addAudioRegion(doc, soundAsset(BEAT_SOUNDS[0], doc.tempo.bpm), null, 0);
    const ids = shared.usedAssets(doc), seen: shared.SongBuffers = new Map();
    const original = shared.renderSong;
    jest.spyOn(shared, 'renderSong').mockImplementation((input, options) => {
        for (const [id, value] of options.buffers) seen.set(id, value);
        return original(input, options);
    });
    await renderNativeExport(doc, exportOptions, async () => {}, { Context: offlineFixture().Context });
    expect([...seen.keys()]).toEqual(ids);
    expect(seen.get(ids[0])?.buffer?.numberOfChannels).toBe(1);
    expect(seen.get(ids[1])?.buffer?.numberOfChannels).toBe(2);
});
test('starts a fresh deterministic random stream for every Starter Sound asset', async () => {
    const first = soundDoc(), doc = addAudioRegion(first.doc, soundAsset(BEAT_SOUNDS[1], first.doc.tempo.bpm), null, 0);
    const samples: number[][] = [], original = shared.renderStarterSound;
    jest.spyOn(shared, 'renderStarterSound').mockImplementation((ref, bpm, make, random) => {
        samples.push([random!(), random!()]);
        return original(ref, bpm, make, shared.seededRandom(shared.exportSeed(doc)));
    });
    await renderNativeExport(doc, exportOptions, async () => {}, { Context: offlineFixture().Context });
    expect(samples).toHaveLength(2); expect(samples[1]).toEqual(samples[0]);
});
test.each([
    ['rate', (buffer: shared.PCMBuffer) => ({ ...buffer, sampleRate: 44100 })],
    ['channels', (buffer: shared.PCMBuffer) => ({ ...buffer, numberOfChannels: 1 })],
    ['length', (buffer: shared.PCMBuffer) => ({ ...buffer, length: Math.floor(buffer.length / 2) })],
] as const)('refuses a Starter Sound render with wrong %s metadata', async (_kind, corrupt) => {
    const { doc } = soundDoc(), fixture = offlineFixture(), frames = Math.round(soundDuration(BEAT_SOUNDS[0].id, doc.tempo.bpm) * 48000);
    const Context = function (channels: number, length: number, rate: number) {
        const context = new fixture.Context(channels, length, rate);
        if (channels === 2 && length === frames) {
            const start = context.startRendering.bind(context);
            context.startRendering = async () => corrupt(await start()) as shared.PCMBuffer;
        }
        return context;
    } as unknown as typeof fixture.Context;
    const consume = jest.fn(), render = jest.spyOn(shared, 'renderSong');
    await expect(renderNativeExport(doc, exportOptions, consume, { Context })).rejects.toThrow('This sound changed size since it was added');
    expect(render).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
});
test('refuses a missing audio source before load, native construction or shared rendering', async () => {
    const { doc } = await takeDoc(), id = shared.usedAssets(doc)[0];
    delete doc.assets![id];
    const load = jest.spyOn(takes, 'loadBeatTake'), reached = jest.spyOn(shared, 'renderSong'), { Context, contexts } = offlineFixture();
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context })).rejects.toMatchObject({ key: 'beatExport.source' });
    expect(load).not.toHaveBeenCalled(); expect(reached).not.toHaveBeenCalled(); expect(contexts).toHaveLength(0);
});
test.each(['song', 'stem', 'target'] as const)('renders a signed %s asset through the native session and asserts authority in shared chunks', async source => {
    const asset: BeatRemoteAsset = source === 'song'
        ? { source, name: 'Music track', bpm: null, durationSec: 2, sourceChannels: 2, encodedBytes: 100,
            ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' } }
        : source === 'stem'
            ? { source, name: 'Stem', bpm: null, durationSec: 2, sourceChannels: 2, encodedBytes: 100,
                ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', requestId: '33333333-3333-4333-8333-333333333333', part: 'vocals' } }
        : { source, name: 'Target', bpm: null, durationSec: 2, sourceChannels: 2, encodedBytes: 100,
            ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', requestId: '33333333-3333-4333-8333-333333333333', kind: 'target', instrument: 'vocals' } };
    const doc = addAudioRegion(fixedDoc(), asset, null, 0), fixture = offlineFixture();
    const prepare = jest.fn(async (_asset, _bpm, target: NativeOfflineContext) => target.createBuffer(2, 96_000, 48_000));
    const assertAssets = jest.fn(), releaseBatch = jest.fn(async () => {});
    const assets = { prepare, assertAssets, releaseBatch, preflight: jest.fn(), confirm: jest.fn(), close: jest.fn() } as NativeExportAssetSession;
    const consume = jest.fn();
    await renderNativeExport(doc, exportOptions, consume, { Context: fixture.Context, assets });
    expect(prepare).toHaveBeenCalledTimes(1); expect(assertAssets).toHaveBeenCalled(); expect(releaseBatch).toHaveBeenCalledTimes(1);
    expect(consume).toHaveBeenCalledTimes(1);
});
test('invalid Starter Sound metadata refuses the whole export before native construction', async () => {
    const first = soundDoc(), later = addAudioRegion(first.doc, soundAsset(BEAT_SOUNDS[1], first.doc.tempo.bpm), null, 0);
    const laterId = shared.usedAssets(later).at(-1)!; later.assets![laterId].durationSec += 1;
    const fixture = offlineFixture(), consume = jest.fn(), render = jest.spyOn(shared, 'renderSong');
    await expect(renderNativeExport(later, { ...exportOptions, output: 'stems' }, consume, { Context: fixture.Context })).rejects.toMatchObject({ key: 'beatExport.renderError' });
    expect(fixture.contexts).toHaveLength(0); expect(render).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
});
test('missing take refuses instead of silently rendering', async () => {
    const { doc } = await takeDoc(); jest.spyOn(takes, 'loadBeatTake').mockResolvedValue(null);
    const reached = jest.spyOn(shared, 'renderSong');
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context: offlineFixture().Context })).rejects.toMatchObject({ key: 'beatExport.missingOne' });
    expect(reached).not.toHaveBeenCalled();
});
function longTakes(count: number, prefix = 'take'): BeatDoc {
    let doc = fixedDoc();
    for (let i = 0; i < count; i++) doc = addAudioRegion(doc, { source: 'take', ref: `${prefix}-${i}`, name: 'Take', durationSec: 90, bpm: null, sourceChannels: 1, encodedBytes: 44 + 90 * 48000 * 2 }, null, 0);
    return doc;
}
test('eight overlapping 90s takes pass web estimate but fail native preflight before any load', async () => {
    const doc = longTakes(8), plan = shared.planExport(doc, { ...exportOptions, phone: true });
    expect(shared.estimateExport(doc, plan.frames)).toBeLessThan(300 * shared.MB);
    expect(nativeExportBytes(doc, plan)).toBeGreaterThan(300 * shared.MB);
    const load = jest.spyOn(takes, 'loadBeatTake');
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context: offlineFixture().Context })).rejects.toMatchObject({ key: 'beatExport.phone' });
    expect(load).not.toHaveBeenCalled();
});
test('cached takes removed from the document still count against replacement export', async () => {
    const doc = longTakes(4, 'replacement'), plan = shared.planExport(doc, { ...exportOptions, phone: true });
    const cached = Array.from({ length: 8 }, (_, i) => ({ ...takeRow(`removed-${i}`), samples: { length: 90 * 48000 } as Float32Array, length: 90 * 48000 }));
    jest.spyOn(takes, 'beatTakes').mockReturnValue(cached);
    expect(nativeExportBytes(doc, plan)).toBeGreaterThan(300 * shared.MB);
    const load = jest.spyOn(takes, 'loadBeatTake');
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context: offlineFixture().Context })).rejects.toMatchObject({ key: 'beatExport.phone' });
    expect(load).not.toHaveBeenCalled();
});
test.each([['', false], [' plus reverse', true]] as const)('native memory preflight counts prepared stereo Sound%s, two active copies and noise', (_label, reverse) => {
    const { doc } = soundDoc(BEAT_SOUNDS[0], reverse), plan = shared.planExport(doc, { ...exportOptions, phone: true });
    const frames = Math.round(soundDuration(BEAT_SOUNDS[0].id, doc.tempo.bpm) * 48000), soundPcm = frames * 2 * 4;
    const expected = soundPcm * (reverse ? 2 : 1) + soundPcm * 2 + 48000 * 4
        + plan.frames * 2 * 4 + 44 + plan.frames * 2 * plan.bitDepth / 8;
    expect(nativeExportBytes(doc, plan, [])).toBe(expected);
});
test.each([['', false], [' plus reverse', true]] as const)('native memory preflight counts remote decode reserve once%s', (_label, reverse) => {
    const asset: BeatRemoteAsset = { source: 'song', name: 'Music track', bpm: null, durationSec: 2, sourceChannels: 2, encodedBytes: 100,
        ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' } };
    const doc = addAudioRegion(fixedDoc(), asset, null, 0);
    doc.tracks.at(-1)!.regions[0].reverse = reverse;
    const plan = shared.planExport(doc, { ...exportOptions, phone: true });
    const prepared = shared.pcmBytes(asset) * (reverse ? 2 : 1);
    const expected = prepared + shared.decodeReserve(asset)
        + plan.frames * 2 * 4 + 44 + plan.frames * 2 * plan.bitDepth / 8;
    expect(nativeExportBytes(doc, plan, [])).toBe(expected);
});
test('stem admission includes both retained entries plus the larger inflate or decoded-copy peak', () => {
    const requestId = '33333333-3333-4333-8333-333333333333', encodedBytes = STEM_ZIP_LIMIT / 2;
    const stem = (part: 'vocals' | 'instrumental'): BeatRemoteAsset => ({ source: 'stem', name: part, bpm: null,
        durationSec: 2, sourceChannels: 2, encodedBytes,
        ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', requestId, part } });
    let doc = addAudioRegion(fixedDoc(), stem('vocals'), null, 0);
    doc = addAudioRegion(doc, stem('instrumental'), null, 0);
    const plan = shared.planExport(doc, { ...exportOptions, phone: true });
    const entries = STEM_ZIP_LIMIT, decodedCopyAndPcm = shared.decodeReserve(stem('vocals'));
    const prepared = shared.pcmBytes(stem('vocals')) + shared.pcmBytes(stem('instrumental'));
    const output = plan.frames * 2 * 4 + 44 + plan.frames * 2 * plan.bitDepth / 8;
    expect(STEM_ZIP_LIMIT).toBe(120 * shared.MB);
    expect(nativeStemLoadBytes(entries, stem('vocals'))).toBe(entries + Math.max(NATIVE_INFLATE_PEAK_BYTES, decodedCopyAndPcm));
    expect(nativeExportBytes(doc, plan, [])).toBe(prepared + entries + Math.max(NATIVE_INFLATE_PEAK_BYTES, decodedCopyAndPcm) + output);
    const single = addAudioRegion(fixedDoc(), stem('vocals'), null, 0), singlePlan = shared.planExport(single, { ...exportOptions, phone: true });
    const singleOutput = singlePlan.frames * 2 * 4 + 44 + singlePlan.frames * 2 * singlePlan.bitDepth / 8;
    expect(nativeExportBytes(single, singlePlan, [])).toBe(shared.pcmBytes(stem('vocals'))
        + STEM_ZIP_LIMIT + Math.max(NATIVE_INFLATE_PEAK_BYTES, decodedCopyAndPcm) + singleOutput);
});
test('two stem requests count two retained archives and gate exactly at 300 decimal MB', async () => {
    const stem = (requestId: string, part: 'vocals' | 'instrumental'): BeatRemoteAsset => ({ source: 'stem', name: `${requestId}-${part}`, bpm: null,
        durationSec: 2, sourceChannels: 2, encodedBytes: 1,
        ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', requestId, part } });
    const first = stem('33333333-3333-4333-8333-333333333333', 'vocals');
    const second = stem('44444444-4444-4444-8444-444444444444', 'instrumental');
    let doc = addAudioRegion(fixedDoc(), first, null, 0);
    doc = addAudioRegion(doc, second, null, 0);
    const plan = shared.planExport(doc, { ...exportOptions, phone: true });
    const prepared = shared.pcmBytes(first) + shared.pcmBytes(second);
    const output = plan.frames * 2 * 4 + 44 + plan.frames * 2 * plan.bitDepth / 8;
    const transient = Math.max(NATIVE_INFLATE_PEAK_BYTES, shared.decodeReserve(first), shared.decodeReserve(second));
    const base = nativeExportBytes(doc, plan, []);
    expect(base).toBe(prepared + 2 * STEM_ZIP_LIMIT + transient + output);
    const room = 300 * shared.MB - base, fixture = offlineFixture();
    expect(room).toBeGreaterThanOrEqual(0);
    const assets = { prepare: jest.fn(async (_asset, _bpm, target: NativeOfflineContext) => target.createBuffer(2, 96_000, 48_000)),
        assertAssets: jest.fn(), releaseBatch: jest.fn(async () => {}), preflight: jest.fn(), confirm: jest.fn(), close: jest.fn() } as NativeExportAssetSession;
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context: fixture.Context, assets, retainedBytes: () => room })).resolves.toBeUndefined();
    const over = offlineFixture();
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context: over.Context, assets, retainedBytes: () => room + 1 }))
        .rejects.toMatchObject({ key: 'beatExport.phone' });
    expect(over.contexts).toHaveLength(0);
});
test('stem admission accepts exactly 300 decimal MB and refuses one byte over before native allocation', async () => {
    const requestId = '33333333-3333-4333-8333-333333333333', encodedBytes = STEM_ZIP_LIMIT / 2;
    const stem = (part: 'vocals' | 'instrumental'): BeatRemoteAsset => ({ source: 'stem', name: part, bpm: null,
        durationSec: 2, sourceChannels: 2, encodedBytes,
        ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', requestId, part } });
    let doc = addAudioRegion(fixedDoc(), stem('vocals'), null, 0);
    doc = addAudioRegion(doc, stem('instrumental'), null, 0);
    const plan = shared.planExport(doc, { ...exportOptions, phone: true }), base = nativeExportBytes(doc, plan, []);
    const room = 300 * shared.MB - base, fixture = offlineFixture();
    expect(room).toBeGreaterThanOrEqual(0);
    const assets = { prepare: jest.fn(async (_asset, _bpm, target: NativeOfflineContext) => target.createBuffer(2, 96_000, 48_000)),
        assertAssets: jest.fn(), releaseBatch: jest.fn(async () => {}), preflight: jest.fn(), confirm: jest.fn(), close: jest.fn() } as NativeExportAssetSession;
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context: fixture.Context, assets, retainedBytes: () => room })).resolves.toBeUndefined();
    const over = offlineFixture();
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context: over.Context, assets, retainedBytes: () => room + 1 }))
        .rejects.toMatchObject({ key: 'beatExport.phone' });
    expect(over.contexts).toHaveLength(0);
});
test('retained take cache can make a Sound export fail native memory before any context', async () => {
    const { doc } = soundDoc(), plan = shared.planExport(doc, { ...exportOptions, phone: true });
    const base = nativeExportBytes(doc, plan, []), needed = Math.ceil((300 * shared.MB - base + 1) / 4);
    const cached = [{ ...takeRow('retained'), samples: { length: needed } as Float32Array, length: needed }];
    expect(nativeExportBytes(doc, plan, cached)).toBeGreaterThan(300 * shared.MB);
    jest.spyOn(takes, 'beatTakes').mockReturnValue(cached);
    const fixture = offlineFixture();
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context: fixture.Context })).rejects.toMatchObject({ key: 'beatExport.phone' });
    expect(fixture.contexts).toHaveLength(0);
});
test('stems finish sharing before the next render; pattern uses the shared mono encoder', async () => {
    const { doc } = await takeDoc(), { Context, starts } = offlineFixture(), order: string[] = [];
    const render = jest.spyOn(shared, 'renderSong');
    await renderNativeExport(doc, { ...exportOptions, output: 'stems' }, async () => { order.push('share'); expect(render).toHaveBeenCalledTimes(order.length); }, { Context });
    expect(order).toHaveLength(2);
    const consume = jest.fn(async (_result: { bytes: ArrayBuffer }) => {});
    await renderNativeExport(doc, { ...exportOptions, kind: 'pattern', loops: 2 }, consume, { Context });
    expect(starts.mock.calls.at(-1)![0]).toBe(1); expect(new DataView(consume.mock.calls[0][0].bytes).getUint16(22, true)).toBe(1);
});

test('N7-R7: remote assets do not block pattern loops and song export requires its native asset session', async () => {
    const doc = addAudioRegion(fixedDoc(), { source: 'song', name: 'Music track', bpm: null, durationSec: 10, sourceChannels: 2, encodedBytes: 1000,
        ref: { songId: '11111111-1111-4111-8111-111111111111', versionId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' } }, null, 0);
    const { Context } = offlineFixture(), consume = jest.fn(async () => {}), render = jest.spyOn(shared, 'renderBeat');
    await renderNativeExport(doc, { ...exportOptions, kind: 'pattern' }, consume, { Context });
    expect(render).toHaveBeenCalled(); expect(consume).toHaveBeenCalledTimes(1);
    await expect(renderNativeExport(doc, exportOptions, consume, { Context })).rejects.toMatchObject({ key: 'beatExport.source' });
    expect(consume).toHaveBeenCalledTimes(1);
});

test('N7-RV-003: each stem allocates only its own track takes and reverses', async () => {
    const first = { ...takeRow('first'), sampleRate: 48000, samples: new Float32Array(3), length: 3 };
    const second = { ...takeRow('second'), sampleRate: 48000, samples: new Float32Array(5), length: 5 };
    await takes.putBeatTake(first); await takes.putBeatTake(second);
    let doc = addAudioRegion(fixedDoc(), takes.takeAsset(first), null, 0);
    doc = addAudioRegion(doc, takes.takeAsset(second), null, 0);
    doc.tracks.at(-1)!.regions[0].reverse = true;
    const base = offlineFixture(), allocations: number[][] = [];
    const Context = function (channels: number, length: number, rate: number) {
        const context = new base.Context(channels, length, rate);
        if (length === 1) {
            const allocated: number[] = []; allocations.push(allocated);
            const create = context.createBuffer.bind(context);
            context.createBuffer = (ch, frames, sr) => { allocated.push(frames); return create(ch, frames, sr); };
        }
        return context;
    } as unknown as typeof base.Context;
    const original = shared.renderSong, seen: string[][] = [];
    jest.spyOn(shared, 'renderSong').mockImplementation((doc, options) => { seen.push([...options.buffers.keys()]); return original(doc, options); });
    await renderNativeExport(doc, { ...exportOptions, output: 'stems' }, async () => {}, { Context });
    expect(allocations).toEqual([[], [3], [5, 5]]);
    expect(seen).toEqual(doc.tracks.map(track => shared.usedAssets({ ...doc, tracks: [track] })));
});
test('N7-RV-003: stem memory preflight counts all shared samples plus the largest per-track native set', () => {
    const doc = longTakes(8), plan = shared.planExport(doc, { ...exportOptions, output: 'stems', phone: true });
    const ids = plan.tracks.filter(track => track.audible).map(track => track.id);
    const mix = nativeExportBytes(doc, plan, []), stems = nativeExportBytes(doc, plan, [], ids);
    expect(mix - stems).toBe(7 * 90 * 48000 * 4);
    expect(mix).toBeGreaterThan(300 * shared.MB); expect(stems).toBeLessThan(300 * shared.MB);
});
test('N7-RV-003: a missing later stem refuses before the first native allocation or share', async () => {
    const { doc } = await takeDoc(), later = addAudioRegion(doc, takes.takeAsset(takeRow('missing-later')), null, 0);
    const { Context, contexts } = offlineFixture(), consume = jest.fn(), render = jest.spyOn(shared, 'renderSong');
    await expect(renderNativeExport(later, { ...exportOptions, output: 'stems' }, consume, { Context })).rejects.toMatchObject({ key: 'beatExport.missingOne' });
    expect(contexts).toHaveLength(0); expect(render).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
});
test('a later per-track Sound synthesis failure stops that stem and every later delivery', async () => {
    const first = soundDoc(), secondSound = BEAT_SOUNDS[1], doc = addAudioRegion(first.doc, soundAsset(secondSound, first.doc.tempo.bpm), null, 0);
    const soundTracks = doc.tracks.filter(track => track.regions.some(region => region.assetId && doc.assets?.[region.assetId]?.source === 'sound'));
    const plan = shared.planExport(doc, { ...exportOptions, output: 'stems', phone: true });
    const secondIndex = plan.tracks.filter(track => track.audible).findIndex(track => track.id === soundTracks[1].id);
    const original = shared.renderStarterSound; let count = 0;
    jest.spyOn(shared, 'renderStarterSound').mockImplementation((...args) => ++count === 2 ? Promise.reject(new Error('sound render failed')) : original(...args));
    const consume = jest.fn(), fixture = offlineFixture();
    await expect(renderNativeExport(doc, { ...exportOptions, output: 'stems' }, consume, { Context: fixture.Context })).rejects.toThrow('sound render failed');
    expect(consume).toHaveBeenCalledTimes(secondIndex); expect(count).toBe(2);
});
test('revocation immediately after Sound synthesis prevents shared render and delivery', async () => {
    const { doc } = soundDoc(), original = shared.renderStarterSound; let current = true;
    jest.spyOn(shared, 'renderStarterSound').mockImplementation(async (...args) => {
        const result = await original(...args); current = false; return result;
    });
    const render = jest.spyOn(shared, 'renderSong'), consume = jest.fn(), fixture = offlineFixture();
    await expect(renderNativeExport(doc, exportOptions, consume, { Context: fixture.Context, current: () => current })).rejects.toMatchObject({ key: 'beatExport.signIn' });
    expect(render).not.toHaveBeenCalled(); expect(consume).not.toHaveBeenCalled();
});
