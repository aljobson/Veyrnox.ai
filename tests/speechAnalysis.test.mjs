import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, body, request, JOB } from './fixtures/speechAnalysisHarness.mjs';
import { fixtures, silence } from './fixtures/speechCut.mjs';
import { submitJob } from '../packages/adapters/fal.js';

test('flag read on each request; unavailable never admits or submits', async () => {
    const f = fixture({ env: { SPEECH_CUT_ENABLED: 'false' } });
    assert.equal((await f.quote(request(null))).status, 501); assert.equal((await f.run(request())).status, 501);
    assert.equal(f.debit(), 0); assert.equal(f.submissions.length, 0);
    f.env.SPEECH_CUT_ENABLED = 'true'; assert.equal((await f.quote(request(null))).status, 200);
});
test('quote and status use only read quota; foreign source/status are 404 without admission', async () => {
    const f = fixture(); const quote = await f.quote(request(null));
    assert.deepEqual(await quote.json(), { credits: 2, max_seconds: 60, languages: fixtures.map(f => f.language) });
    assert.equal(quote.headers.get('cache-control'), 'no-store');
    assert.equal((await f.run(request(body(), '44444444-4444-4444-8444-444444444444'))).status, 404);
    assert.equal((await f.get(request(null, '44444444-4444-4444-8444-444444444444'), JOB)).status, 404);
    assert.equal(f.debit(), 0); assert.ok(f.calls.every(c => c.name !== 'check_generation_rate_limit'));
});
for (const patch of [{ duration: 0 }, { duration: 61 }, { source: { type: 'project', jobId: JOB } }, { extra: true }, { expectedCredits: 1.5 }]) {
    test(`bad request before debit: ${JSON.stringify(patch)}`, async () => {
        const f = fixture(); assert.equal((await f.run(request({ ...body(), ...patch }))).status, 400); assert.equal(f.debit(), 0);
    });
}
test('untrusted duration, unsupported probe and whole sources over 60s fail before debit', async () => {
    for (const [opts, b, code] of [[{}, { ...body(), duration: 10 }, 'duration_mismatch'], [{ probe: async () => null }, body(), 'source_unsupported'], [{ probe: async () => ({ duration: 61 }) }, body(), 'source_too_long']]) {
        const f = fixture(opts); const res = await f.run(request(b)); assert.equal(res.status, 400); assert.equal((await res.json()).error, code); assert.equal(f.debit(), 0);
    }
});
test('atomic price change returns new quote, no debit', async () => {
    const f = fixture(); const res = await f.run(request({ ...body(), expectedCredits: 1 }));
    assert.equal(res.status, 409); assert.deepEqual(await res.json(), { error: 'price_changed', credits: 2 }); assert.equal(f.debit(), 0);
});
test('one admission and submit per key; replay bypasses generation capacity and provider configuration', async () => {
    const f = fixture(); assert.equal((await f.run(request())).status, 202);
    f.env.FAL_KEY = ''; assert.equal((await f.run(request())).status, 202);
    assert.equal(f.debit(), 1); assert.equal(f.submissions.length, 1);
    const [job, cfg] = f.submissions[0]; assert.equal(cfg.sanitisedSubmission, true);
    assert.equal(new URL(cfg.webhookBaseUrl).origin, 'https://worker.test'); assert.ok(new URL(cfg.webhookBaseUrl).searchParams.has('speech_token'));
    assert.equal(job.inputs.audio_url, 'https://r2.test/source?signature=PRIVATE');
});
test('pre-submit failure and definitive rejection refund once; replay cannot resubmit', async () => {
    for (const options of [{ sign: async () => { throw Error('PRIVATE'); } }, { submit: { outcome: 'rejected' } }]) {
        const f = fixture(options); const res = await f.run(request()); assert.equal(res.status, 502); assert.equal((await res.json()).refunded, true);
        assert.equal((await (await f.run(request())).json()).error, 'request_failed_refunded'); assert.equal(f.refunds(), 1); assert.equal(f.debit(), 1);
    }
});
for (const opts of [{ submit: { outcome: 'unknown' } }, { submitThrow: true }, { lostAck: true }]) {
    test(`ambiguous dispatch/ack then late webhook succeeds without refund: ${JSON.stringify(opts)}`, async () => {
        const f = fixture(opts); assert.equal((await f.run(request())).status, 202); assert.equal(f.refunds(), 0);
        assert.equal((await f.callback()).status, 200); assert.equal(f.job().state, 'STORED'); assert.equal(f.refunds(), 0);
        assert.equal((await f.run(request())).status, 200); assert.equal(f.submissions.length, 1);
    });
}
test('unknown dispatch swept then late success is ignored and closed', async () => {
    const f = fixture({ submit: { outcome: 'unknown' } }); await f.run(request());
    // RPC timeout policy itself is exercised against Postgres in acceptance.
    await f.rpc('speech_analysis_fail', { p_job_id: JOB, p_code: 'analysis_timeout' });
    assert.equal((await f.callback()).status, 200); assert.equal(f.job().state, 'REFUNDED'); assert.equal(f.refunds(), 1);
});
test('signed webhook success persists bounded analysis and metadata only, dedupes retries', async () => {
    const f = fixture(); await f.run(request()); await f.callback({}, false); await f.callback({}, false);
    assert.equal(f.job().state, 'STORED'); assert.equal(f.job().analysis.language, 'en'); assert.equal(f.refunds(), 0);
    assert.equal(f.calls.filter(c => c.name === 'speech_analysis_complete').length, 1);
    assert.deepEqual(Object.keys(f.events.get('provider-1').payload).sort(), ['byte_size', 'request_id', 'status']);
    assert.doesNotMatch(JSON.stringify([...f.events.values()]), /I would|coffee|ATTACKER/);
    assert.ok(f.calls.filter(c => c.name.startsWith('speech_analysis_')).every(c => !Object.values(c.args).includes('ATTACKER')));
});
for (const event of [{ status: 'ERROR', error: 'PRIVATE transcript' }, { payload: { words: [{ type: 'word', text: 'secret', start: -1, end: 1 }] } }, { payload: silence }]) {
    test(`provider error/invalid/silent analysis refunds once: ${JSON.stringify(event)}`, async () => {
        const f = fixture(); await f.run(request()); await f.callback(event); await f.callback(event); assert.equal(f.refunds(), 1); assert.equal(f.job().status, 'failed');
        assert.equal((await (await f.get(request(null), JOB)).json()).refunded, true);
    });
}
test('bad signature stops before lookup or webhook event write', async () => {
    const f = fixture(); f.verify(false); const res = await f.callback(); assert.equal(res.status, 401); assert.equal(f.calls.length, 0); assert.equal(f.events.size, 0);
});
test('cache reuse and in-flight joins persist separate key identities and never resubmit', async () => {
    const f = fixture(); await f.run(request());
    const joined = await (await f.run(request({ ...body(), idempotencyKey: 'joined-key' }))).json(); assert.equal(joined.reused, 'in_flight');
    await f.callback(); const reused = await (await f.run(request({ ...body(), idempotencyKey: 'cached-key' }))).json(); assert.equal(reused.reused, true);
    f.env.SPEECH_CUT_ENABLED = 'false'; assert.equal((await f.byKey(request(null), 'joined-key')).status, 200);
    assert.equal(f.debit(), 1); assert.equal(f.submissions.length, 1);
});
test('joiner retry after failure returns mapped current failure, no new work', async () => {
    const f = fixture(); await f.run(request()); const joined = { ...body(), idempotencyKey: 'joined-key' }; await f.run(request(joined)); await f.callback({ status: 'ERROR' });
    assert.deepEqual(await (await f.run(request(joined))).json(), { error: 'request_failed_refunded', refunded: true }); assert.equal(f.debit(), 1);
});
test('expired receipt returns 410, never new admission', async () => {
    const f = fixture({ rpc: { speech_analysis_by_key: async () => ({ ok: false, found: true, code: 'RESULT_EXPIRED', digest: (await import('node:crypto')).createHash('sha256').update(`${body().source.jobId}:${'a'.repeat(64)}:1`).digest('hex') }) } });
    assert.equal((await f.run(request())).status, 410); assert.equal(f.debit(), 0);
});
test('digest mismatch is a conflict, not new work', async () => {
    const f = fixture({ rpc: { speech_analysis_by_key: async () => ({ ok: true, found: true, digest: 'wrong' }) } });
    assert.equal((await f.run(request())).status, 409); assert.equal(f.debit(), 0);
});
test('source removed before late callback is refunded and ignored', async () => {
    const f = fixture(); await f.run(request()); f.options.removed = true; await f.callback(); assert.equal(f.job().state, 'REFUNDED'); assert.equal(f.job().analysis, undefined);
    assert.equal((await f.get(request(null), JOB)).status, 404);
});
test('submission sanitization suppresses echoed URL/body and exception text; ordinary callers unchanged', async t => {
    const lines = []; t.mock.method(console, 'error', (...args) => lines.push(args));
    const job = { job_id: JOB, provider_endpoint: 'fal-ai/test', inputs: {} }, cfg = { falKey: 'test', webhookBaseUrl: 'https://worker.test/api/webhook/fal' };
    for (const fetcher of [async () => new Response('https://r2.test/?signed=SECRET transcript', { status: 400 }), async () => { throw Error('https://r2.test/?signed=SECRET'); }]) {
        const result = await submitJob(job, { ...cfg, sanitisedSubmission: true }, fetcher);
        assert.doesNotMatch(JSON.stringify(result), /https|SECRET|transcript/);
    }
    assert.doesNotMatch(JSON.stringify(lines), /https|SECRET|transcript/);
    await submitJob(job, cfg, async () => new Response('ordinary-body', { status: 400 })); assert.match(JSON.stringify(lines), /ordinary-body/);
});
test('no transcript/provider payload in any handler logs or responses on errors', async t => {
    const lines = []; for (const method of ['error', 'warn', 'log', 'info']) t.mock.method(console, method, (...args) => lines.push(args));
    const f = fixture({ submitThrow: true }); await f.run(request()); await f.callback({ status: 'ERROR', error: 'PRIVATE transcript' }); await f.callback();
    assert.doesNotMatch(JSON.stringify(lines), /PRIVATE|transcript|coffee|https/);
});

