import * as shared from '../src/lib/beatNative/exportShared';
import * as takes from '../src/lib/beatNative/takeShared';
import { nativeExportBytes, prepareExportBuffers, renderNativeExport } from '../src/lib/beatNative/exportRender';
import { addAudioRegion, type BeatDoc } from '../src/lib/beatNative/doc';
import { createTakeFiles } from '../src/lib/beatNative/takeFiles';
import { fixedDoc } from './beatNativeFixtures';
import { takeIO, takeRow } from './beatNativeTakeFixtures';
import { offlineFixture, exportOptions } from './beatNativeExportFixtures';
// Any attempt to load browser asset code fails this suite. Take-only export must not import it.
jest.mock('../../../app/veyrnox/_lib/music/beat/beatAssets.js', () => { throw new Error('browser assets imported'); });
beforeEach(() => { takes.configureBeatTakeStorage(createTakeFiles(takeIO())); });
afterEach(() => jest.restoreAllMocks());
const takeDoc = async (reverse = false) => {
    const row = { ...takeRow(), sampleRate: 48000, samples: new Float32Array([0.2, -0.4, 0.6]), length: 3 };
    await takes.putBeatTake(row);
    const doc = addAudioRegion(fixedDoc(), takes.takeAsset(row), null, 0);
    doc.tracks.at(-1)!.regions[0].reverse = reverse;
    return { doc, row };
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
    expect(result[0].report.gaps).toContain('dynamicsCompressor');
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
test.each(['song', 'stem', 'target', 'sound'])('refuses %s before load, native construction or shared rendering', async source => {
    const { doc } = await takeDoc(), id = shared.usedAssets(doc)[0];
    (doc.assets![id] as unknown as { source: string }).source = source;
    const load = jest.spyOn(takes, 'loadBeatTake'), reached = jest.spyOn(shared, 'renderSong'), { Context, contexts } = offlineFixture();
    await expect(renderNativeExport(doc, exportOptions, async () => {}, { Context })).rejects.toMatchObject({ key: 'beatExport.source' });
    expect(load).not.toHaveBeenCalled(); expect(reached).not.toHaveBeenCalled(); expect(contexts).toHaveLength(0);
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
test('stems finish sharing before the next render; pattern uses the shared mono encoder', async () => {
    const { doc } = await takeDoc(), { Context, starts } = offlineFixture(), order: string[] = [];
    const render = jest.spyOn(shared, 'renderSong');
    await renderNativeExport(doc, { ...exportOptions, output: 'stems' }, async () => { order.push('share'); expect(render).toHaveBeenCalledTimes(order.length); }, { Context });
    expect(order).toHaveLength(2);
    const consume = jest.fn(async (_result: { bytes: ArrayBuffer }) => {});
    await renderNativeExport(doc, { ...exportOptions, kind: 'pattern', loops: 2 }, consume, { Context });
    expect(starts.mock.calls.at(-1)![0]).toBe(1); expect(new DataView(consume.mock.calls[0][0].bytes).getUint16(22, true)).toBe(1);
});

test('N7-R7: non-take song assets do not block pattern loops but remain refused for song export', async () => {
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
