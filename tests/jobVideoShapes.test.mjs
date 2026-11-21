import test from 'node:test';
import assert from 'node:assert/strict';
import { measureVideoShapes, validShapeIds, publicShapeFields } from '../lib/jobVideoShapes.js';
const ids = Array.from({ length: 12 }, (_, i) => `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`);
const assets = ids.map(job_id => ({ job_id, r2_key: `private/${job_id}`, size_bytes: 100 }));
test('strict request validation rejects duplicates, over-limit and unknown fields', () => {
    assert.equal(validShapeIds({ job_ids: ids }), true);
    for (const body of [null, {}, [], { job_ids: [] }, { job_ids: ['bad'] }, { job_ids: [ids[0], ids[0]] }, { job_ids: [...ids, ids[0]] }, { job_ids: ids, user: 'other' }]) assert.equal(validShapeIds(body), false);
    const id = 'ABCDEFAB-1111-4111-8111-111111111111';
    assert.equal(validShapeIds({ job_ids: [id, id.toLowerCase()] }), false);
});
test('four concurrent file reads maximum, twelve IDs, verified owner, no keys returned', async () => {
    let active = 0, max = 0;
    const recorded = [];
    const result = await measureVideoShapes('owner', ids, {
        rpc: async (name, args) => {
            assert.equal(args.p_auth_id, 'owner');
            if (name === 'list_unmeasured_video_shapes') { assert.deepEqual(args.p_job_ids, ids); return assets; }
            assert.equal(name, 'record_video_shape'); recorded.push(args); return { recorded: true };
        },
        mp4: async () => { max = Math.max(max, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return { width: 1088, height: 1920 }; },
    });
    assert.equal(max, 4); assert.equal(recorded.length, 12); assert.equal(result.length, 12);
    assert.deepEqual(Object.keys(result[0]).sort(), ['height', 'job_id', 'width']);
});
test('read failures remain retryable; invalid readable files are marked once; replay returns no new shapes', async () => {
    const writes = [];
    const deps = { rpc: async (name, args) => name.startsWith('list_') ? assets.slice(0, 3) : (writes.push(args), { recorded: args.p_job_id !== ids[2] }),
        mp4: async key => { if (key.endsWith(ids[0])) throw new Error('network'); return key.endsWith(ids[1]) ? { width: 0, height: 0 } : { width: 1080, height: 1920 }; } };
    assert.deepEqual(await measureVideoShapes('owner', ids, deps), []);
    assert.equal(writes.length, 2); assert.equal(writes[0].p_width, null); assert.equal(writes[0].p_height, null);
});
test('budget prevents late writes and further reads; migration absence is a silent empty success', async () => {
    let writes = 0, reads = 0;
    const result = await measureVideoShapes('owner', ids, { rpc: async name => name.startsWith('list_') ? assets : (++writes, { recorded: true }), mp4: async () => { reads++; await new Promise(resolve => setTimeout(resolve, 30)); return { width: 100, height: 100 }; } }, { budgetMs: 5 });
    assert.deepEqual(result, []);
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(reads, 4); assert.equal(writes, 0);
    for (const code of ['PGRST202', '42883']) assert.deepEqual(await measureVideoShapes('owner', ids, { rpc: async () => { throw { body: { code } }; } }), []);
    await assert.rejects(measureVideoShapes('owner', ids, { rpc: async () => { throw new Error('unavailable'); } }));
});
test('jobs list publishes only valid, unheld measured dimensions and preserves ambiguity', () => {
    const job = { state: 'STORED', has_asset: true, video_width: 1080, video_height: 1920 };
    assert.deepEqual(publicShapeFields(job), { video_width: 1080, video_height: 1920 });
    for (const patch of [{ held: true }, { state: 'FAILED' }, { has_asset: false }, { video_width: '1080' }, { video_height: 0 }]) assert.deepEqual(publicShapeFields({ ...job, ...patch }), {});
    assert.deepEqual(publicShapeFields({ ...job, shape_ambiguous: true }), { shape_ambiguous: true });
});
