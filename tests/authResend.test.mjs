import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gateHarness } from './helpers/authGateHarness.mjs';
import { keepMagicVerifier, readMagicVerifier, takeVerifier } from '../app/lib/pkceVerifier.js';
import { signUp, sendMagicLink, resendSignupEmail, resendMagicLink, completeOAuthFromCode, clearSession } from '../app/lib/authClient.js';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.test';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
const KEY = 'veyrnox_pkce_magic_verifier';
const storage = () => { const values = new Map(); return {
    getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k),
}; };
function setup() {
    globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
    globalThis.window = { location: { origin: 'https://veyrnox.test' } };
}
const sha = value => crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)).then(b => Buffer.from(b).toString('base64url'));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
for (const [flow, initial, resend] of [
    ['signup', () => signUp('person@test.invalid', 'chosen-password', 'first'), resendSignupEmail],
    ['magic', () => sendMagicLink('person@test.invalid', 'first'), resendMagicLink],
]) {
    test(`${flow}: resend preserves the stored challenge, timestamp and password; sends fresh captcha and callback`, async () => {
        setup(); const requests = [];
        globalThis.fetch = async (url, init) => { requests.push({ url: new URL(url), body: JSON.parse(init.body) }); return Response.json({}); };
        await initial(); const original = localStorage.getItem(KEY);
        await resend('person@test.invalid', 'second');
        assert.equal(localStorage.getItem(KEY), original);
        const { url, body } = requests[1];
        assert.equal(url.pathname, flow === 'signup' ? '/auth/v1/resend' : '/auth/v1/otp');
        assert.equal(url.searchParams.get('redirect_to'), 'https://veyrnox.test/auth/callback');
        assert.deepEqual(body, { ...(flow === 'signup' ? { type: 'signup' } : { create_user: true }), email: 'person@test.invalid',
            code_challenge: requests[0].body.code_challenge, code_challenge_method: 's256', gotrue_meta_security: { captcha_token: 'second' } });
        assert.equal(body.code_challenge, await sha(JSON.parse(original).verifier));
    });
    for (const age of [600000, 600001, 900001]) test(`${flow}: verifier age ${age} boundary`, async ctx => {
        setup(); ctx.mock.timers.enable({ apis: ['Date'], now: 1000000 }); keepMagicVerifier('verifier');
        const original = localStorage.getItem(KEY); ctx.mock.timers.tick(age);
        let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({}); };
        if (age <= 600000) await resend('person@test.invalid', 'cap');
        else await assert.rejects(resend('person@test.invalid', 'cap'), { code: 'resend_restart' });
        assert.equal(calls, age <= 600000 ? 1 : 0); assert.equal(localStorage.getItem(KEY), original);
    });
    test(`${flow}: missing, malformed or inaccessible storage sends nothing`, async () => {
        setup(); globalThis.fetch = () => assert.fail('must not send');
        for (const value of [null, '{invalid', JSON.stringify({ verifier: 'v', at: 'bad' })]) {
            if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY);
            await assert.rejects(resend('person@test.invalid', 'cap'), { code: 'resend_restart' });
        }
        localStorage.getItem = () => { throw new Error('blocked'); };
        await assert.rejects(resend('person@test.invalid', 'cap'), { code: 'resend_restart' });
    });
    for (const failure of ['offline', 'rejected', 'accepted-but-lost']) test(`${flow}: ${failure} leaves the original verifier intact`, async () => {
        setup(); keepMagicVerifier('verifier'); const original = localStorage.getItem(KEY);
        globalThis.fetch = async () => {
            if (failure === 'rejected') return Response.json({ error_code: 'captcha_failed' }, { status: 400 });
            throw new TypeError('Failed to fetch');
        };
        await assert.rejects(resend('person@test.invalid', 'cap'));
        assert.equal(localStorage.getItem(KEY), original); assert.equal(takeVerifier(), 'verifier');
    });
    for (const action of ['replace', 'consume']) test(`${flow}: another tab can ${action} between read and request without being overwritten`, async () => {
        setup(); keepMagicVerifier('A'); const originalGet = localStorage.getItem;
        localStorage.getItem = k => { const raw = originalGet(k); localStorage.getItem = originalGet;
            if (action === 'replace') keepMagicVerifier('B'); else takeVerifier(); return raw; };
        globalThis.fetch = async (_url, init) => {
            assert.equal(JSON.parse(init.body).code_challenge, await sha('A')); return Response.json({});
        };
        await resend('person@test.invalid', 'cap');
        assert.equal(readMagicVerifier(), action === 'replace' ? 'B' : null);
    });
}
test('reversed responses in two tabs never overwrite B’s verifier', async () => {
    setup(); const a = deferred(), b = deferred(); let calls = 0;
    globalThis.fetch = () => ++calls === 1 ? a.promise : b.promise;
    keepMagicVerifier('A'); const first = resendSignupEmail('a@test.invalid', 'cap-a');
    await new Promise(resolve => setImmediate(resolve));
    // Wait until the async S256 computation has sent A's request.
    while (!calls) await new Promise(resolve => setImmediate(resolve));
    keepMagicVerifier('B'); const record = localStorage.getItem(KEY);
    const second = resendMagicLink('b@test.invalid', 'cap-b', 'https://veyrnox.test/auth/callback?returnTo=%2Fapp');
    b.resolve(Response.json({})); await second; a.resolve(Response.json({})); await first;
    assert.equal(localStorage.getItem(KEY), record);
});
test('the resend helper never calls a verifier writer or consumer', () => {
    const source = readFileSync(new URL('../app/lib/authClient.js', import.meta.url), 'utf8');
    const resend = source.slice(source.indexOf('async function resendEmail'), source.indexOf('// GoTrue reads'));
    assert.doesNotMatch(resend, /keepMagicVerifier|takeVerifier|setItem|removeItem/);
});
async function pending(ctx, flow = 'sign_up', overrides = {}) {
    ctx.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000000 });
    const h = gateHarness(ctx, overrides); h.open(flow); h.email('person@test.invalid');
    if (flow === 'sign_up') h.password('chosen-password');
    h.token('first'); await h.submit(); return h;
}
function advance(ctx, h) { ctx.mock.timers.tick(60000); h.render(); }
for (const flow of ['sign_up', 'magic']) {
    test(`${flow}: cooldown, fresh captcha, preserved email and one in-flight resend`, async ctx => {
        const held = deferred(); const name = flow === 'magic' ? 'resendMagicLink' : 'resendSignupEmail';
        const h = await pending(ctx, flow, { [name]: () => held.promise });
        assert.equal(h.resend().props.disabled, true);
        await h.resend().props.onClick(); assert.equal(h.calls.length, 1);
        assert.equal(h.field('email').props.value, 'person@test.invalid'); assert.equal(h.field('password'), undefined);
        advance(ctx, h); await h.resend().props.onClick(); h.render();
        assert.equal(h.calls.length, 1); assert.match(h.text(), /security check/i);
        h.token('second'); const send = h.resend().props.onClick();
        h.resend().props.onClick(); h.render(); assert.equal(h.calls.length, 2);
        held.resolve(); await send; h.render();
        assert.equal(h.calls[1].name, name); assert.deepEqual(h.calls[1].args.slice(0, 2), ['person@test.invalid', 'second']);
        assert.equal(h.resend().props.disabled, true); assert.equal(document.activeElement, 'div');
    });
    test(`${flow}: no verifier returns to the original editable flow with a start-again notice`, async ctx => {
        const name = flow === 'magic' ? 'resendMagicLink' : 'resendSignupEmail';
        const h = await pending(ctx, flow, { [name]: async () => { throw Object.assign(new Error(), { code: 'resend_restart' }); } });
        advance(ctx, h); h.token(); await h.resend().props.onClick(); h.render();
        assert.equal(h.resend(), undefined); assert.equal(h.field('email').props.readOnly, false);
        assert.match(h.text(), /Start again/); assert.equal(!!h.field('password'), flow === 'sign_up');
    });
    test(`${flow}: change address resets the attempt and creates the corrected flow with fresh captcha`, async ctx => {
        const h = await pending(ctx, flow); h.button('Wrong address? Change it').props.onClick(); h.render();
        assert.equal(h.field('email').props.readOnly, false); assert.equal(document.activeElement, 'input');
        h.email('correct@test.invalid'); if (flow === 'sign_up') h.password('new-password');
        await h.submit(); assert.equal(h.calls.length, 1);
        h.token('new'); await h.submit(); assert.equal(h.calls.length, 2);
        assert.equal(h.calls[1].name, flow === 'magic' ? 'sendMagicLink' : 'signUp');
        assert.equal(h.calls[1].args[0], 'correct@test.invalid');
    });
}
for (const error of [{ status: 429 }, { code: 'over_email_send_rate_limit' }, { errorCode: 'over_request_rate_limit' }]) {
    test(`rate limit ${JSON.stringify(error)} restarts cooldown with existing copy`, async ctx => {
        const h = await pending(ctx, 'sign_up', { resendSignupEmail: async () => { throw error; } });
        advance(ctx, h); h.token(); await h.resend().props.onClick(); h.render();
        assert.equal(h.resend().props.disabled, true); assert.match(h.text(), /Too many attempts/);
        advance(ctx, h); assert.equal(h.resend().props.disabled, false);
    });
}
test('network errors leave retry enabled; five sends cap the attempt until reset', async ctx => {
    const h = await pending(ctx, 'sign_up', { resendSignupEmail: async () => { throw new TypeError('Failed to fetch'); } });
    advance(ctx, h);
    for (let i = 0; i < 5; i++) {
        h.token(`cap-${i}`); await h.resend().props.onClick(); h.render();
        assert.equal(h.resend().props.disabled, i === 4);
    }
    assert.match(h.text(), /Use a different address or try again later/);
    await h.resend().props.onClick(); assert.equal(h.calls.length, 6);
});

