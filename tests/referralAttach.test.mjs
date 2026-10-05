import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { normalizeReferralCode, referralsEnabled } from '../lib/referrals.js';

register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service' });
const summaryRoute = await import('../app/api/v1/referrals/route.js');
const attachRoute = await import('../app/api/v1/referrals/attach/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111';
const CODE = '2345679ABC';

function network(answers = {}) {
    const calls = []; const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const name = new URL(String(url)).pathname.split('/rpc/')[1];
        calls.push({ name, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
        if (answers[name] instanceof Error) throw answers[name];
        return Response.json(answers[name] ?? { ok: true });
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}
const withFlag = async (value, fn) => {
    const before = process.env.REFERRALS_ENABLED;
    if (value === undefined) delete process.env.REFERRALS_ENABLED; else process.env.REFERRALS_ENABLED = value;
    try { return await fn(); } finally { if (before === undefined) delete process.env.REFERRALS_ENABLED; else process.env.REFERRALS_ENABLED = before; }
};
const get = (h = { 'x-veyrnox-auth-id': AUTH }) => summaryRoute.GET(new Request('https://v.test/api/v1/referrals', { headers: h }));
const post = (body, h = { 'x-veyrnox-auth-id': AUTH }) => attachRoute.POST(new Request('https://v.test/api/v1/referrals/attach', {
    method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body),
}));

test('normalizeReferralCode: trims, upper-cases and holds the exact alphabet', () => {
    assert.equal(normalizeReferralCode(' 2345679abc '), CODE);
    for (const bad of ['', 'short', '23456789ABCD', '2345679AB1', '2345679ABI', '2345679ABO', 'IIIIIIIIII', 7, null, undefined, {}, 'x'.repeat(40)]) assert.equal(normalizeReferralCode(bad), null, String(bad));
});

test('referralsEnabled is exactly the string "true"', () => {
    assert.equal(referralsEnabled({ REFERRALS_ENABLED: 'true' }), true);
    for (const v of ['false', '', 'TRUE', '1', undefined]) assert.equal(referralsEnabled({ REFERRALS_ENABLED: v }), false);
    assert.equal(referralsEnabled(undefined), false);
});

test('summary: signed out is refused, and flag off does no database work', () => withFlag(undefined, async () => {
    const net = network();
    try {
        assert.equal((await get({})).status, 401);
        const res = await get();
        assert.deepEqual(await res.json(), { enabled: false });
        assert.equal(net.calls.length, 0);
    } finally { net.restore(); }
}));

test('summary: returns the code and a count, nothing about who', () => withFlag('true', async () => {
    const net = network({ referral_code_for: { ok: true, code: CODE }, referral_summary: { ok: true, referred: 3 } });
    try {
        const body = await (await get()).json();
        assert.deepEqual(body, { enabled: true, code: CODE, referred: 3 });
        assert.deepEqual(net.calls.map((c) => c.name), ['referral_code_for', 'referral_summary']);
        assert.deepEqual(net.calls[0].body, { p_auth_id: AUTH });
    } finally { net.restore(); }
}));

test('summary: an unprovisioned account and a database failure answer with typed errors', () => withFlag('true', async () => {
    let net = network({ referral_code_for: { ok: false, code: 'USER_NOT_FOUND' } });
    try { const res = await get(); assert.equal(res.status, 409); assert.equal((await res.json()).error, 'user_not_provisioned'); } finally { net.restore(); }
    net = network({ referral_code_for: new Error('boom: secret detail') });
    try { const res = await get(); assert.equal(res.status, 502); assert.deepEqual(await res.json(), { error: 'referrals_unavailable' }); } finally { net.restore(); }
}));

test('attach: signed out is refused and flag off is a 404 with no database work', () => withFlag(undefined, async () => {
    const net = network();
    try {
        assert.equal((await post({ code: CODE }, {})).status, 401);
        assert.equal((await post({ code: CODE })).status, 404);
        assert.equal(net.calls.length, 0);
    } finally { net.restore(); }
}));

test('attach: only { code } is accepted, and a malformed code never reaches the database', () => withFlag('true', async () => {
    const net = network();
    try {
        for (const bad of ['not json', [], { code: CODE, extra: 1 }, { other: CODE }]) assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
        for (const bad of ['', 'abc', 'IIIIIIIIII', 5, null]) {
            const res = await post({ code: bad });
            assert.equal(res.status, 400);
            assert.equal((await res.json()).error, 'invalid_code');
        }
        assert.equal(net.calls.length, 0);
    } finally { net.restore(); }
}));

test('attach: a good code is normalised, sent with the verified auth id, and the answer never names the referrer', () => withFlag('true', async () => {
    const net = network({ attach_referral: { ok: true, attached: true, idempotent: false } });
    try {
        const res = await post({ code: '2345679abc' });
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { attached: true });
        assert.deepEqual(net.calls[0], { name: 'attach_referral', body: { p_auth_id: AUTH, p_code: CODE } });
    } finally { net.restore(); }
}));

test('attach: each refusal maps to a typed status', () => withFlag('true', async () => {
    const cases = [['INVALID_CODE', 400, 'invalid_code'], ['SELF_REFERRAL', 400, 'self_referral'], ['NOT_NEW', 409, 'not_new'], ['ALREADY_ATTACHED', 409, 'already_attached'], ['USER_NOT_FOUND', 409, 'user_not_provisioned']];
    for (const [code, status, error] of cases) {
        const net = network({ attach_referral: { ok: false, code } });
        try { const res = await post({ code: CODE }); assert.equal(res.status, status, code); assert.deepEqual(await res.json(), { error }); } finally { net.restore(); }
    }
    const net = network({ attach_referral: new Error('db down: internal text') });
    try { const res = await post({ code: CODE }); assert.equal(res.status, 502); assert.ok(!JSON.stringify(await res.json()).includes('internal')); } finally { net.restore(); }
}));
