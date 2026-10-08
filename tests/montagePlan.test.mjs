import test from 'node:test';
import assert from 'node:assert/strict';

import { mintPlanToken, verifyPlanToken, planIdempotencyKey, publicPlan, BRIEF_RE, PLAN_TTL_SECONDS } from '../lib/montagePlan.js';
import { providerFor } from '../packages/provider-sdk/registry.js';
import { capabilityFor } from '../lib/modelCapabilities.js';

const SECRET = 'plan-secret';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const BRIEF = 'a calm ocean timelapse at dusk';
const NOW = 1_800_000_000;
const ask = (over = {}) => ({ secret: SECRET, authId: A, brief: BRIEF, aspect: '9:16', credits: 90, now: NOW + 10, ...over });

test('a minted plan verifies for the same caller, brief, aspect and price', async () => {
    const m = await mintPlanToken({ ...ask(), now: NOW });
    const v = await verifyPlanToken({ ...ask(), token: m.token });
    assert.deepEqual(v, { ok: true, nonce: m.nonce });
    assert.match(planIdempotencyKey(m.nonce), /^[A-Za-z0-9._-]{8,128}$/);
    assert.ok(m.token.length < 600);
});

test('a plan is refused for another user, another brief, another aspect, and after the price moved', async () => {
    const { token } = await mintPlanToken({ ...ask(), now: NOW });
    assert.equal((await verifyPlanToken({ ...ask({ authId: B }), token })).error, 'plan_mismatch');
    assert.equal((await verifyPlanToken({ ...ask({ brief: BRIEF + '!' }), token })).error, 'plan_mismatch');
    assert.equal((await verifyPlanToken({ ...ask({ aspect: '16:9' }), token })).error, 'plan_mismatch');
    assert.equal((await verifyPlanToken({ ...ask({ credits: 91 }), token })).error, 'plan_price_changed');
});

test('a plan expires after 30 minutes', async () => {
    const { token } = await mintPlanToken({ ...ask(), now: NOW });
    assert.equal((await verifyPlanToken({ ...ask({ now: NOW + PLAN_TTL_SECONDS }), token })).ok, true);
    assert.equal((await verifyPlanToken({ ...ask({ now: NOW + PLAN_TTL_SECONDS + 1 }), token })).error, 'plan_expired');
});

test('tampered, foreign-secret, malformed and oversized tokens are plan_invalid', async () => {
    const { token } = await mintPlanToken({ ...ask(), now: NOW });
    const [p, s] = token.split('.');
    // Tamper with a character that is guaranteed to change. Swapping the LAST one for a fixed letter failed at random:
    // about 1 time in 16 it already was that letter, the "tampered" token was the real one, and it verified (ci on 1122862).
    const flip = (c) => (c === 'A' ? 'B' : 'A');
    const badSig = flip(s[0]) + s.slice(1);
    const badPayload = flip(p[0]) + p.slice(1);
    assert.notEqual(badSig, s);
    assert.notEqual(badPayload, p);
    for (const bad of [`${p}x.${s}`, `${p}.${badSig}`, `${badPayload}.${s}`, 'nodot', `${p}.${s}.extra`, '', 'a'.repeat(700), null, 42]) {
        assert.equal((await verifyPlanToken({ ...ask(), token: bad })).error, 'plan_invalid', String(bad).slice(0, 20));
    }
    assert.equal((await verifyPlanToken({ ...ask({ secret: 'other' }), token })).error, 'plan_invalid');
    assert.equal((await verifyPlanToken({ ...ask({ secret: '' }), token })).error, 'plan_invalid');
});

test('two plans for the same brief carry different nonces, so each buys one run', async () => {
    const a = await mintPlanToken({ ...ask(), now: NOW });
    const b = await mintPlanToken({ ...ask(), now: NOW });
    assert.notEqual(a.nonce, b.nonce);
});

test('briefs: 3 to 500 characters, no control characters except line breaks', () => {
    assert.equal(BRIEF_RE.test('ab'), false);
    assert.equal(BRIEF_RE.test('abc'), true);
    assert.equal(BRIEF_RE.test('x'.repeat(500)), true);
    assert.equal(BRIEF_RE.test('x'.repeat(501)), false);
    assert.equal(BRIEF_RE.test('line\u0000break'), false);
    assert.equal(BRIEF_RE.test('bell\u0007char'), false);
    assert.equal(BRIEF_RE.test('two\nlines'), true); // multi-line briefs are fine
});

test('publicPlan keeps only seconds and a short clean summary', () => {
    assert.deepEqual(publicPlan({ seconds: 30, summary: 'Intro\u0000 and outro', provider: 'fal', r2_key: 'x' }), { seconds: 30, summary: 'Intro  and outro' });
    assert.deepEqual(publicPlan({ seconds: 9999, summary: 7 }), { seconds: null, summary: '' });
    assert.equal(publicPlan({ summary: 'y'.repeat(900) }).summary.length, 300);
    assert.deepEqual(publicPlan(null), { seconds: null, summary: '' });
});

test('the video-agent gateway entry refuses when AGENT_VIDEO_ENABLED is off, and checks the brief when on', () => {
    const veyrnox = providerFor('veyrnox');
    const record = capabilityFor('video-agent:v1');
    assert.equal(record.agent, true);
    const inputs = { brief: BRIEF, plan_id: 'tok' };
    const prev = process.env.AGENT_VIDEO_ENABLED;
    try {
        delete process.env.AGENT_VIDEO_ENABLED;
        assert.deepEqual(veyrnox.check(record, {}, inputs), { ok: false, error: 'video_agent_unavailable' });
        process.env.AGENT_VIDEO_ENABLED = 'true';
        assert.deepEqual(veyrnox.check(record, {}, inputs), { ok: true });
        assert.equal(veyrnox.check(record, {}, { ...inputs, brief: 'x' }).ok, false);
    } finally {
        if (prev === undefined) delete process.env.AGENT_VIDEO_ENABLED; else process.env.AGENT_VIDEO_ENABLED = prev;
    }
});
