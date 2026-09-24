import test from 'node:test';
import assert from 'node:assert/strict';
import { completeJob } from '../lib/providerCompletion.js';
import { copyUrlToR2 } from '../packages/adapters/r2Copy.js';

Object.assign(process.env, { R2_ACCOUNT_ID: 'acc', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_BUCKET: 'b' });
const cfg = { supabaseUrl: 'https://db.test', serviceRoleKey: 'svc' };
const job = { id: 'job-1', user_id: 'user-1', credits: 19, state: 'SUBMITTED' };

// Fake network: records RPC names and answers per scenario.
function fakeNet({ dedup = [{ id: 'row' }], processedAt = 'x', rpcs = {}, source = () => new Response('vid', { status: 200, headers: { 'content-type': 'video/mp4' } }) }) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        if (u.includes('/rest/v1/rpc/')) {
            const name = u.split('/rpc/')[1];
            calls.push({ name, args: JSON.parse(init.body) });
            return Response.json(rpcs[name] ?? { ok: true });
        }
        if (u.includes('/rest/v1/webhook_events')) {
            if (init.method === 'POST') return Response.json(dedup, { status: 201 });
            if (init.method === 'PATCH') { calls.push({ name: 'processed' }); return new Response(null, { status: 204 }); }
            return Response.json([{ processed_at: processedAt }]);
        }
        if (u.includes('r2.cloudflarestorage.com')) { calls.push({ name: 'r2_put' }); return new Response(null, { status: 200 }); }
        calls.push({ name: 'source', url: u, auth: init.headers && init.headers.Authorization });
        return source();
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}

test('success copies the output and stores the job', async () => {
    const net = fakeNet({});
    try {
        const r = await completeJob({ source: 'kie', job, providerJobId: 't1', outcome: { state: 'success', outputUrl: 'https://tempfile.aiquickdraw.com/a.mp4' }, ext: '.mp4', cfg });
        assert.equal(r.status, 200);
        assert.deepEqual(net.calls.map((c) => c.name), ['job_succeeded', 'source', 'r2_put', 'job_stored', 'processed']);
    } finally { net.restore(); }
});

test('failure refunds the job facts from our row, not the callback', async () => {
    const net = fakeNet({});
    try {
        const r = await completeJob({ source: 'kie', job, providerJobId: 't1', outcome: { state: 'fail', errorCode: 'nsfw' }, ext: '', cfg });
        assert.equal(r.status, 200);
        const refund = net.calls.find((c) => c.name === 'ledger_refund');
        assert.deepEqual(refund.args, { p_job_id: 'job-1', p_user_id: 'user-1', p_credits: 19, p_reason: 'refund:provider_failed' });
    } finally { net.restore(); }
});

test('no refund when job_failed refuses a job that is not FAILED', async () => {
    const net = fakeNet({ rpcs: { job_failed: { ok: false, code: 'INVALID_STATE' } } });
    try {
        await completeJob({ source: 'kie', job: { ...job, state: 'STORED' }, providerJobId: 't1', outcome: { state: 'fail', errorCode: 'x' }, ext: '', cfg });
        assert.equal(net.calls.some((c) => c.name === 'ledger_refund'), false);
    } finally { net.restore(); }
});

test('a processed duplicate has no side effects', async () => {
    const net = fakeNet({ dedup: [], processedAt: '2026-09-12T00:00:00Z' });
    try {
        const r = await completeJob({ source: 'kie', job, providerJobId: 't1', outcome: { state: 'fail', errorCode: 'x' }, ext: '', cfg });
        assert.equal(r.body.duplicate, true);
        assert.equal(net.calls.length, 0);
    } finally { net.restore(); }
});

test('a transient copy failure answers 500 and stays unprocessed', async () => {
    const net = fakeNet({ source: () => new Response('no', { status: 503 }) });
    try {
        const r = await completeJob({ source: 'kie', job, providerJobId: 't1', outcome: { state: 'success', outputUrl: 'https://tempfile.aiquickdraw.com/a.mp4' }, ext: '.mp4', cfg });
        assert.equal(r.status, 500);
        assert.equal(net.calls.some((c) => c.name === 'processed' || c.name === 'job_stored'), false);
    } finally { net.restore(); }
});

