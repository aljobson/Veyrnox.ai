import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { MOTION_CLIPS, motionClipFor, motionClipIds, validClip } from '../lib/motionClips.js';
import { motionTransferEnabled, resolveMotionClip, motionPricedInputs, motionSubmitSources, MOTION_CLIP_URL_SECONDS } from '../lib/motionTransfer.js';
import { capabilityFor, checkInputs, declaredInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { MOTION_TRANSFER_TEMPLATES } from '../app/veyrnox/_lib/motionTransferTemplates.js';
import { creditsForFloor } from '../scripts/lib/fal-price-check.mjs';

const KLING = 'fal-ai/kling-video/v3/standard/motion-control';
const WAN = 'fal-ai/wan/v2.2-14b/animate/replace';
const migration = readFileSync(new URL('../packages/db/schema/supabase/0402_motion_transfer_staged.sql', import.meta.url), 'utf8');

const readyClip = (id) => ({ ...motionClipFor(id), ready: true });
const deps = (clips, presign = async (key, seconds) => `https://r2.test/${key}?ttl=${seconds}`) => ({
    clips, presign, isConfigured: (cfg) => !!cfg,
});

test('every clip is well formed, unique and starts not ready', () => {
    const ids = MOTION_CLIPS.map(c => c.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 20);
    for (const c of MOTION_CLIPS) {
        assert.ok(validClip(c), c.id);
        assert.equal(c.ready, false, `${c.id} cannot be sold before the file and its provenance exist`);
    }
    assert.deepEqual(motionClipIds('replace'), ['motion-world-shift-walk', 'motion-stage-swap']);
    assert.equal(motionClipFor('toString'), null);
    assert.equal(motionClipFor({ id: 'motion-city-stride' }), null);
});

test('validClip refuses a camera-move clip longer than Kling follows, and a bad key', () => {
    const base = MOTION_CLIPS[0];
    assert.equal(validClip({ ...base, seconds: 15 }), false);
    assert.equal(validClip({ ...base, key: 'public/other.mp4' }), false);
    assert.equal(validClip({ ...base, mode: 'replace' }), false, 'replace clips carry no orientation');
});

test('every template card names a clip of the same mode and length, and carries no URL or key', () => {
    assert.equal(MOTION_TRANSFER_TEMPLATES.length, MOTION_CLIPS.length);
    for (const t of MOTION_TRANSFER_TEMPLATES) {
        const c = motionClipFor(t.drivingClip);
        assert.ok(c, t.id);
        assert.equal(t.seconds, c.seconds, t.id);
        assert.equal(t.model, c.mode === 'move' ? 'motion-transfer' : 'motion-replace', t.id);
        assert.ok(!JSON.stringify(t).includes('motion/driving/'), `${t.id} leaks the R2 key`);
    }
});

test('flags: each mode is off unless its own variable is exactly "true"', () => {
    assert.equal(motionTransferEnabled({}, 'move'), false);
    assert.equal(motionTransferEnabled({ MOTION_TRANSFER_ENABLED: 'TRUE' }, 'move'), false);
    assert.equal(motionTransferEnabled({ MOTION_TRANSFER_ENABLED: 'true' }, 'move'), true);
    assert.equal(motionTransferEnabled({ MOTION_TRANSFER_ENABLED: 'true' }, 'replace'), false);
    assert.equal(motionTransferEnabled({ MOTION_REPLACE_ENABLED: 'true' }, 'replace'), true);
    assert.equal(motionTransferEnabled({ MOTION_TRANSFER_ENABLED: 'true' }, 'constructor'), false);
    assert.equal(motionTransferEnabled(null, 'move'), false);
});

test('the clip resolver refuses a caller length, an unknown or wrong-mode clip, and an unready one', async () => {
    const record = capabilityFor(KLING);
    const clips = [readyClip('motion-runway-turn'), readyClip('motion-stage-swap'), motionClipFor('motion-city-stride')];
    const run = (modelInputs, d = deps(clips), r2cfg = {}) => resolveMotionClip({ record, modelInputs, r2cfg }, d);
    assert.deepEqual(await run({ motion_template: 'motion-runway-turn', duration_seconds: 5 }),
        { ok: false, status: 400, error: 'inputs_key_not_allowed:duration_seconds' });
    assert.deepEqual(await run({ motion_template: 'motion-nope' }), { ok: false, status: 400, error: 'motion_template_unknown' });
    assert.deepEqual(await run({}), { ok: false, status: 400, error: 'motion_template_unknown' });
    assert.deepEqual(await run({ motion_template: 'motion-stage-swap' }), { ok: false, status: 400, error: 'motion_template_unknown' });
    assert.deepEqual(await run({ motion_template: 'motion-city-stride' }), { ok: false, status: 400, error: 'motion_template_unavailable' });
    assert.deepEqual(await run({ motion_template: 'motion-runway-turn' }, deps(clips), null), { ok: false, status: 503, error: 'gateway_not_configured' });
    assert.deepEqual(await run({ motion_template: 'motion-runway-turn' }, deps(clips, async () => { throw new Error('r2 down'); })),
        { ok: false, status: 502, error: 'motion_clip_unavailable' });
    assert.deepEqual(await run({ motion_template: 'motion-runway-turn' }, deps(clips, async () => 'http://plain.test/x')),
        { ok: false, status: 502, error: 'motion_clip_unavailable' });
});

test('a ready clip is priced on its own length and reaches Kling as a 15-minute URL with pinned fields', async () => {
    const record = capabilityFor(KLING);
    const clips = [readyClip('motion-runway-turn')];
    const modelInputs = declaredInputs(record, { motion_template: 'motion-runway-turn', image_url: 'https://r2.test/photo.png', prompt: 'ignored', video_url: 'https://evil.test/x.mp4' });
    assert.deepEqual(modelInputs, { motion_template: 'motion-runway-turn', image_url: 'https://r2.test/photo.png' }, 'no client clip, length or prompt survives');
    const resolved = await resolveMotionClip({ record, modelInputs, r2cfg: {} }, deps(clips));
    assert.deepEqual(resolved, { ok: true, url: `https://r2.test/motion/driving/motion-runway-turn.mp4?ttl=${MOTION_CLIP_URL_SECONDS}`, seconds: 10, orientation: 'video', clipId: 'motion-runway-turn' });
    assert.equal(MOTION_CLIP_URL_SECONDS, 900);
    assert.deepEqual(motionPricedInputs(resolved), { duration_seconds: 10 });
    assert.deepEqual(checkInputs(record, modelInputs), { ok: true });
    const sources = motionSubmitSources({ image_url: { url: 'https://r2.test/photo.png' } }, resolved);
    assert.deepEqual(shapePayload(record, modelInputs, sources), {
        image_url: 'https://r2.test/photo.png',
        video_url: resolved.url,
        character_orientation: 'video',
        keep_original_sound: false,
        enable_safety_checker: true,
    });
});

test('Wan replace pins 720p and both safety checkers', async () => {
    const record = capabilityFor(WAN);
    const modelInputs = { motion_template: 'motion-stage-swap', image_url: 'https://r2.test/p.png' };
    const resolved = await resolveMotionClip({ record, modelInputs, r2cfg: {} }, deps([readyClip('motion-stage-swap')]));
    assert.equal(resolved.ok, true);
    assert.deepEqual(shapePayload(record, modelInputs, motionSubmitSources({}, resolved)), {
        image_url: 'https://r2.test/p.png', video_url: resolved.url,
        resolution: '720p', enable_safety_checker: true, enable_output_safety_checker: true,
    });
});

test('motion records need a photo and a template, and expose no clip slot', () => {
    for (const ep of [KLING, WAN]) {
        const record = capabilityFor(ep);
        assert.deepEqual(checkInputs(record, { motion_template: motionClipIds(record.motion)[0] }), { ok: false, error: 'inputs_invalid:image_url' });
        assert.deepEqual(checkInputs(record, { image_url: 'https://r2.test/p.png' }), { ok: false, error: 'inputs_invalid:motion_template' });
        assert.deepEqual(checkInputs(record, { image_url: 'https://r2.test/p.png', motion_template: 'motion-nope' }), { ok: false, error: 'inputs_invalid:motion_template' });
        const view = publicCapabilities(record);
        assert.deepEqual(Object.keys(view.media), ['image']);
        assert.ok(!JSON.stringify(view).includes('video_url'));
    }
});

test('0402 stages both rows inactive at the approved price, each at its whole-credit floor', () => {
    const rows = [...migration.matchAll(/\('(motion-[a-z]+)', '[^']+', 'fal',\s+'([^']+)', 'image-to-video', (\d+), ([\d.]+), 'per_second', 5, false, false\)/g)]
        .map(([, id, endpoint, credits, cost]) => ({ id, endpoint, credits: Number(credits), cost: Number(cost) }));
    assert.deepEqual(rows, [
        { id: 'motion-transfer', endpoint: KLING, credits: 36, cost: 0.63 },
        { id: 'motion-replace', endpoint: WAN, credits: 23, cost: 0.4 },
    ]);
    for (const { id, credits, cost } of rows) {
        assert.equal(creditsForFloor(cost), credits, id);
        assert.ok(Math.round(cost * 100000) <= credits * 1796, `${id} clears the 0366 trigger`);
    }
    // Per-second fal prices read 2026-10-27, times the 5-second unit.
    assert.equal(Math.round(0.126 * 5 * 10000) / 10000, 0.63);
    assert.equal(Math.round(0.08 * 5 * 10000) / 10000, 0.4);
});

// Route: the gate and the clip checks stop the request before the user lookup, the debit and the provider.
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role', PUBLIC_HOST: 'https://veyrnox.test', FAL_KEY: 'test-fal',
    R2_ACCOUNT_ID: 'test-account', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test-bucket',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; delete process.env.MOTION_TRANSFER_ENABLED; });

async function invoke(body, { endpoint = KLING } = {}) {
    const calls = [];
    globalThis.fetch = async (url) => {
        const u = new URL(url);
        const name = u.hostname === 'db.test' ? u.pathname.split('/').pop() : `other:${u.hostname}`;
        calls.push(name);
        if (name === 'check_generation_rate_limit') return Response.json({ ok: true });
        if (name === 'model_catalog') return Response.json([{ id: 'motion-transfer', provider: 'fal', active: true, credits_5s: 36, modality: 'image-to-video', provider_endpoint: endpoint, gated_flag: false }]);
        if (name === 'model_routes') return Response.json([]);
        assert.fail(`Unexpected network call: ${url}`);
    };
    const response = await POST(new Request('https://veyrnox.test/api/v1/generations', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-veyrnox-auth-id': 'test-auth' },
        body: JSON.stringify({ model_id: 'motion-transfer', idempotency_key: 'motion-test-001', ...body }),
    }));
    return { status: response.status, body: await response.json(), calls };
}

const NO_MONEY = (calls) => !calls.some(c => ['users', 'ledger_debit'].includes(c) || c.startsWith('other:'));

test('route: flag off refuses before sources, debit or provider', async () => {
    delete process.env.MOTION_TRANSFER_ENABLED;
    const result = await invoke({ inputs: { motion_template: 'motion-city-stride' } });
    assert.equal(result.status, 400);
    assert.deepEqual(result.body, { error: 'motion_transfer_unavailable' });
    assert.ok(NO_MONEY(result.calls), result.calls.join());
});

test('route: with the flag on, a caller length, an unknown or unready clip, or a caller video is refused before the debit', async () => {
    process.env.MOTION_TRANSFER_ENABLED = 'true';
    const cases = [
        [{ inputs: { motion_template: 'motion-city-stride', duration_seconds: 10 } }, 'inputs_key_not_allowed:duration_seconds'],
        [{ inputs: { motion_template: 'motion-nope' } }, 'motion_template_unknown'],
        [{ inputs: { motion_template: 'motion-city-stride' } }, 'motion_template_unavailable'],
        [{ inputs: { motion_template: 'motion-city-stride' }, consent: true, references: [{ origin: 'upload', key: 'uploads/clip.mp4', slot: 'video' }] }, 'source_slot_invalid'],
    ];
    for (const [body, error] of cases) {
        const result = await invoke(body);
        assert.equal(result.status, 400, error);
        assert.deepEqual(result.body, { error });
        assert.ok(NO_MONEY(result.calls), `${error}: ${result.calls.join()}`);
    }
});
