import test from 'node:test';
import assert from 'node:assert/strict';
import { measureNewVideos } from '../lib/yourWinsVideoLengths.js';

const auth = '11111111-1111-4111-8111-111111111111';
const video = (n, extra = {}) => ({ job_id: `0000000${n}-0000-4000-8000-000000000000`, r2_key: `k${n}.mp4`, size_bytes: 100, ...extra });

function fakes(list, lengths) {
    const calls = [];
    return {
        calls,
        rpc: async (name, body) => {
            calls.push({ name, body });
            if (name === 'list_unmeasured_videos') return list;
            return { ok: true, recorded: true };
        },
        mp4: async key => { const v = lengths[key]; if (v instanceof Error) throw v; return v; },
    };
}

test('records each video length from its own headers, in milliseconds (QA build 50, F08)', async () => {
    const f = fakes([video(1), video(2)], { 'k1.mp4': { seconds: 8 }, 'k2.mp4': { seconds: 8.04 } });
    assert.equal(await measureNewVideos(auth, f), 2);
    assert.deepEqual(f.calls[0], { name: 'list_unmeasured_videos', body: { p_auth_id: auth, p_limit: 6 } });
    const recorded = f.calls.filter(c => c.name === 'record_video_duration').map(c => [c.body.p_r2_key, c.body.p_duration_ms]);
    assert.deepEqual(recorded.sort(), [['k1.mp4', 8000], ['k2.mp4', 8040]]);
});

test('an unreadable file is marked once; a failed read is left for next time', async () => {
    const f = fakes([video(1), video(2)], { 'k1.mp4': null, 'k2.mp4': new Error('timeout') });
    assert.equal(await measureNewVideos(auth, f), 0);
    const recorded = f.calls.filter(c => c.name === 'record_video_duration');
    assert.deepEqual(recorded.map(c => [c.body.p_r2_key, c.body.p_duration_ms]), [['k1.mp4', null]]);
});

test('malformed rows and a non-array reply do nothing', async () => {
    const bad = fakes([video(1, { job_id: 'nope' }), video(2, { r2_key: 5 }), video(3, { size_bytes: 0 }), null], {});
    assert.equal(await measureNewVideos(auth, bad), 0);
    assert.equal(bad.calls.length, 1);
    const none = fakes({ error: 'x' }, {});
    assert.equal(await measureNewVideos(auth, none), 0);
});

test('a slow read cannot hold the page past its budget', async () => {
    const f = fakes([video(1)], {});
    f.mp4 = () => new Promise(() => {});
    const started = Date.now();
    assert.equal(await measureNewVideos(auth, f, { budgetMs: 50 }), 0);
    assert.ok(Date.now() - started < 1000);
});
