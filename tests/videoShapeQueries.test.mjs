import test from 'node:test';
import assert from 'node:assert/strict';
import { newestMeasuredVideo, measureFinishedVideo } from '../lib/videoShapeQueries.mjs';
const job = { job_id: 'j', state: 'succeeded', has_asset: true, video_width: 1080, video_height: 1920, shape_ambiguous: false };
test('newest measured skips held and ambiguous and follows cursors without retrying old Workers', async () => {
    let calls = 0;
    const found = await newestMeasuredVideo(async path => {
        if (++calls === 1) return { jobs: [{ ...job, held: true }, { ...job, shape_ambiguous: true }], next: { before: 'time', before_id: 'id' } };
        assert.match(path, /before=time/); return { jobs: [job] };
    });
    assert.equal(found, job); assert.equal(calls, 2);
    calls = 0;
    assert.equal(await newestMeasuredVideo(async () => { calls++; return { jobs: [{ state: 'succeeded' }], next: { before: 't', before_id: 'j' } }; }), null);
    assert.equal(calls, 1);
});
test('finished measurement uses stored value on replay and stays silent with an unapplied migration', async () => {
    assert.equal(await measureFinishedVideo(async path => path.endsWith('/shapes') ? { shapes: [] } : { jobs: [job] }, 'j'), job);
    assert.equal(await measureFinishedVideo(async path => path.endsWith('/shapes') ? { shapes: [] } : { jobs: [{ job_id: 'j' }] }, 'j'), null);
});
