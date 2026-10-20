import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GET, PUT } from '../app/api/v1/account/language/route.js';
import { readAccountLanguage } from '../lib/accountLanguage.js';
import { buildMessages, PLATFORM_INSTRUCTION } from '../lib/chat.js';
import { createHelpPlan } from '../lib/helpAssistant.js';
import { emailMessages, renderViolation, renderAppeal } from '../lib/i18n/email.mjs';
import { notifyViolation, notifyAppealDecision } from '../lib/violationEmail.js';

const auth = '11111111-1111-4111-8111-111111111111';
const savedFetch = globalThis.fetch;
const savedEnv = { ...process.env };
test.beforeEach(() => Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' }));
test.afterEach(() => { globalThis.fetch = savedFetch; process.env = { ...savedEnv }; });
function request(method = 'GET', body, headers = {}) {
    return new Request('https://veyrnox.test/api/v1/account/language', { method,
        headers: { 'x-veyrnox-auth-id': auth, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test('language route validates identity, body, locale and same-origin before any RPC', async () => {
    globalThis.fetch = async () => assert.fail('unexpected upstream call');
    for (const method of [GET, PUT]) for (const id of ['', 'malformed']) {
        assert.equal((await method(request('GET', undefined, { 'x-veyrnox-auth-id': id }))).status, 401);
    }
    for (const body of [null, [], { locale: 'de', authId: 'someone' }]) assert.equal((await PUT(request('PUT', body))).status, 400);
    for (const locale of [undefined, '', 'DE', 'xx', 1, {}, ' de ']) {
        const res = await PUT(request('PUT', { locale }));
        assert.equal(res.status, 400); assert.deepEqual(await res.json(), { error: 'invalid_locale' });
    }
    for (const method of [GET, PUT]) {
        assert.equal((await method(request('GET', undefined, { origin: 'https://other.test' }))).status, 403);
        assert.equal((await method(request('GET', undefined, { 'sec-fetch-site': 'same-site' }))).status, 403);
    }
});

test('GET/PUT use only verified identity, normalize English, and return only stored locale', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const args = JSON.parse(init.body); calls.push({ url: String(url), args });
        assert.equal(args.p_auth_id, auth);
        return Response.json({ ok: true, locale: Object.hasOwn(args, 'p_locale') ? args.p_locale : 'de', private: 'omit' });
    };
    for (const locale of [null, 'en', ...Object.keys(emailMessages).filter(code => code !== 'en')]) {
        const res = await PUT(request('PUT', { locale }, { origin: 'https://veyrnox.test' }));
        assert.equal(res.status, 200); assert.deepEqual(await res.json(), { locale: locale === 'en' ? null : locale });
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(res.headers.get('access-control-allow-origin'), null);
    }
    const got = await GET(request('GET', undefined, { cookie: 'veyrnox_locale=fr', 'x-site-locale': 'ja' }));
    assert.deepEqual(await got.json(), { locale: 'de' });
    assert.match(calls.at(-1).url, /get_user_language$/);
    assert.deepEqual(calls.at(-1).args, { p_auth_id: auth });
});

test('missing RPC and backend failures reveal only language_unavailable; deleted and unknown are typed', async () => {
    for (const code of ['PGRST202', 'XX000']) {
        globalThis.fetch = async () => Response.json({ code, message: 'private database detail' }, { status: 404 });
        for (const method of [GET, PUT]) {
            const res = await method(request('PUT', { locale: 'de' }));
            assert.equal(res.status, 503); assert.deepEqual(await res.json(), { error: 'language_unavailable' });
            assert.equal(res.headers.get('cache-control'), 'no-store');
        }
    }
    for (const [code, status, error] of [['ACCOUNT_DELETED',409,'account_deleted'],['NOT_FOUND',404,'account_not_found']]) {
        globalThis.fetch = async () => Response.json({ ok: false, code });
        const res = await PUT(request('PUT', { locale: 'de' }));
        assert.equal(res.status, status); assert.deepEqual(await res.json(), { error });
    }
});

test('all original English email branches remain byte-identical; all locales preserve facts and placeholders', () => {
    // Captured from HEAD before the C2 edits, not generated from the new renderer.
    const fixtures = JSON.parse(readFileSync(new URL('./fixtures/account-language-english.json', import.meta.url)));
    const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
    for (const [locale, messages] of Object.entries(emailMessages)) {
        const source = readFileSync(new URL(`../lib/i18n/messages/email/${locale}.mjs`, import.meta.url), 'utf8');
        const keys = [...source.matchAll(/^  "([^"]+)":/gm)].map(match => match[1]);
        assert.equal(keys.length, new Set(keys).size, `${locale}: duplicate keys`);
        assert.deepEqual(Object.keys(messages).sort(), Object.keys(emailMessages.en).sort());
        for (const key of Object.keys(messages)) {
            assert.ok(messages[key]); assert.deepEqual(slots(messages[key]), slots(emailMessages.en[key]), `${locale}:${key}`);
        }
        for (const { kind, input, output } of fixtures) {
            const render = kind === 'violation' ? renderViolation : renderAppeal;
            const result = render(input, locale);
            if (locale === 'en') assert.deepEqual(result, output);
            else assert.notEqual(result.subject, output.subject);
            assert.doesNotMatch(result.text, /\{\w+\}|undefined/);
            assert.deepEqual(result.text.match(/https:\/\/\S+/g), output.text.match(/https:\/\/\S+/g));
            assert.deepEqual(result.text.match(/\d+/g)?.sort(), output.text.match(/\d+/g)?.sort(), `${locale}:${kind}`);
            for (const unknown of [null, undefined, 'xx', 'constructor']) assert.deepEqual(render(input, unknown), output);
        }
    }
    const saved = emailMessages.de.sign;
    try { delete emailMessages.de.sign; assert.match(renderViolation({ tier: 'warning' }, 'de').text, /If you think this was a mistake/); }
    finally { emailMessages.de.sign = saved; }
});

test('both email senders read recipient language by user ID; a missing column preserves the English send', async () => {
    const env = { RESEND_API_KEY: 'test', VIOLATION_EMAIL_FROM: 'test@example.com' };
    for (const notify of [notifyViolation, notifyAppealDecision]) {
        const sent = [];
        const out = await notify({ cfg: {}, userId: 'user-id', actionId: 'action', tier: 'warning', decision: 'upheld', env,
            deps: { select: async (table, query) => {
                assert.equal(table, 'users'); assert.equal(query.filter, 'id=eq.user-id');
                assert.equal(query.columns, 'email,preferred_locale'); return [{ email: 'user@example.com', preferred_locale: 'de' }];
            }, sendEmail: async (_cfg, mail) => { sent.push(mail); return { ok: true }; } } });
        assert.equal(out, 'sent'); assert.match(sent[0].subject, /Warnung|Einspruch/);
    }
    let reads = 0;
    assert.equal(await notifyViolation({ cfg: {}, userId: 'u', actionId: 'a', tier: 'warning', env, deps: {
        select: async (_table, query) => {
            if (++reads === 1) throw { body: JSON.stringify({ code: '42703', message: 'column users.preferred_locale does not exist' }) };
            assert.equal(query.columns, 'email'); return [{ email: 'u@example.com' }];
        }, sendEmail: async (_cfg, mail) => { assert.equal(mail.subject, emailMessages.en.warningSubject); return { ok: true }; },
    } }), 'sent');
});

test('Vey language comes from the verified identity; unset prompts remain exact', async () => {
    const calls = [];
    assert.equal(await readAccountLanguage(auth, {}, async (name, args) => {
        calls.push([name, args]); return { ok: true, locale: 'de' };
    }), 'de');
    assert.deepEqual(calls, [['get_user_language', { p_auth_id: auth }]]);
    assert.equal(await readAccountLanguage(auth, {}, async () => { throw Error('missing RPC'); }), null);
    const input = { systemPrompt: 'Be brief.', history: [], text: 'Hello' };
    const base = buildMessages(input);
    assert.equal(base[0].content, `${PLATFORM_INSTRUCTION}\n\nBe brief.`);
    assert.deepEqual(buildMessages({ ...input, locale: 'en' }), base);
    assert.match(buildMessages({ ...input, locale: 'de' })[0].content, /Reply in German unless the person writes in another language/);
    const prompts = [];
    for (const locale of [null, 'en', 'de']) await createHelpPlan({ question: 'Where is the prompt?', pathname: '/app/create', locale,
        env: { OPENROUTER_HELP_API_KEY: 'test' }, fetchImpl: async (_url, init) => {
            prompts.push(JSON.parse(init.body).messages[0].content);
            return Response.json({ choices: [{ message: { content: '{"message":"test","target":null,"action":"none"}' } }] });
        } });
    assert.equal(prompts.length, 3); assert.equal(prompts[0], prompts[1]);
    assert.ok(prompts[2].startsWith(prompts[0])); assert.match(prompts[2], /Reply in German/);
    assert.doesNotMatch(prompts[0], /Reply in German/);
});


test('help handler reads the verified account preference and ignores supplied display headers', async () => {
    const { POST } = await import('../app/api/v1/help/route.js');
    process.env.OPENROUTER_HELP_API_KEY = 'test';
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const name = new URL(url).pathname.split('/').pop();
        const body = JSON.parse(init.body); calls.push(name);
        if (name === 'completions') {
            assert.match(body.messages[0].content, /Reply in German/);
            return Response.json({ choices: [{ message: { content: '{"message":"test","target":null,"action":"none"}' } }] });
        }
        assert.equal(body.p_auth_id, auth);
        return Response.json(name === 'get_user_language' ? { ok: true, locale: 'de' } : { ok: true });
    };
    const res = await POST(new Request('https://veyrnox.test/api/v1/help', { method: 'POST',
        headers: { 'x-veyrnox-auth-id': auth, cookie: 'veyrnox_locale=fr', 'x-site-locale': 'ja' },
        body: JSON.stringify({ question: 'Where is the prompt?', pathname: '/app/create', locale: 'es' }) }));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).plan.source, 'ai');
    assert.ok(calls.includes('get_user_language')); assert.ok(calls.includes('completions'));
});