// GoTrue v2.197.0 replaces the confirmation / magic-link token whenever it sends another email
// (models.CreateOneTimeToken deletes the previous token of that type), so after an accepted resend, even
// one whose response was lost, only the NEWEST emailed link can complete. The reused verifier keeps that
// newest link completable; it cannot keep the superseded one valid.
for (const flow of ['signup', 'magic']) for (const link of ['original', 'resent']) {
    test(`${flow}: after an accepted-but-lost resend only the newest link completes (${link} link)`, async () => {
        setup(); globalThis.fetch = async () => Response.json({}); clearSession();
        await new Promise(resolve => setImmediate(resolve));
        let challenge;
        globalThis.fetch = async (_url, init) => { challenge = JSON.parse(init.body).code_challenge; return Response.json({}); };
        if (flow === 'signup') await signUp('person@test.invalid', 'chosen-password', 'first');
        else await sendMagicLink('person@test.invalid', 'first');
        const record = localStorage.getItem(KEY);
        globalThis.fetch = async (_url, init) => {
            assert.equal(JSON.parse(init.body).code_challenge, challenge);
            throw new TypeError('Response lost after acceptance');
        };
        await assert.rejects((flow === 'signup' ? resendSignupEmail : resendMagicLink)('person@test.invalid', 'second'));
        assert.equal(localStorage.getItem(KEY), record, 'a lost resend leaves the stored verifier byte-for-byte unchanged');
        window.location.href = `https://veyrnox.test/auth/callback?code=${link}`;
        let exchanges = 0;
        globalThis.fetch = async (url, init) => {
            if (String(url) === '/api/auth/session') return Response.json({ access_token: 'token', expires_in: 3600 });
            const body = JSON.parse(init.body); exchanges++;
            // The server modelled here has superseded the original token.
            if (body.auth_code !== 'resent') return Response.json({ error: 'invalid_grant' }, { status: 400 });
            assert.equal(await sha(body.code_verifier), challenge);
            return Response.json({ access_token: 'token', refresh_token: 'refresh', expires_in: 3600 });
        };
        if (link === 'resent') assert.ok(await completeOAuthFromCode());
        else {
            await assert.rejects(completeOAuthFromCode());
            // Documented limitation (ADR-0026 amendment 7): the callback deletes the verifier before the exchange,
            // so opening a superseded link in this browser burns it and the newest link then needs a fresh start.
            assert.equal(localStorage.getItem(KEY), null);
        }
        assert.equal(exchanges, 1);
        globalThis.fetch = async () => Response.json({}); clearSession();
        await new Promise(resolve => setImmediate(resolve));
    });
}
for (const age of [600000, 600001]) test(`UI at verifier age ${age} uses the real storage guard`, async ctx => {
    setup(); let sent = 0;
    globalThis.fetch = async () => { sent++; return Response.json({}); };
    const h = await pending(ctx, 'sign_up', { signUp, resendSignupEmail });
    ctx.mock.timers.tick(age); h.render(); h.token('second');
    await h.resend().props.onClick(); h.render();
    assert.equal(sent, age === 600000 ? 2 : 1);
    if (age > 600000) { assert.equal(h.resend(), undefined); assert.match(h.text(), /Start again/); }
});
test('web countdown live text changes only at start and zero; controls have touch size and focus styles', async ctx => {
    const h = await pending(ctx);
    const live = () => h.find(n => n.type === 'p' && n.props['aria-live'] === 'polite');
    assert.equal(live().props.children, 'Resend in 60 s');
    assert.match(h.resend().props.className, /min-h-11/); assert.match(h.resend().props.className, /focus-visible/);
    ctx.mock.timers.tick(1000); h.render(); assert.equal(live().props.children, 'Resend in 60 s');
    assert.equal(h.resend().props.children, 'Resend in 59 s');
    advance(ctx, h); assert.equal(live().props.children, 'You can resend the email now.');
});
test('five successful resends keep the cap after the last cooldown; changing address resets it', async ctx => {
    const h = await pending(ctx);
    for (let i = 0; i < 5; i++) { advance(ctx, h); h.token(`cap-${i}`); await h.resend().props.onClick(); h.render(); }
    advance(ctx, h); assert.equal(h.resend().props.disabled, true);
    await h.resend().props.onClick(); assert.equal(h.calls.length, 6);
    h.button('Wrong address? Change it').props.onClick(); h.render(); h.password('new-password'); h.token(); await h.submit();
    advance(ctx, h); assert.equal(h.resend().props.disabled, false);
});

