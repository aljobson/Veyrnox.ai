import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { reapAssets, MAX_ATTEMPTS } from '../lib/assetReap.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service-role-test' };
const r2cfg = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };

/** PostgREST + R2, in memory. `bad` keys fail their DELETE. */
function world(rows, { bad = [], protectedKeys = [] } = {}) {
    const calls = { deleted: [], patched: [], removed: [], queueUrl: null };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        if (u.pathname.endsWith('/rpc/asset_reap_allowed')) return Response.json(!protectedKeys.includes(JSON.parse(init.body).p_key));
        if (u.hostname.endsWith('r2.cloudflarestorage.com')) {
            const key = decodeURIComponent(u.pathname.replace(`/${r2cfg.bucket}/`, ''));
            calls.deleted.push(key);
            return new Response(null, { status: bad.includes(key) ? 500 : 204 });
        }
        if (init.method === 'DELETE') { calls.removed.push(u.searchParams.get('id')); return new Response(null, { status: 204 }); }
        if (init.method === 'PATCH') { calls.patched.push({ id: u.searchParams.get('id'), body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
        calls.queueUrl = u;
        const due = rows.filter(row => !calls.patched.some(p => p.id === `eq.${row.id}` && Date.parse(p.body.not_before) > Date.now()) && !calls.removed.includes(`eq.${row.id}`));
        return Response.json(due.slice(0, Number(u.searchParams.get('limit')) || due.length));
    };
    return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

test('deletes each queued object and clears its row', async () => {
    const w = world([{ id: '1', r2_key: 'jobs/a.mp4', attempts: 0 }, { id: '2', r2_key: 'jobs/b.png', attempts: 0 }]);
    try {
        const out = await reapAssets(cfg, r2cfg);
        assert.deepEqual(out, { ok: true, processed: 2, deleted: 2, failed: 0, skipped: 0 });
        assert.deepEqual(w.calls.deleted, ['jobs/a.mp4', 'jobs/b.png']);
        assert.deepEqual(w.calls.removed, ['eq.1', 'eq.2']);
        assert.equal(w.calls.patched.length, 0);
    } finally { w.restore(); }
});

test('a key that will not delete keeps its place, with the attempt and the reason', async () => {
    const w = world([{ id: '1', r2_key: 'jobs/gone.mp4', attempts: 3 }], { bad: ['jobs/gone.mp4'] });
    try {
        const out = await reapAssets(cfg, r2cfg);
        assert.deepEqual(out, { ok: true, processed: 1, deleted: 0, failed: 1, skipped: 0 });
        assert.equal(w.calls.removed.length, 0, 'the row is not dropped');
        assert.equal(w.calls.patched[0].id, 'eq.1');
        assert.equal(w.calls.patched[0].body.attempts, 4);
        assert.ok(w.calls.patched[0].body.last_error, 'the reason is recorded');
    } finally { w.restore(); }
});

test('rows past the attempt ceiling are left for a human, not retried every tick', async () => {
    const w = world([]);
    try {
        await reapAssets(cfg, r2cfg);
        assert.equal(w.calls.queueUrl.searchParams.get('attempts'), `lt.${MAX_ATTEMPTS}`);
    } finally { w.restore(); }
});

test('a queue read failure is reported, not swallowed', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 503 });
    try {
        assert.deepEqual(await reapAssets(cfg, r2cfg), { ok: false, error: 'queue read 503' });
    } finally { globalThis.fetch = realFetch; }
});

test('the five-minute cron drains the queue', () => {
    const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
    assert.match(worker, /runAssetReap\(env\), env\)/);
    assert.match(worker, /const out = await reapAssets\(cfg, r2cfg\);/);
});

test('a rejected queue delete does not claim completion or patch an attempt', async () => {
    const w = world([{ id: '1', r2_key: 'jobs/a.mp4', attempts: 0 }]);
    const fetchWorld = globalThis.fetch;
    globalThis.fetch = (url, init) => String(url).includes('db.test') && init?.method === 'DELETE'
        ? Promise.resolve(new Response(null, { status: 503 })) : fetchWorld(url, init);
    try {
        const out = await reapAssets(cfg, r2cfg);
        assert.equal(out.ok, false);
        assert.equal(out.deleted, 0);
        assert.equal(w.calls.patched.length, 0);
    } finally { w.restore(); }
});

test('a failed attempt update is reported once and never silently retried', async () => {
    const w = world([{ id: '1', r2_key: 'jobs/a.mp4', attempts: 0 }], { bad: ['jobs/a.mp4'] });
    const fetchWorld = globalThis.fetch;
    let patches = 0;
    globalThis.fetch = (url, init) => {
        if (init?.method === 'PATCH') { patches++; return Promise.resolve(new Response(null, { status: 503 })); }
        return fetchWorld(url, init);
    };
    try {
        assert.equal((await reapAssets(cfg, r2cfg)).ok, false);
        assert.equal(patches, 1);
    } finally { w.restore(); }
});

