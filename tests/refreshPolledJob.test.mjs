import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { refreshPolledJob, resetRefreshThrottle, THROTTLE_MS, MIN_AGE_MS, MAX_CONCURRENT } from '../lib/refreshPolledJob.js';
import { catalogSelect, resetCatalogCache, CATALOG_CACHE_MS } from '../lib/catalogReadCache.js';
import { sweepByteplus } from '../lib/byteplusSweep.js';

const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'svc' };
const ID = '11111111-2222-3333-4444-555555555555';
const env = { BYTEPLUS_API_KEY: 'k', GRSAI_API_KEY: 'g', CRUN_API_KEY: 'c', HIGGSFIELD_API_KEY: 'h' };
const fakeSweeps = (calls, applied = 1) => {
    const make = (name) => async (args) => { calls.push({ name, ...args }); return { applied }; };
    return { byteplus: [make('byteplus'), 'BYTEPLUS_API_KEY', null], crun: [make('crun'), 'CRUN_API_KEY', 'CRUN_ENABLED'] };
};
const base = { cfg, env, r2cfg: {}, now: 1_000_000, random: () => 0 };
const old = new Date(base.now - 2 * MIN_AGE_MS).toISOString();
const sub = (extra = {}) => ({ id: ID, provider: 'byteplus', state: 'SUBMITTED', created_at: old, ...extra });

test('settles one SUBMITTED job on a polled provider, limited to that id', async () => {
    resetRefreshThrottle();
    const calls = [];
    const done = await refreshPolledJob({ ...base, job: sub(), sweeps: fakeSweeps(calls) });
    assert.equal(done, true);
    assert.equal(calls[0].onlyJobId, ID);
    assert.equal(calls[0].apiKey, 'k');
});

test('does nothing for fal, a settled job, a missing key or a switched-off provider', async () => {
    resetRefreshThrottle();
    const calls = [];
    const sweeps = fakeSweeps(calls);
    for (const [job, e] of [
        [sub({ provider: 'fal' }), env],
        [sub({ state: 'STORED' }), env],
        [sub(), {}],
        [sub({ provider: 'crun' }), env],
    ]) assert.equal(await refreshPolledJob({ ...base, env: e, job, sweeps }), false);
    assert.equal(calls.length, 0);
});

test('throttles repeated reads of one job and allows it again after the window', async () => {
    resetRefreshThrottle();
    const calls = [];
    const sweeps = fakeSweeps(calls, 0);
    const job = sub();
    await refreshPolledJob({ ...base, job, sweeps });
    await refreshPolledJob({ ...base, now: base.now + THROTTLE_MS - 1, job, sweeps });
    assert.equal(calls.length, 1);
    await refreshPolledJob({ ...base, now: base.now + THROTTLE_MS, job, sweeps });
    assert.equal(calls.length, 2);
});

test('a throwing sweep is swallowed', async () => {
    resetRefreshThrottle();
    const sweeps = { byteplus: [async () => { throw new Error('boom'); }, 'BYTEPLUS_API_KEY', null] };
    assert.equal(await refreshPolledJob({ ...base, job: sub(), sweeps }), false);
});

test('the sweep narrows its jobs query to the one id, and ignores a malformed id', async () => {
    const real = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (url) => {
        const u = new URL(url); urls.push(u);
        return Response.json(u.pathname.endsWith('/model_catalog') ? [{ id: 'm', provider_endpoint: 'byteplus:seedance-2.0-fast' }] : []);
    };
    const r2cfg = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
    try {
        await sweepByteplus({ cfg, r2cfg, apiKey: 'k', onlyJobId: ID });
        assert.equal(urls[1].searchParams.get('id'), `eq.${ID}`);
        await sweepByteplus({ cfg, r2cfg, apiKey: 'k', onlyJobId: 'x&state=eq.STORED' });
        assert.equal(urls[3].searchParams.get('id'), null);
    } finally { globalThis.fetch = real; }
});

test('the job route and the MCP tool are wired to both fixes', () => {
    const route = fs.readFileSync(new URL('../app/api/v1/jobs/[id]/route.js', import.meta.url), 'utf8');
    assert.match(route, /refreshPolledJob\(/);
    const mcp = fs.readFileSync(new URL('../lib/veyrnoxMcp.js', import.meta.url), 'utf8');
    const tool = mcp.slice(mcp.indexOf("registerTool('get_generation'"), mcp.indexOf("registerTool('list_generations'"));
    assert.match(tool, /wait_seconds/);
    assert.match(tool, /MAX_WAIT_SECONDS/);
});

test('a job younger than the minimum age is not checked', async () => {
    resetRefreshThrottle();
    const calls = [];
    const young = sub({ created_at: new Date(base.now - MIN_AGE_MS + 1000).toISOString() });
    assert.equal(await refreshPolledJob({ ...base, job: young, sweeps: fakeSweeps(calls) }), false);
    assert.equal(calls.length, 0);
});

test('jitter pushes the next allowed check later', async () => {
    resetRefreshThrottle();
    const calls = [];
    const sweeps = fakeSweeps(calls, 0);
    await refreshPolledJob({ ...base, random: () => 0.99, job: sub(), sweeps });
    await refreshPolledJob({ ...base, now: base.now + THROTTLE_MS, job: sub(), sweeps });
    assert.equal(calls.length, 1);
});

test('one isolate runs at most MAX_CONCURRENT checks at once and frees the slot afterwards', async () => {
    resetRefreshThrottle();
    let release; const gate = new Promise((r) => { release = r; });
    let started = 0;
    const sweeps = { byteplus: [async () => { started += 1; await gate; return { applied: 0 }; }, 'BYTEPLUS_API_KEY', null] };
    const ids = Array.from({ length: MAX_CONCURRENT + 3 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const runs = ids.map((id) => refreshPolledJob({ ...base, job: sub({ id }), sweeps }));
    await new Promise((r) => setImmediate(r));
    assert.equal(started, MAX_CONCURRENT);
    release(); await Promise.all(runs);
    const again = await refreshPolledJob({ ...base, now: base.now + 60_000, job: sub({ id: ids[MAX_CONCURRENT] }), sweeps });
    assert.equal(again, false);
    assert.equal(started, MAX_CONCURRENT + 1, 'the slot was released');
});

test('catalog reads are cached for check-on-read only, never on the cron path', async () => {
    resetCatalogCache();
    const real = globalThis.fetch; let n = 0;
    globalThis.fetch = async () => { n += 1; return Response.json([{ id: 'm' }]); };
    const q = { columns: 'id', filter: 'x=1' };
    try {
        await catalogSelect('&id=eq.a', 'model_catalog', q, cfg, 0);
        await catalogSelect('&id=eq.b', 'model_catalog', q, cfg, CATALOG_CACHE_MS - 1);
        assert.equal(n, 1);
        await catalogSelect('&id=eq.c', 'model_catalog', q, cfg, CATALOG_CACHE_MS);
        assert.equal(n, 2);
        await catalogSelect('', 'model_catalog', q, cfg, CATALOG_CACHE_MS);
        await catalogSelect('', 'model_catalog', q, cfg, CATALOG_CACHE_MS);
        assert.equal(n, 4);
    } finally { globalThis.fetch = real; }
});