for (const flow of ['sign_up', 'magic']) test(`${flow}: closing during the first send cannot restore pending state on reopen`, async ctx => {
    const held = deferred(); const h = gateHarness(ctx, { [flow === 'magic' ? 'sendMagicLink' : 'signUp']: () => held.promise });
    h.open(flow); h.email('person@test.invalid'); if (flow === 'sign_up') h.password('chosen-password'); h.token();
    const sending = h.submit(); h.find(n => n.props['aria-label'] === 'Close').props.onClick(); h.render();
    held.resolve({ needsConfirmation: true }); await sending; h.open(flow);
    assert.equal(h.resend(), undefined); assert.equal(h.field('email').props.value, '');
});

for (const flow of ['sign_up', 'magic']) test(`${flow}: with no Turnstile site key a resend still sends, with no token, exactly as submit does`, async ctx => {
    ctx.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1000000 });
    const h = gateHarness(ctx, { siteKey: '' }); h.open(flow); h.email('person@test.invalid');
    if (flow === 'sign_up') h.password('chosen-password');
    await h.submit(); assert.equal(h.calls.length, 1);
    advance(ctx, h); await h.resend().props.onClick(); h.render();
    const name = flow === 'magic' ? 'resendMagicLink' : 'resendSignupEmail';
    assert.equal(h.calls.length, 2); assert.equal(h.calls[1].name, name);
    assert.equal(h.calls[1].args[1] ?? null, null); assert.doesNotMatch(h.text(), /security check/i);
});