test('a hold created after the queue snapshot prevents deletion and leaves evidence untouched', async () => {
    const w = world([{ id: 'held', r2_key: 'editor-renders/owner/result.mp4', attempts: 0 }]);
    const previous = globalThis.fetch;
    globalThis.fetch = (url, init) => String(url).includes('/rpc/asset_reap_allowed')
        ? Promise.resolve(Response.json(false)) : previous(url, init);
    try {
        const out = await reapAssets(cfg, r2cfg);
        assert.equal(out.deleted, 0);
        assert.deepEqual(w.calls.deleted, []);
        assert.deepEqual(w.calls.removed, []);
        assert.equal(out.skipped, 1);
        assert.equal(w.calls.patched.length, 1);
        assert.ok(Date.parse(w.calls.patched[0].body.not_before) > Date.now() + 23 * 3600000);
        assert.equal(w.calls.patched[0].body.attempts, undefined);
    } finally { w.restore(); }
});
test('an unavailable hold check fails closed without deleting bytes', async () => {
    const w = world([{ id: 'held', r2_key: 'editor-renders/owner/result.mp4', attempts: 0 }]);
    const previous = globalThis.fetch;
    globalThis.fetch = (url, init) => String(url).includes('/rpc/asset_reap_allowed')
        ? Promise.resolve(new Response(null, { status: 503 })) : previous(url, init);
    try {
        const result = await reapAssets(cfg, r2cfg);
        assert.equal(result.deleted, 0); assert.equal(result.skipped, 1);
        assert.equal(result.failed, 0); assert.deepEqual(w.calls.deleted, []);
        assert.deepEqual(w.calls.patched, []); assert.deepEqual(w.calls.removed, []);
    }
    finally { w.restore(); }
});

test('a batch of held or live-asset keys is deferred so the next eligible object can be reaped', async () => {
    const rows = Array.from({ length: 100 }, (_, id) => ({ id: String(id), r2_key: `protected/${id}`, attempts: 2 }));
    const w = world([...rows, { id: 'next', r2_key: 'deleted-asset/output', attempts: 0 }], { protectedKeys: rows.map(r => r.r2_key) });
    try {
        const first = await reapAssets(cfg, r2cfg);
        assert.equal(first.skipped, 100); assert.equal(first.failed, 0); assert.equal(first.deleted, 0);
        assert.equal(w.calls.patched.length, 100);
        assert.ok(w.calls.patched.every(p => p.body.attempts === undefined));
        const second = await reapAssets(cfg, r2cfg);
        assert.equal(second.processed, 1); assert.equal(second.deleted, 1); assert.equal(second.skipped, 0);
        assert.deepEqual(w.calls.deleted, ['deleted-asset/output']);
    } finally { w.restore(); }
});

test('one-release fallback drains the legacy queue when 0397 not_before is missing', async () => {
    const w = world([{ id: 'legacy', r2_key: 'jobs/legacy.mp4', attempts: 0 }]);
    const previous = globalThis.fetch; let reads = 0;
    globalThis.fetch = (input, init) => {
        const url = new URL(input);
        if (url.pathname.endsWith('/asset_reap_queue') && !init?.method) {
            reads++;
            if (url.searchParams.has('not_before')) return Promise.resolve(Response.json({ code: '42703', message: 'column asset_reap_queue.not_before does not exist' }, { status: 400 }));
        }
        return previous(input, init);
    };
    try { assert.equal((await reapAssets(cfg, r2cfg)).deleted, 1); assert.equal(reads, 2); }
    finally { w.restore(); }
});
test('only a missing authorization RPC permits the legacy fallback', async () => {
    for (const [status, code, message, deleted] of [
        [404, 'PGRST202', 'Could not find public.asset_reap_allowed', 1],
        [404, 'PGRST202', 'Could not find public.other_function', 0],
        [403, '42501', 'permission denied for asset_reap_allowed', 0],
        [500, 'XX000', 'asset_reap_allowed internal error', 0],
    ]) {
        const w = world([{ id: 'legacy', r2_key: 'jobs/legacy.mp4', attempts: 0 }]);
        const previous = globalThis.fetch;
        globalThis.fetch = (input, init) => String(input).includes('/rpc/asset_reap_allowed')
            ? Promise.resolve(Response.json({ code, message }, { status })) : previous(input, init);
        try {
            const result = await reapAssets(cfg, r2cfg);
            assert.equal(result.deleted, deleted); assert.equal(result.skipped, 1 - deleted);
            assert.equal(w.calls.patched.length, 0);
        } finally { w.restore(); }
    }
});
