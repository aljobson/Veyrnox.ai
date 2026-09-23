import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

import { parseEditInputs, resolveEdit } from '../lib/clipEditSources.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-test',
    FAL_KEY: 'fal-test',
    KIE_API_KEY: 'kie-test',
    OPENROUTER_API_KEY: 'or-test',
    PUBLIC_HOST: 'https://veyrnox.test',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKIDTEST',
    R2_SECRET_ACCESS_KEY: 'secret-test',
    R2_BUCKET: 'veyrnox-test',
});
const generations = await import('../app/api/v1/generations/route.js');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const M = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const ASSETS = {
    [A]: { ok: true, state: 'STORED', mime_type: 'video/mp4', r2_key: 'jobs/a.mp4', size_bytes: 900 },
    [B]: { ok: true, state: 'STORED', mime_type: 'video/mp4', r2_key: 'jobs/b.mp4', size_bytes: 900 },
    [M]: { ok: true, state: 'STORED', mime_type: 'audio/mpeg', r2_key: 'jobs/m.mp3', size_bytes: 900 },
};
const FRAMES = { 'jobs/a.mp4': { seconds: 5, width: 720, height: 1280 }, 'jobs/b.mp4': { seconds: 8, width: 720, height: 1280 } };
const deps = (frames = FRAMES) => ({
    asset: async (_auth, id) => ASSETS[id] || { ok: false, code: 'NOT_FOUND' },
    mp4: async (key) => frames[key] || null,
});

test('parseEditInputs refuses unknown keys, bad ids, junk numbers and too many clips', () => {
    const clip = { asset_id: A, in_s: 0, out_s: 2 };
    assert.equal(parseEditInputs({ clips: [clip] }).ok, true);
    assert.equal(parseEditInputs({ clips: [{ ...clip, key: 'x' }] }).ok, false, 'no client-supplied R2 key');
    assert.equal(parseEditInputs({ clips: [{ ...clip, asset_id: '../x' }] }).ok, false);
    assert.equal(parseEditInputs({ clips: [{ ...clip, out_s: '2' }] }).ok, false);
    assert.equal(parseEditInputs({ clips: [{ ...clip, out_s: Infinity }] }).ok, false);
    assert.equal(parseEditInputs({ clips: Array(11).fill(clip) }).ok, false);
    assert.equal(parseEditInputs({ clips: [clip], audio: { asset_id: M, offset_s: -1 } }).ok, false);
    // Refused on the client's own arithmetic, before any lookup or R2 read.
    assert.equal(parseEditInputs({ clips: Array(10).fill({ asset_id: A, in_s: 0, out_s: 30 }) }).error, 'too_long');
    assert.equal(parseEditInputs({ clips: [{ asset_id: A, in_s: 5, out_s: 5 }] }).error, 'inputs_invalid:clips');
});

test('an edit that is too long by the client\'s own numbers costs no lookup and no R2 read', async () => {
    let touched = 0;
    const counting = { asset: async () => { touched += 1; return null; }, mp4: async () => { touched += 1; return null; } };
    const r = await resolveEdit('auth-1', { clips: Array(10).fill({ asset_id: A, in_s: 0, out_s: 30 }) }, counting);
    assert.deepEqual(r, { ok: false, error: 'too_long', status: 400 });
    assert.equal(touched, 0, 'nothing was resolved');
});

test('resolveEdit uses the stored length and frame, never the client', async () => {
    const r = await resolveEdit('auth-1', { clips: [{ asset_id: A, in_s: 1, out_s: 4 }, { asset_id: B, in_s: 0, out_s: 8 }], audio: { asset_id: M, offset_s: 0 } }, deps());
    assert.equal(r.ok, true);
    assert.deepEqual(r.edit.clips.map((c) => [c.key, c.whole]), [['jobs/a.mp4', false], ['jobs/b.mp4', true]]);
    assert.equal(r.edit.output_s, 11);
    assert.deepEqual(r.edit.audio, { key: 'jobs/m.mp3', offset_s: 0 });
    // A cut past the real end is refused even though the client did not say how long the clip is.
    assert.equal((await resolveEdit('auth-1', { clips: [{ asset_id: A, in_s: 0, out_s: 6 }] }, deps())).error, 'clip_range');
});

