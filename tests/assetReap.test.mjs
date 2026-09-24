import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { reapAssets, MAX_ATTEMPTS } from '../lib/assetReap.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'service-role-test' };
const r2cfg = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };

/** PostgREST + R2, in memory. `bad` keys fail their DELETE. */
function world(rows, { bad = [] } = {}) {
    const calls = { deleted: [], patched: [], removed: [], queueUrl: null };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        if (u.hostname.endsWith('r2.cloudflarestorage.com')) {
            const key = decodeURIComponent(u.pathname.replace(`/${r2cfg.bucket}/`, ''));
            calls.deleted.push(key);
            return new Response(null, { status: bad.includes(key) ? 500 : 204 });
        }
        if (init.method === 'DELETE') { calls.removed.push(u.searchParams.get('id')); return new Response(null, { status: 204 }); }
        if (init.method === 'PATCH') { calls.patched.push({ id: u.searchParams.get('id'), body: JSON.parse(init.body) }); return new Response(null, { status: 204 }); }
        calls.queueUrl = u;
        return Response.json(rows);
    };
    return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

test('deletes each queued object and clears its row', async () => {
    const w = world([{ id: '1', r2_key: 'jobs/a.mp4', attempts: 0 }, { id: '2', r2_key: 'jobs/b.png', attempts: 0 }]);
    try {
        const out = await reapAssets(cfg, r2cfg);
        assert.deepEqual(out, { ok: true, processed: 2, deleted: 2, failed: 0 });
        assert.deepEqual(w.calls.deleted, ['jobs/a.mp4', 'jobs/b.png']);
        assert.deepEqual(w.calls.removed, ['eq.1', 'eq.2']);
        assert.equal(w.calls.patched.length, 0);
    } finally { w.restore(); }
});

test('a key that will not delete keeps its place, with the attempt and the reason', async () => {
    const w = world([{ id: '1', r2_key: 'jobs/gone.mp4', attempts: 3 }], { bad: ['jobs/gone.mp4'] });
    try {
        const out = await reapAssets(cfg, r2cfg);
        assert.deepEqual(out, { ok: true, processed: 1, deleted: 0, failed: 1 });
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
