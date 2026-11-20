import { createTakePlayback } from '../src/lib/beatNative/takePlayback';
import { addAudioTrack, commitRecording, takeAsset } from '../src/lib/beatNative/takeShared';
import { fixedDoc, deferred } from './beatNativeFixtures';
import { fakeContext, takeRow } from './beatNativeTakeFixtures';
function recorded() { const doc = addAudioTrack({ ...fixedDoc(), tempo: { bpm: 120 } }), row = { ...takeRow(), samples: new Float32Array(10000), length: 10000 }; return { row, doc: commitRecording(doc, { trackId: doc.tracks.at(-1)!.id, start: 3840, length: 15360, takes: [{ asset: takeAsset(row) }] }) }; }
test('schedules clipped pieces with correct context time/offset and stops all owned sources', async () => {
    const { context, sources } = fakeContext(), { row, doc } = recorded(); const load = jest.fn(async () => row), player = createTakePlayback(context, load);
    await player.window(doc, { fromSec: 3, toSec: 3.15, contextTime: 10 }, { startSec: 3, endSec: 4 });
    expect(sources[0].start).toHaveBeenCalledWith(10, 1, 1); expect(sources[0].stop).toHaveBeenCalledWith(11);
    player.stop(); expect(sources[0].stop).toHaveBeenLastCalledWith(); expect(sources[0].disconnect).toHaveBeenCalled();
    await player.window(doc, { fromSec: 2, toSec: 2.15, contextTime: 12 }, { startSec: 2, endSec: 10 });
    expect(sources).toHaveLength(2); expect(load).toHaveBeenCalledTimes(1); player.close(); expect(sources[1].disconnect).toHaveBeenCalled();
});
test('missing cloud-only takes stay silent, and loads resolving after stop cannot schedule', async () => {
    const { context, sources } = fakeContext(), { row, doc } = recorded(), pending = deferred<typeof row | null>();
    const player = createTakePlayback(context, () => pending.promise);
    const work = player.window(doc, { fromSec: 2, toSec: 2.15, contextTime: 1 }, { startSec: 2, endSec: 10 }); player.stop(); pending.resolve(row); await work; expect(sources).toEqual([]);
    const missing = createTakePlayback(context, async () => null); await missing.window(doc, { fromSec: 2, toSec: 2.15, contextTime: 1 }, { startSec: 2, endSec: 10 }); expect(sources).toEqual([]);
});