test('resolveEdit refuses another user\'s Asset, the wrong media, mixed frames and unreadable files', async () => {
    const one = (id, extra = {}) => ({ clips: [{ asset_id: id, in_s: 0, out_s: 2 }], ...extra });
    assert.deepEqual(await resolveEdit('auth-1', one(OTHER), deps()), { ok: false, error: 'asset_not_found', status: 404 });
    assert.equal((await resolveEdit('auth-1', one(M), deps())).error, 'clip_not_video');
    assert.equal((await resolveEdit('auth-1', one(A, { audio: { asset_id: B, offset_s: 0 } }), deps())).error, 'audio_not_audio');
    const landscape = { ...FRAMES, 'jobs/b.mp4': { seconds: 8, width: 1280, height: 720 } };
    assert.equal((await resolveEdit('auth-1', { clips: [{ asset_id: A, in_s: 0, out_s: 2 }, { asset_id: B, in_s: 0, out_s: 2 }] }, deps(landscape))).error, 'mixed_aspect');
    assert.equal((await resolveEdit('auth-1', one(A), deps({}))).error, 'clip_unreadable');
});

/** A minimal MP4: ftyp + moov(mvhd, one video tkhd). */
function mp4(seconds, width, height) {
    const box = (type, payload) => { const b = Buffer.alloc(8 + payload.length); b.writeUInt32BE(b.length, 0); b.write(type, 4); payload.copy(b, 8); return b; };
    const mvhd = Buffer.alloc(100); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(seconds * 1000, 16);
    const tkhd = Buffer.alloc(84); tkhd.writeUInt32BE(width * 65536, 76); tkhd.writeUInt32BE(height * 65536, 80);
    return Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('tkhd', tkhd))]))]);
}

test('generations: a clip-edit is priced on its output, stores the resolved edit and submits the first trim', async () => {
    const file = mp4(10, 720, 1280);
    const calls = [];
    const rpcs = {
        check_generation_rate_limit: { ok: true },
        get_user_asset: { ok: true, state: 'STORED', mime_type: 'video/mp4', r2_key: 'jobs/src.mp4', size_bytes: file.length },
        ledger_debit: { ok: true, job_id: '55555555-5555-4555-8555-555555555555', idempotent: false, balance_after: 47 },
        job_submitted: { ok: true },
        job_step_claim: { ok: true, claimed: true },
        job_step_submitted: { ok: true },
    };
    globalThis.fetch = async (url, init = {}) => {
        const u = String(url);
        calls.push({ url: u, body: init.body && typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
        const rpc = /\/rpc\/([a-z_]+)/.exec(u);
        if (rpc && rpcs[rpc[1]]) return Response.json(rpcs[rpc[1]]);
        if (u.includes('/rest/v1/model_catalog')) {
            return Response.json([{ id: 'clip-edit', provider: 'veyrnox', provider_endpoint: 'clip-edit:v1', modality: 'video-to-video', credits_5s: 1, gated_flag: false, active: true }]);
        }
        if (u.includes('/rest/v1/users')) return Response.json([{ id: '00000000-0000-4000-8000-000000000009' }]);
        if (u.includes('r2.cloudflarestorage.com')) {
            const [, s, e] = /bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get('range'));
            return new Response(file.subarray(Number(s), Number(e) + 1), { status: 206 });
        }
        if (u.includes('queue.fal.run')) return Response.json({ request_id: 'req-trim-0' });
        throw new Error(`unexpected fetch ${u}`);
    };
    const res = await generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST',
        headers: { 'x-veyrnox-auth-id': 'auth-user-1', 'content-type': 'application/json' },
        body: JSON.stringify({ model_id: 'clip-edit', idempotency_key: 'edit-key-0001', inputs: { clips: [{ asset_id: A, in_s: 2, out_s: 8.5 }] } }),
    }));
    assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
    const debit = calls.find((c) => c.url.includes('/rpc/ledger_debit')).body;
    assert.equal(debit.p_credits, 2, '6.5 s of output = two started 5 s units, above its one step');
    assert.deepEqual(debit.p_inputs.edit.clips.map((c) => c.key), ['jobs/src.mp4']);
    assert.equal(calls.find((c) => c.url.includes('/rpc/get_user_asset')).body.p_auth_id, 'auth-user-1');
    const fal = calls.find((c) => c.url.includes('queue.fal.run'));
    assert.ok(fal.url.includes('fal-ai/workflow-utilities/trim-video'), fal.url);
    assert.equal(fal.body.start_time, 2);
    assert.equal(fal.body.end_time, 8.5);
});
