// ADR-0103: Vey explains the signed-in user's own recent charges, read-only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { accountAnswerPlan, helpNeedsAccount, veyAccountEnabled } from '../lib/veyAccount.js';
import { SUPPORT_EMAIL } from '../lib/productKnowledge.js';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' });
delete process.env.OPENROUTER_HELP_API_KEY;
delete process.env.OPENROUTER_CHAT_API_KEY;
delete process.env.OPENROUTER_API_KEY;
const { POST } = await import('../app/api/v1/help/route.js');

const auth = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';
const job = '44444444-4444-4444-8444-444444444444';
const NOTE = 'operator-private-note: goodwill after dispute';

const ask = (question, { id = auth, extra = {} } = {}) => POST(new Request('https://veyrnox.test/api/v1/help', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(id ? { 'x-veyrnox-auth-id': id } : {}) },
    body: JSON.stringify({ question, pathname: '/app/credits', ...extra }),
}));

/** Records every upstream call; `fail` makes the ledger read return 500. */
function stubUpstream({ fail = false } = {}) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const u = new URL(url);
        calls.push({ path: u.pathname, search: u.searchParams, body: init?.body });
        if (u.pathname.endsWith('/consume_account_read_request')) return Response.json({ ok: true });
        if (u.pathname.endsWith('/read_user_credits')) return Response.json({ balance: 40, free_credits: 8, free_expires_at: null });
        if (u.pathname.endsWith('/users')) return Response.json([{ id: owner }]);
        if (u.pathname.endsWith('/ledger_entries')) {
            if (fail) return new Response('boom', { status: 500 });
            return Response.json([
                { id: 'a', delta: -12, free_delta: 0, reason: 'debit:generation', job_id: job, created_at: '2026-10-14T09:00:00Z' },
                { id: 'b', delta: 5, free_delta: 0, reason: NOTE, job_id: null, created_at: '2026-10-13T09:00:00Z' },
            ]);
        }
        if (u.pathname.endsWith('/jobs')) return Response.json([{ id: job, model_id: 'kling-2-1', state: 'STORED' }]);
        if (u.pathname.endsWith('/model_catalog')) return Response.json([]);
        throw new Error(`unexpected upstream call ${u.pathname}`);
    };
    return calls;
}
const ACCOUNT_TABLES = ['/read_user_credits', '/users', '/ledger_entries', '/jobs'];
const reads = (calls) => calls.filter((c) => ACCOUNT_TABLES.some((name) => c.path.endsWith(name)));

test('the flag needs the exact value "true"; absence is off', () => {
    assert.equal(veyAccountEnabled({ VEY_ACCOUNT_ENABLED: 'true' }), true);
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes']) assert.equal(veyAccountEnabled({ VEY_ACCOUNT_ENABLED: value }), false);
    assert.equal(veyAccountEnabled(undefined), false);
});

test('the flag is set to the exact value "true" in both the production and the staging block', () => {
    const config = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    assert.equal(config.vars.VEY_ACCOUNT_ENABLED, 'true');
    assert.equal(config.env.staging.vars.VEY_ACCOUNT_ENABLED, 'true');
});

test('only questions about a charge or the balance read the account', () => {
    for (const q of ['Why was I charged 12 credits?', 'What is my balance?', 'How many credits do I have?', 'Where did my credits go?', 'What was my last charge?', 'I was charged twice']) {
        assert.equal(helpNeedsAccount(q), true, q);
    }
    for (const q of ['How do I make an image?', 'How do refunds work?', 'Do credits expire?', 'How much does Kling cost?', 'Where is my Library?']) {
        assert.equal(helpNeedsAccount(q), false, q);
    }
});

test('flag off: a charge question never reads the account', async () => {
    delete process.env.VEY_ACCOUNT_ENABLED;
    const calls = stubUpstream();
    const { plan } = await (await ask('Why was I charged 12 credits?')).json();
    assert.notEqual(plan.source, 'account');
    assert.equal(reads(calls).length, 0);
});