test('inactive catalog refuses quote and new admission even with the feature flag on', async () => {
    const f = fixture({ inactive: true }); assert.equal((await f.quote(request(null))).status, 501);
    assert.equal((await f.run(request())).status, 501); assert.equal(f.debit(), 0); assert.equal(f.submissions.length, 0);
});
test('valid provider signature does not authorize a forged correlation token', async () => {
    const f = fixture(); await f.run(request()); const before = f.calls.length;
    const response = await f.webhook(new Request(`https://worker.test/api/webhook/fal?job_id=${JOB}&speech_token=${'0'.repeat(64)}`, {
        method: 'POST', headers: { 'x-fal-webhook-request-id': 'provider-1' }, body: JSON.stringify({ request_id: 'provider-1', status: 'OK' }),
    }));
    assert.equal(response.status, 401); assert.equal(f.calls.length, before); assert.equal(f.events.size, 0);
});
test('reserved admission refusal stays typed and never dispatches', async () => {
    const f = fixture({ rpc: { speech_analysis_request: async () => ({ ok: false, code: 'PROVIDER_ADMISSION_PAUSED' }) } });
    const response = await f.run(request()); assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'provider_admission_paused' });
    assert.equal(f.debit(), 0); assert.equal(f.submissions.length, 0);
});
test('quote hides speech rows while fal is paused, reserved-only or missing policy; reads/replays remain available', async () => {
    for (const patch of [{ paused: true }, { capacity: true }, { missingPolicy: true }]) {
        const f = fixture(); await f.run(request()); Object.assign(f.options, patch);
        const quote = await f.quote(request(null)); assert.equal(quote.status, 501);
        assert.deepEqual(await quote.json(), { error: 'speech_cut_unavailable' });
        assert.equal((await f.get(request(null), JOB)).status, 202);
        assert.equal((await f.run(request())).status, 202);
        assert.equal(f.debit(), 1); assert.equal(f.submissions.length, 1);
    }
});
test('matching stored probe avoids another range read; mismatched fingerprint or MIME must probe again', async () => {
    const stored = { duration: 12, mime: 'video/mp4', fingerprint: 'a'.repeat(64) };
    for (const patch of [{}, { fingerprint: 'b'.repeat(64) }, { mime: 'audio/wav' }]) {
        let probes = 0;
        const f = fixture({ asset: { probe: { ...stored, ...patch } }, probe: async () => { probes++; return stored; } });
        assert.equal((await f.run(request())).status, 202);
        assert.equal(probes, Object.keys(patch).length ? 1 : 0);
        assert.equal(f.calls.filter(c => c.name === 'speech_source_probe_store').length, probes);
    }
});
test('oversized or implausible bytes/second sources fail before debit, including cached probes', async () => {
    for (const [size, cached] of [[100 * 1024 * 1024 + 1, false], [25 * 1024 * 1024, false], [25 * 1024 * 1024, true]]) {
        let probes = 0;
        const measured = { duration: 12, mime: 'video/mp4', fingerprint: 'a'.repeat(64) };
        const f = fixture({ asset: { size_bytes: size, ...(cached ? { probe: measured } : {}) }, probe: async () => { probes++; return measured; } });
        const res = await f.run(request()); assert.equal(res.status, 400); assert.deepEqual(await res.json(), { error: 'source_unsupported' });
        assert.equal(f.debit(), 0); assert.equal(f.submissions.length, 0);
        assert.equal(probes, cached || size > 100 * 1024 * 1024 ? 0 : 1);
    }
});
test('webhook operational failures log only a typed code and job id', async t => {
    const lines = []; t.mock.method(console, 'error', (...args) => lines.push(args));
    for (const [name, response, expected] of [
        ['speech_analysis_callback', () => { throw Error('PRIVATE transcript https://r2.test/?signed=SECRET'); }, 'callback_unavailable'],
        ['speech_analysis_callback', () => ({ ok: false, code: 'PRIVATE' }), 'callback_unavailable'],
        ['speech_analysis_complete', () => ({ ok: false, code: 'PRIVATE' }), 'settlement_unavailable'],
    ]) {
        const f = fixture({ rpc: { [name]: response } }); await f.run(request());
        assert.equal((await f.callback()).status, 503);
        assert.deepEqual(lines.at(-1), ['[speech-webhook]', expected, JOB]);
    }
    assert.equal(lines.length, 3); assert.doesNotMatch(JSON.stringify(lines), /PRIVATE|transcript|https|SECRET/);
});