test('OpenRouter download carries the key only to openrouter.ai', async () => {
    const r2 = { accountId: 'acc', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
    assert.equal((await copyUrlToR2('https://evil.example.com/x', 'k', r2, { provider: 'openrouter', authorization: 'Bearer x' })).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('https://openrouter.ai.evil.com/x', 'k', r2, { provider: 'openrouter', authorization: 'Bearer x' })).error, 'source host not allowed');
    assert.equal((await copyUrlToR2('https://tempfile.aiquickdraw.com/x', 'k', r2, { provider: 'kie', authorization: 'Bearer x' })).error, 'source auth not allowed');
    const net = fakeNet({});
    try {
        await copyUrlToR2('https://openrouter.ai/api/v1/videos/v1/content?index=0', 'k', r2, { provider: 'openrouter', authorization: 'Bearer key' });
        assert.equal(net.calls.find((c) => c.name === 'source').auth, 'Bearer key');
    } finally { net.restore(); }
});

// The digest reaches the database, not just the adapter's return value.
test('job_stored receives the content hash', async () => {
    const net = fakeNet({});
    try {
        await completeJob({ source: 'kie', job, providerJobId: 't1', outcome: { state: 'success', outputUrl: 'https://tempfile.aiquickdraw.com/a.mp4' }, ext: '.mp4', cfg });
        const stored = net.calls.find((c) => c.name === 'job_stored');
        // SHA-256 of the fake source body, "vid".
        assert.match(stored.args.p_sha256, /^[0-9a-f]{64}$/);
    } finally { net.restore(); }
});

test('GrsAI scheduled completion uses explicit R2 config and keeps the key off the CDN', async () => {
    const saved = process.env.R2_ACCOUNT_ID;
    delete process.env.R2_ACCOUNT_ID;
    const net = fakeNet({ source: () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 0, 0, 0, 0])) });
    try {
        const r = await completeJob({ source: 'grsai', job, providerJobId: 'grs-1',
            outcome: { state: 'success', outputUrl: 'https://file6.aitohumanize.com/a.png' }, ext: '.png', cfg,
            r2cfg: { accountId: 'cron-account', accessKeyId: 'key', secretAccessKey: 'secret', bucket: 'bucket' },
        });
        assert.equal(r.status, 200);
        assert.equal(net.calls.find((c) => c.name === 'source').auth, undefined);
        assert.equal(net.calls.find((c) => c.name === 'job_stored').args.p_provider, 'grsai');
        assert.equal(net.calls.find((c) => c.name === 'job_stored').args.p_mime_type, 'image/png');
    } finally { net.restore(); process.env.R2_ACCOUNT_ID = saved; }
});

test('GrsAI accepts only its verified exact CDN host and refuses redirects', async () => {
    const r2cfg = { accountId: 'a', accessKeyId: 'k', secretAccessKey: 's', bucket: 'b' };
    const net = fakeNet({ source: () => new Response(null, { status: 302, headers: { location: 'https://evil.test/a' } }) });
    try {
        for (const host of ['file6.aitohumanize.com.evil.test', 'file7.aitohumanize.com', 'aitohumanize.com', 'tempfile.aiquickdraw.com', 'localhost']) {
            assert.equal((await copyUrlToR2(`https://${host}/a.png`, 'key', r2cfg, { provider: 'grsai' })).error, 'source host not allowed');
        }
        assert.equal(net.calls.length, 0);
        assert.equal((await copyUrlToR2('https://file6.aitohumanize.com/a.png', 'key', r2cfg, { provider: 'grsai' })).error, 'source 302');
        assert.equal(net.calls.filter((c) => c.name === 'source').length, 1);
        assert.equal(net.calls.some((c) => c.name === 'r2_put'), false);
    } finally { net.restore(); }
});

test('GrsAI provider failure refunds once; processed replay has no side effects', async () => {
    const call = { source: 'grsai', job: { ...job, credits: 2 }, providerJobId: 'grs-2',
        outcome: { state: 'fail', errorCode: 'provider_error' }, ext: '.png', cfg };
    let net = fakeNet({});
    try {
        await completeJob(call);
        assert.equal(net.calls.find((c) => c.name === 'ledger_refund').args.p_credits, 2);
    } finally { net.restore(); }
    net = fakeNet({ dedup: [], processedAt: 'done' });
    try {
        assert.equal((await completeJob(call)).body.duplicate, true);
        assert.equal(net.calls.length, 0);
    } finally { net.restore(); }
});