test('flag on: a charge question is answered from the caller\'s own rows and never reaches a provider', async () => {
    process.env.VEY_ACCOUNT_ENABLED = 'true';
    const calls = stubUpstream();
    const response = await ask('Why was I charged 12 credits?', { extra: { auth_id: other, user_id: other } });
    const { plan } = await response.json();
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(plan.source, 'account');
    assert.match(plan.message, /balance is 40 Credits, of which 8 are free/);
    assert.match(plan.message, /12 Credits charged for a generation \(kling-2-1\), 14 Oct/);
    assert.equal(plan.target, 'credits.statement');
    assert.equal(plan.action, 'show_target');
    // Isolation: only the verified identity was ever used, whatever the body named.
    const text = calls.map((c) => `${c.search} ${c.body || ''}`).join(' ');
    assert.equal(text.includes(other), false);
    assert.ok(calls.some((c) => c.path.endsWith('/users') && c.search.get('auth_id') === `eq.${auth}`));
    for (const c of calls.filter((c) => c.path.endsWith('/ledger_entries') || c.path.endsWith('/jobs'))) {
        assert.equal(c.search.get('user_id'), `eq.${owner}`);
    }
    // Projection: categories only. No operator reason, email, payment or provider call.
    assert.equal(JSON.stringify(plan).includes(NOTE), false);
    assert.equal(calls.some((c) => /openrouter/i.test(c.path)), false);
    assert.equal(calls.filter((c) => c.path.endsWith('/ledger_entries'))[0].search.get('limit'), '10');
});

test('flag on: a how-to question never reads the ledger', async () => {
    process.env.VEY_ACCOUNT_ENABLED = 'true';
    const calls = stubUpstream();
    await ask('How do I make an image?');
    assert.equal(reads(calls).length, 0);
});

test('without verified identity nothing is read', async () => {
    process.env.VEY_ACCOUNT_ENABLED = 'true';
    const calls = stubUpstream();
    const response = await ask('Why was I charged 12 credits?', { id: '' });
    assert.equal(response.status, 401);
    assert.equal(calls.length, 0);
});

test('a failed read says so and gives the support address instead of inventing a charge', async () => {
    process.env.VEY_ACCOUNT_ENABLED = 'true';
    stubUpstream({ fail: true });
    const { plan } = await (await ask('Why was I charged 12 credits?')).json();
    assert.match(plan.message, /^I could not read your account just now/);
    assert.notEqual(plan.source, 'account');
    assert.equal(/\b40\b|kling/i.test(plan.message), false);
});

test('an account with no movements says so', () => {
    const plan = accountAnswerPlan({ balance: 0, freeCredits: 0, freeExpiresAt: null, entries: [] });
    assert.match(plan.message, /Nothing has moved/);
    assert.ok(plan.message.includes(SUPPORT_EMAIL));
    assert.ok(plan.message.length <= 700);
});

test('every category ledgerKind can return has an explicit Vey label', () => {
    const labels = {
        generation: 'a generation', generation_refund: 'a refund for a failed generation',
        top_up: 'a Credit Pack purchase', signup_grant: 'your sign-up Credits',
        free_credit_expiry: 'free Credits expiring', referral_reward: 'a referral reward',
        checkin_reward: 'a daily check-in reward', referral_reward_reversed: 'a referral reward reversed',
        payment_adjustment: 'a payment adjustment', adjustment: 'an adjustment',
    };
    const source = readFileSync(new URL('../lib/ledgerKind.js', import.meta.url), 'utf8');
    const kinds = [...new Set([...source.matchAll(/return '([a-z_]+)'/g)].map(m => m[1]))];
    assert.deepEqual(kinds.sort(), Object.keys(labels).sort(), 'a new ledger category needs a Vey label and proof');
    for (const kind of kinds) {
        const plan = accountAnswerPlan({ balance: 1, freeCredits: 0, entries: [{ kind, delta: 1 }] });
        assert.ok(plan.message.includes(`1 Credit added for ${labels[kind]}.`), kind);
    }
});

test('the account path has no writer and names no mutating function', () => {
    const source = readFileSync(new URL('../lib/veyAccount.js', import.meta.url), 'utf8');
    const rpcs = [...source.matchAll(/rpcImpl\('([a-z_]+)'/g)].map((m) => m[1]);
    assert.deepEqual(rpcs, ['read_user_credits']);
    assert.doesNotMatch(source, /\b(ledger_(debit|refund|grant)|credit_top_up|unfreeze_account|apply_top_up_refund|apply_dispute_event)\b/);
    assert.doesNotMatch(source, /\.(insert|update|delete|upsert)\(|method:\s*'(POST|PATCH|PUT|DELETE)'/);
});
