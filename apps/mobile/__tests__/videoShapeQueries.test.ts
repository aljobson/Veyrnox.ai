import assert from 'node:assert/strict';
import { newestMeasuredVideo, measureFinishedVideo, createMeasuredVideoCache } from '../src/lib/videoShapeQueries';
const base = { job_id: 'j', state: 'succeeded', has_asset: true, credits: 1, model_id: 'video', created_at: '2026-11-21T00:00:00Z' } as const;
const job = { ...base, job_id: 'j', state: 'succeeded', has_asset: true, video_width: 1080, video_height: 1920, shape_ambiguous: false } as const;
test('newest measured skips held and ambiguous and follows cursors without retrying old Workers', async () => {
    let calls = 0;
    const found = await newestMeasuredVideo(async path => {
        if (++calls === 1) return { jobs: [{ ...job, held: true }, { ...job, shape_ambiguous: true }], next: { before: 'time', before_id: 'id' } };
        assert.match(path, /before=time/); return { jobs: [job] };
    });
    assert.equal(found, job); assert.equal(calls, 2);
    calls = 0;
    assert.equal(await newestMeasuredVideo(async () => { calls++; return { jobs: [{ ...base }], next: { before: 't', before_id: 'j' } }; }), null);
    assert.equal(calls, 1);
});
test('finished measurement uses stored value on replay and stays silent with an unapplied migration', async () => {
    assert.equal(await measureFinishedVideo(async path => path.endsWith('/shapes') ? { shapes: [] } : { jobs: [job] }, 'j'), job);
    assert.equal(await measureFinishedVideo(async path => path.endsWith('/shapes') ? { shapes: [] } : { jobs: [{ ...base }] }, 'j'), null);
});

test('a modern history with no measured videos is capped at two pages', async () => {
    let calls = 0;
    assert.equal(await newestMeasuredVideo(async () => ({ jobs: [{ ...base, shape_ambiguous: false }], next: { before: 't', before_id: String(++calls) } })), null);
    assert.equal(calls, 2);
});
test('mounted session caches empty results per account and refreshes once per measured completion key', async () => {
    const cached = createMeasuredVideoCache();
    let calls = 0, measured = false;
    const request = async () => { calls++; return { jobs: measured ? [job] : [{ ...base, shape_ambiguous: false }], next: { before: 't', before_id: String(calls) } }; };
    assert.deepEqual(await Promise.all([cached(request, 'a'), cached(request, 'a')]), [null, null]);
    assert.equal(calls, 2);
    await cached(request, 'b'); assert.equal(calls, 4);
    measured = true;
    assert.equal(await cached(request, 'a'), null); assert.equal(calls, 4);
    assert.equal(await cached(request, 'a', 'finished-job'), job); assert.equal(calls, 5);
    assert.equal(await cached(request, 'a', 'finished-job'), job); assert.equal(calls, 5);
});
test('completion refresh retains the two-page cap, and request failures are cached without retry loops', async () => {
    const cached = createMeasuredVideoCache();
    let calls = 0;
    const request = async () => ({ jobs: [{ ...base, shape_ambiguous: false }], next: { before: 't', before_id: String(++calls) } });
    await cached(request, 'a'); await cached(request, 'a', 'done'); await cached(request, 'a', 'done');
    assert.equal(calls, 4);
    const failed = async () => { calls++; throw new Error('offline'); };
    assert.equal(await cached(failed, 'b'), null); assert.equal(await cached(failed, 'b'), null);
    assert.equal(calls, 5);
});
