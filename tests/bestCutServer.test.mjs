import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { speechAnalysisHandlers } from '../lib/speechAnalysis.js';
import { resolveSpeechUpload } from '../lib/speechUploadSource.js';
import { editorFeatureEnabled } from '../lib/editorRuntimeFlags.mjs';
import { AUTH, JOB, r2 } from './fixtures/speechAnalysisHarness.mjs';
const key = `uploads/${AUTH}/${JOB}.mov`, fingerprint = 'a'.repeat(64);
const env = { EDITOR_RUNTIME_FLAGS: JSON.stringify({ speechCut: 'true', bestCut: 'true' }), UPLOAD_INTEGRITY_ENABLED: 'true', FAL_KEY: 'f'.repeat(40), PUBLIC_HOST: 'https://example.test' };
const req = (body, path = '') => new Request(`https://example.test/api/v1/editor/speech-analyses${path}`, { method: body ? 'POST' : 'GET', headers: { 'x-veyrnox-auth-id': AUTH, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
const input = () => ({ source: { type: 'upload', key }, duration: 12, expectedCredits: 3, idempotencyKey: 'best-cut-request-01', accepts_no_speech: true });
function handlers(extra = {}) {
    const calls = [], submits = [];
    return { calls, submits, ...speechAnalysisHandlers({ env: { ...env, ...extra.env }, cfg: {}, r2cfg: r2,
        select: async table => table === 'model_catalog' ? [{ id: 'elevenlabs-scribe-v2', active: true, provider: 'fal', provider_endpoint: 'fal-ai/elevenlabs/speech-to-text/scribe-v2', credits_5s: 3 }]
            : table === 'upload_reservations' ? [{ r2_key: key, size_bytes: 500 }] : table === 'fal_capacity_policy' ? [{ enabled: false }] : [{ paused: false }],
        resolveUpload: async () => ({ ok: true, r2_key: key, sha256: fingerprint, size_bytes: 500, mime_type: 'video/quicktime', probe: { fingerprint, mime: 'video/quicktime', duration: 12 } }),
        sign: async () => ({ url: 'https://storage.test/file' }), submit: async value => { submits.push(value); return { ok: true, providerJobId: 'provider-1' }; },
        rpc: async (name, args) => {
            calls.push({ name, args }); if (extra.rpc?.[name]) return extra.rpc[name](args);
            if (name === 'speech_analysis_by_key') return { ok: true, found: false };
            if (name === 'speech_analysis_preflight') return { ok: true, cached: true, credits: 0 };
            if (name === 'speech_analysis_request_v2') return { ok: true, fresh: true, id: JOB };
            return { ok: true };
        },
    }) };
}
test('bestCut defaults off and capability quote requires both flags, legacy quote is unchanged', async () => {
    assert.equal(editorFeatureEnabled('BEST_CUT_ENABLED', {}), false);
    const h = handlers({ env: { EDITOR_RUNTIME_FLAGS: '{"speechCut":"true"}' } });
    assert.equal((await h.quote(req(null, '/quote?capability=best-cut'))).status, 501);
    const legacy = await (await h.quote(req(null, '/quote'))).json(); assert.equal(legacy.credits, 3); assert.equal(legacy.source_types, undefined);
    assert.deepEqual((await (await handlers().quote(req(null, '/quote?capability=best-cut'))).json()).source_types, ['job', 'upload']);
});
test('preflight is non-debiting and upload start binds only verified metadata and receipt capability', async () => {
    const h = handlers();
    assert.deepEqual(await (await h.preflight(req({ sources: [input().source] }))).json(), { clips: [{ cached: true, credits: 0 }] });
    assert.ok(!h.calls.some(c => c.name === 'speech_analysis_request_v2')); assert.equal(h.submits.length, 0);
    assert.equal((await h.run(req(input()))).status, 202);
    const args = h.calls.find(c => c.name === 'speech_analysis_request_v2').args;
    assert.equal(args.p_accepts_no_speech, true); assert.equal(args.p_fingerprint, fingerprint); assert.equal(args.p_size, 500); assert.equal(args.p_asset_job_id, null);
    assert.equal(h.submits.length, 1);
});
test('cached amount must explicitly be cacheOnly and expiry returns price_changed without dispatch', async () => {
    const h = handlers({ rpc: { speech_analysis_request_v2: () => ({ ok: false, code: 'PRICE_CHANGED', credits: 3 }) } });
    assert.equal((await h.run(req({ ...input(), expectedCredits: 0 }))).status, 400);
    const result = await h.run(req({ ...input(), expectedCredits: 0, cacheOnly: true }));
    assert.equal(result.status, 409); assert.deepEqual(await result.json(), { error: 'price_changed', credits: 3 }); assert.equal(h.submits.length, 0);
});
test('daily quota and admission closure reject before dispatch', async () => {
    for (const h of [handlers({ rpc: { speech_analysis_request_v2: () => ({ ok: false, code: 'SPEECH_GATE_COOLDOWN' }) } }), handlers({ env: { UPLOAD_HASH_MATCH_REQUIRED: 'true' } }), handlers({ env: { UPLOAD_INTEGRITY_ENABLED: 'false' } })]) {
        assert.ok((await h.run(req(input()))).status >= 400); assert.equal(h.submits.length, 0);
    }
});
test('receipt-specific no-speech replay survives both flags off and never resolves the expired upload', async () => {
    const h = handlers({ env: { EDITOR_RUNTIME_FLAGS: '{}' }, rpc: { speech_analysis_by_key: () => ({ ok: true, found: true, id: JOB, status: 'completed', speech: false, refunded: true, credits: 3, source_ref: key, accepts_no_speech: true }) } });
    assert.deepEqual(await (await h.run(req(input()))).json(), { id: JOB, status: 'completed', speech: false, refunded: true, credits: 3 });
    assert.ok(!h.calls.some(c => c.name === 'speech_source')); assert.equal(h.submits.length, 0);
});
function uploadDeps(patch = {}) {
    const bytes = new Uint8Array([0, 0, 0, 20, ...new TextEncoder().encode('ftypqt  '), 0, 0, 0, 0]);
    return { bytes, deps: { admission: () => ({ ok: true }), sign: async () => ({ url: 'https://storage.test/source' }),
        fetcher: async () => new Response(bytes, { status: 206, headers: { 'Content-Range': 'bytes 0-15/16', 'Content-Type': 'video/quicktime', ETag: '"fixed"' } }),
        stream: async (_, init, timeout, max, chunk) => { assert.equal(init.headers['If-Match'], '"fixed"'); assert.equal(max, 16); chunk(bytes); return { status: 200, bytes: 16 }; },
        probe: async a => ({ fingerprint: a.sha256, duration: 12, mime: a.mime_type }), ...patch } };
}
test('upload identity is a streamed SHA256 of stored bytes, with a bounded content check', async () => {
    const { bytes, deps } = uploadDeps(), result = await resolveSpeechUpload(AUTH, key, r2, deps);
    assert.equal(result.ok, true); assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex')); assert.equal(result.size_bytes, 16);
});
test('foreign key, traversal and a previously uploaded object after admission closes are refused before reading', async () => {
    const { deps } = uploadDeps({ sign: () => { throw Error('must not read'); } });
    for (const candidate of [key.replace(AUTH, JOB), key + '/../file.mov', 'https://caller.test/file.mov']) assert.equal((await resolveSpeechUpload(AUTH, candidate, r2, deps)).ok, false);
    assert.equal((await resolveSpeechUpload(AUTH, key, r2, { ...deps, admission: () => ({ ok: false }) })).code, 'SOURCE_NOT_ADMITTED');
});
test('size/type mismatch, short stream and overly long measured media are refused', async () => {
    for (const patch of [
        { fetcher: async () => new Response(new Uint8Array(16), { status: 206, headers: { 'Content-Range': 'bytes 0-15/104857601', 'Content-Type': 'video/quicktime', ETag: '"fixed"' } }) },
        { fetcher: async () => new Response(new Uint8Array(16), { status: 206, headers: { 'Content-Range': 'bytes 0-15/16', 'Content-Type': 'video/mp4', ETag: '"fixed"' } }) },
        { stream: async () => ({ status: 200, bytes: 15 }) },
        { probe: async () => ({ duration: 61 }) },
    ]) assert.equal((await resolveSpeechUpload(AUTH, key, r2, uploadDeps(patch).deps)).ok, false);
});
test('migration guards: receipt capability, source-independent upload reads, atomic quota, owner erasure and ledger-only money', () => {
    const sql = readFileSync(new URL('../packages/db/schema/supabase/0455_best_cut.sql', import.meta.url), 'utf8');
    assert.match(sql, /speech_analysis_requests ADD COLUMN IF NOT EXISTS accepts_no_speech/);
    assert.match(sql, /IF a.source_kind='job' THEN\s+source:=public.speech_source/);
    assert.match(sql, /SELECT \* INTO quota FROM public.speech_gate_daily WHERE user_id=u FOR UPDATE/);
    assert.ok(sql.indexOf('quota.reserved+') < sql.indexOf('result:=public.ledger_debit'));
    assert.match(sql, /IF p_cache_only OR p_expected_credits IS DISTINCT FROM model.credits_5s/);
    assert.match(sql, /DELETE FROM public.speech_gate_daily WHERE user_id=NEW.id/);
    assert.match(sql, /mp4\|mov\|mp3\|wav/);
    assert.doesNotMatch(sql, /INSERT INTO public.ledger_entries|UPDATE public.credit_balances/);
});
test('preflight meters one hashed clip per call', async () => {
    const h = handlers(); const source = input().source;
    assert.equal((await h.preflight(req({ sources: [source, source] }))).status, 400);
    assert.equal((await h.preflight(req({ sources: [] }))).status, 400);
});
