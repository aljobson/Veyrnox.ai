import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { CAPTCHA_BLOCKED_CODE, CAPTCHA_UNSUPPORTED, CAPTCHA_WAITING, TURNSTILE_FAILURE_PATH } from '../app/lib/turnstileFailure.js';
import { REPORT_BODY_LIMIT, acceptTurnstileFailure, turnstileReportRateLimit } from '../lib/turnstileFailureReport.js';

// A Turnstile check that fails in the browser reaches neither Supabase nor us,
// so the owner could not count them (ADR-0026 amendment 2). The browser now
// posts the error code to a route outside the gate, and the Worker logs it.
// The line holds the code and nothing about the person who sent it.

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(s, c, next) {
    if (s.endsWith('/.open-next/worker.js')) return {
      url: 'data:text/javascript,' + encodeURIComponent('export default {fetch: (...args) => globalThis.__reportTestApp(...args)};'), shortCircuit: true
    };
    return next(s, c);
  }
`));
const worker = (await import('../worker.js')).default;

const HOST = 'veyrnox.test';
const post = (body, headers = { 'sec-fetch-site': 'same-origin' }, path = TURNSTILE_FAILURE_PATH) => new Request(`https://${HOST}${path}`, {
    method: 'POST', body, headers: { 'cf-connecting-ip': '192.0.2.1', ...headers },
});
const LINE = (code) => [{ event: 'auth.turnstile_check_failed', code }];

async function accept(request) {
    const lines = [];
    const res = await acceptTurnstileFailure(request, (...args) => lines.push(args));
    return { res, lines };
}

// ---- the route: what is accepted, and what is written ----

test('a code from our own page is counted: 204, no body, one line', async () => {
    for (const code of ['600010', '110200', '200500', '300', '123456789', 'unknown', 'unsupported']) {
        const { res, lines } = await accept(post(code));
        assert.equal(res.status, 204, code);
        assert.equal(await res.text(), '');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(lines, [LINE(code)], code);
    }
});

test('anything that is not exactly a code is refused and never logged', async () => {
    const bad = ['', '12', '1234567890', ' 600010', '600010 ', '600010\n', '6000a0', '-60001', '600.10', 'Unknown', 'UNKNOWN',
        'unknown ', '{"code":600010}', '"600010"', 'a@b.co', '0.AbCd-token_1', '600010,600020', '٦٠٠٠١٠',
        // One word is counted besides "unknown" (amendment 5). Its neighbours are not, and neither is the dialog's other word.
        'Unsupported', 'UNSUPPORTED', 'unsupported ', ' unsupported', 'unsupported\n', 'unsupportedx', 'unsupporte', 'waiting', 'supported'];
    for (const body of bad) {
        const { res, lines } = await accept(post(body));
        assert.equal(res.status, 400, JSON.stringify(body));
        assert.deepEqual(await res.json(), { error: 'invalid_code' });
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.deepEqual(lines, [], JSON.stringify(body));
    }
    const { res, lines } = await accept(new Request(`https://${HOST}${TURNSTILE_FAILURE_PATH}`, { method: 'POST', headers: { 'sec-fetch-site': 'same-origin' } }));
    assert.equal(res.status, 400, 'no body at all');
    assert.deepEqual(lines, []);
    // Bytes that are not the code: a byte-order mark before it, a NUL after it, and text that is not UTF-8.
    for (const bytes of [[0xEF, 0xBB, 0xBF, 0x36, 0x30, 0x30], [0x36, 0x30, 0x30, 0x00], [0xFF, 0xFE, 0x36, 0x30, 0x30], [0xC0, 0x80, 0x36, 0x30, 0x30]]) {
        const odd = await accept(post(new Uint8Array(bytes)));
        assert.equal(odd.res.status, 400, bytes.join(' '));
        assert.deepEqual(odd.lines, []);
    }
});

test('a body over the limit is refused, with or without a Content-Length', async () => {
    assert.equal(REPORT_BODY_LIMIT, 16);
    const big = '6'.repeat(REPORT_BODY_LIMIT + 1);
    const streamed = () => new Request(`https://${HOST}${TURNSTILE_FAILURE_PATH}`, {
        method: 'POST', duplex: 'half', headers: { 'sec-fetch-site': 'same-origin' },
        body: new ReadableStream({ pull(c) { c.enqueue(new TextEncoder().encode('60001060')); } }),
    });
    for (const request of [post(big), post('x'.repeat(70000)), streamed()]) {
        const { res, lines } = await accept(request);
        assert.equal(res.status, 413);
        assert.deepEqual(await res.json(), { error: 'body_too_large' });
        assert.deepEqual(lines, []);
    }
    // A short body that lies about its length is judged by its bytes.
    assert.equal((await accept(post('600010', { 'sec-fetch-site': 'same-origin', 'content-length': '9999' }))).res.status, 204);
});

test('only a page of ours can report', async () => {
    const refused = [
        { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' }, { 'sec-fetch-site': '' },
        // The browser's own word wins over an Origin that happens to match.
        { 'sec-fetch-site': 'cross-site', origin: `https://${HOST}`, host: HOST },
        // No browser at all: curl sends neither header.
        {}, { host: HOST }, { origin: `https://${HOST}` },
        { origin: 'https://evil.example', host: HOST }, { origin: `https://${HOST}.evil.example`, host: HOST },
        { origin: 'null', host: HOST }, { origin: 'not a url', host: HOST }, { origin: `https://${HOST}:8443`, host: HOST },
    ];
    for (const headers of refused) {
        const request = post('600010', headers);
        const { res, lines } = await accept(request);
        assert.equal(res.status, 403, JSON.stringify(headers));
        assert.deepEqual(await res.json(), { error: 'cross_site_request' });
        assert.equal(request.bodyUsed, false, 'refused before the body is read');
        assert.deepEqual(lines, []);
    }
    // A browser too old to send Sec-Fetch-Site still sends Origin on a POST.
    for (const headers of [{ origin: `https://${HOST}`, host: HOST }, { origin: 'http://localhost:3000', host: 'localhost:3000' }]) {
        assert.equal((await accept(post('600010', headers))).res.status, 204, JSON.stringify(headers));
    }
});

test('nothing about the sender reaches the log', async () => {
    const { res, lines } = await accept(post('600010', {
        'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'TestBrowser/1.0',
        cookie: 'session=abc', authorization: 'Bearer abc', referer: `https://${HOST}/?auth=magic&email=a@b.co`,
        'x-veyrnox-auth-id': crypto.randomUUID(), 'x-veyrnox-auth-email': 'a@b.co',
    }));
    assert.equal(res.status, 204);
    assert.deepEqual(lines, [LINE('600010')]);
    assert.deepEqual(Object.keys(lines[0][0]), ['event', 'code']);

    // The handler reads three headers, all of them the browser's own account of where the request came from.
    const src = readFileSync(new URL('../lib/turnstileFailureReport.js', import.meta.url), 'utf8');
    const handler = src.slice(src.indexOf('function fromOurOwnPage'));
    assert.deepEqual([...handler.matchAll(/headers\.get\('([^']+)'\)/g)].map((m) => m[1]).sort(), ['host', 'origin', 'sec-fetch-site']);
    assert.doesNotMatch(src, /x-veyrnox|user-agent|x-forwarded|cookie|referer|request\.cf\b/i);
    // One place writes the count, and it is an object: Workers Logs indexes its keys.
    assert.deepEqual(src.split('\n').filter((l) => /\blog\(/.test(l)).map((l) => l.trim()), ["log({ event: 'auth.turnstile_check_failed', code });"]);
});

test('the route is a POST handler that logs with console.error', async () => {
    const file = `app${TURNSTILE_FAILURE_PATH}/route.js`;
    assert.ok(existsSync(new URL(`../${file}`, import.meta.url)), `${file} serves ${TURNSTILE_FAILURE_PATH}`);
    const route = await import(`../${file}`);
    assert.deepEqual(Object.keys(route), ['POST']);
    const real = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args);
    try {
        // Next hands a route its context as a second argument. It must not be taken for the logger.
        const res = await route.POST(post('110200'), { params: Promise.resolve({}) });
        assert.equal(res.status, 204);
    } finally { console.error = real; }
    assert.deepEqual(lines, [LINE('110200')]);
});

// ---- worker.js: the rate limit, before the app ----

const binding = (limit) => ({ TURNSTILE_REPORT_RATE_LIMITER: { limit } });
const KEY = 'veyrnox-ai:turnstile-failure:v1:192.0.2.1';
const SPELLINGS = [TURNSTILE_FAILURE_PATH, `${TURNSTILE_FAILURE_PATH}/`, `${TURNSTILE_FAILURE_PATH}?x=1`, '/API/Turnstile-Failure',
    '/api/turnstile%2Dfailure', '/%61pi/turnstile-failure', '/api%2Fturnstile-failure', '/api//turnstile-failure',
    '/api/x/%2e%2e/turnstile-failure', '/api/x/..%2Fturnstile-failure', '/%09/api/turnstile-failure', '/api/%0A/turnstile-failure'];

test('over the limit is a typed 429 for every spelling of the path, before the app or the body', async () => {
    let called = 0;
    globalThis.__reportTestApp = () => assert.fail('a limited report reached the app');
    for (const path of SPELLINGS) {
        const req = post('600010', { 'sec-fetch-site': 'same-origin' }, path);
        const res = await worker.fetch(req, binding(async ({ key }) => { called++; assert.equal(key, KEY); return { success: false }; }), {});
        assert.equal(res.status, 429, path);
        assert.equal(req.bodyUsed, false);
        assert.equal(res.headers.get('retry-after'), '60');
        assert.equal(res.headers.get('cache-control'), 'no-store');
        assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(res.headers.get('access-control-allow-origin'), null);
        assert.deepEqual(await res.json(), { error: 'rate_limited', retry_after_seconds: 60 });
    }
    assert.equal(called, SPELLINGS.length);
});

test('a report under the limit reaches the app with its body', async () => {
    const env = binding(async ({ key }) => { assert.equal(key, KEY); return { success: true }; });
    const ctx = {};
    let seen;
    globalThis.__reportTestApp = async (r, e, c) => {
        assert.equal(e, env); assert.equal(c, ctx);
        seen = { url: r.url, method: r.method, body: await r.text(), site: r.headers.get('sec-fetch-site') };
        return new Response(null, { status: 204 });
    };
    assert.equal((await worker.fetch(post('600010'), env, ctx)).status, 204);
    assert.deepEqual(seen, { url: `https://${HOST}${TURNSTILE_FAILURE_PATH}`, method: 'POST', body: '600010', site: 'same-origin' });
});

test('a wrong method is a typed 405 and spends no quota', async () => {
    globalThis.__reportTestApp = () => assert.fail('a wrong method reached the app');
    const env = binding(() => assert.fail('a wrong method spent quota'));
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']) {
        const res = await worker.fetch(new Request(`https://${HOST}${TURNSTILE_FAILURE_PATH}`, { method }), env, {});
        assert.equal(res.status, 405, method);
        assert.equal(res.headers.get('allow'), 'POST');
        // An OPTIONS preflight gets no CORS grant: another origin cannot post here.
        assert.equal(res.headers.get('access-control-allow-origin'), null);
        assert.equal(res.headers.get('access-control-allow-methods'), null);
        if (method !== 'HEAD') assert.deepEqual(await res.json(), { error: 'method_not_allowed' });
    }
});

test('a missing or failing limiter refuses the report and exposes nothing', async () => {
    globalThis.__reportTestApp = () => assert.fail('an unlimited report reached the app');
    const real = console.error;
    const lines = [];
    console.error = (...args) => lines.push(args.join(' '));
    try {
        for (const env of [{}, binding(async () => { throw new Error('private-detail'); }),
            ...[null, undefined, {}, { success: 'true' }, { success: 1 }].map((v) => binding(async () => v))]) {
            const res = await worker.fetch(post('600010'), env, {});
            assert.equal(res.status, 503);
            assert.equal(res.headers.get('retry-after'), '30');
            assert.deepEqual(await res.json(), { error: 'rate_limit_unavailable', retry_after_seconds: 30 });
        }
    } finally { console.error = real; }
    assert.ok(lines.length > 0 && lines.every((l) => l === '[turnstile-report] rate limiter unavailable'), lines.join('\n'));
});

test('other paths never spend the quota, and admin paths keep their own', async () => {
    let forwarded = 0;
    globalThis.__reportTestApp = () => { forwarded++; return new Response('ok'); };
    const env = binding(() => assert.fail('an unrelated request spent report quota'));
    const paths = ['/', '/?auth=magic', '/api/catalog', '/api/v1/session/me', '/api/webhook/stripe', '/api/turnstile-failures',
        '/api/turnstile-failure/x', '/api/v1/turnstile-failure', '/turnstile-failure', '/app?next=/api/turnstile-failure'];
    for (const path of paths) assert.equal((await worker.fetch(post('600010', {}, path), env, {})).status, 200, path);
    assert.equal(forwarded, paths.length);
    // An admin path is screened by the admin limiter alone (ADR-0039).
    const admin = await worker.fetch(post('600010', {}, '/api/admin/reap-assets'), {
        ...env, ADMIN_EDGE_RATE_LIMITER: { limit: async ({ key }) => { assert.equal(key, 'veyrnox-ai:admin:v1:192.0.2.1'); return { success: false }; } },
    }, {});
    assert.equal(admin.status, 429);
});

test('the bucket is the connecting IP and nothing a caller can choose', async () => {
    const keys = [];
    const env = binding(async ({ key }) => { keys.push(key); return { success: true }; });
    for (const headers of [{}, { 'x-forwarded-for': '198.51.100.7' }, { 'x-veyrnox-auth-id': crypto.randomUUID() }, { authorization: 'Bearer x' },
        { 'user-agent': 'Other/2.0' }, { origin: 'https://evil.example' }]) {
        assert.equal(await turnstileReportRateLimit(post('600010', headers, `${TURNSTILE_FAILURE_PATH}?n=${keys.length}`), env), null);
    }
    assert.deepEqual([...new Set(keys)], [KEY]);
    await turnstileReportRateLimit(post('600010', { 'cf-connecting-ip': '192.0.2.2' }), env);
    assert.equal(keys.at(-1), 'veyrnox-ai:turnstile-failure:v1:192.0.2.2');
    // A missing or malformed address shares one bucket. It is never exempt.
    for (const ip of ['', 'garbage', '999.0.0.1', '192.0.2.1, 192.0.2.2']) {
        await turnstileReportRateLimit(post('600010', { 'cf-connecting-ip': ip }), env);
        assert.equal(keys.at(-1), 'veyrnox-ai:turnstile-failure:v1:unknown');
    }
});

test('an IPv6 connection is one bucket: its /64, not each address in it', async () => {
    const keys = [];
    const env = binding(async ({ key }) => { keys.push(key); return { success: true }; });
    const keyFor = async (ip) => { await turnstileReportRateLimit(post('600010', { 'cf-connecting-ip': ip }), env); return keys.at(-1); };
    const home = 'veyrnox-ai:turnstile-failure:v1:2001:db8:abcd:12::/64';
    // One household can pick any of 2^64 addresses. They are one sender.
    for (const ip of ['2001:db8:abcd:12::1', '2001:db8:abcd:12::2', '2001:DB8:ABCD:12:0:0:0:3', '2001:db8:abcd:12:ffff:ffff:ffff:ffff',
        '2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:0012::']) {
        assert.equal(await keyFor(ip), home, ip);
    }
    assert.equal(await keyFor('2001:db8:abcd:13::1'), 'veyrnox-ai:turnstile-failure:v1:2001:db8:abcd:13::/64');
    // However the address is written, and wherever its run of zeros falls.
    assert.equal(await keyFor('2001:DB8:0:0:0:0:0:1'), 'veyrnox-ai:turnstile-failure:v1:2001:db8:0:0::/64');
    assert.equal(await keyFor('2001:db8::1'), 'veyrnox-ai:turnstile-failure:v1:2001:db8:0:0::/64');
    assert.equal(await keyFor('2001:0:0:1::5'), 'veyrnox-ai:turnstile-failure:v1:2001:0:0:1::/64');
    assert.equal(await keyFor('::1'), 'veyrnox-ai:turnstile-failure:v1:0:0:0:0::/64');
    assert.equal(await keyFor('::'), 'veyrnox-ai:turnstile-failure:v1:0:0:0:0::/64');
    assert.equal(await keyFor('1:2:3:4:5:6:7:8'), 'veyrnox-ai:turnstile-failure:v1:1:2:3:4::/64');
    assert.equal(await keyFor('fe80::1:2:3:4:5'), 'veyrnox-ai:turnstile-failure:v1:fe80:0:0:1::/64');
});

test('deployment binds a limiter of its own on production and staging', () => {
    const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const blocks = [...raw.matchAll(/"ratelimits"\s*:\s*(\[[\s\S]*?\])/g)].map((m) => JSON.parse(m[1]));
    assert.equal(blocks.length, 2, 'production and staging');
    const mine = blocks.map((b) => b.find((r) => r.name === 'TURNSTILE_REPORT_RATE_LIMITER'));
    assert.deepEqual(mine[0], { name: 'TURNSTILE_REPORT_RATE_LIMITER', namespace_id: '2026100901', simple: { limit: 10, period: 60 } });
    assert.deepEqual(mine[1], { name: 'TURNSTILE_REPORT_RATE_LIMITER', namespace_id: '2026100902', simple: { limit: 10, period: 60 } });
    // No namespace is shared: not between the two environments, and not with the admin limiter.
    const ids = blocks.flat().map((r) => r.namespace_id);
    assert.equal(new Set(ids).size, ids.length);
});

// ---- the browser: what is sent, and that it can never hurt the dialog ----

let copy = 0;
/** A fresh copy of the sender, as on a new page load, with `fetch` replaced. */
async function pageLoad(fetchStub) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = fetchStub === undefined ? ((...args) => { calls.push(args); return Promise.resolve(new Response(null, { status: 204 })); }) : fetchStub;
    const mod = await import(`../app/lib/reportTurnstileFailure.js?page=${++copy}`);
    return { ...mod, calls, restore: () => { globalThis.fetch = real; } };
}

test('the browser sends the code and nothing else, to our own origin', async () => {
    const page = await pageLoad();
    try {
        assert.equal(page.reportTurnstileFailure('600010'), undefined);
        assert.equal(page.calls.length, 1);
        const [url, init] = page.calls[0];
        assert.equal(url, '/api/turnstile-failure');
        assert.equal(TURNSTILE_FAILURE_PATH, '/api/turnstile-failure');
        // No cookies, and it outlives the page that sent it. The referrer is cut to the site's origin, so the page
        // address is not sent. Not 'no-referrer': a browser without Sec-Fetch-Site is recognised by its Origin
        // header, and that policy can blank Origin as well.
        assert.deepEqual(init, { method: 'POST', body: '600010', keepalive: true, credentials: 'omit', cache: 'no-store', referrerPolicy: 'origin' });
    } finally { page.restore(); }
});

test('whatever the widget hands over, only a code or "unknown" leaves the browser', async () => {
    const page = await pageLoad();
    try {
        for (const raw of [600020, ' 300030 ', 'someone@example.com', '0.AbCdEf-token-shaped_string.123456', undefined, null, {}, '6'.repeat(40)]) {
            page.reportTurnstileFailure(raw);
        }
        assert.deepEqual(page.calls.map(([, init]) => init.body), ['600020', '300030', 'unknown']);
        for (const [, init] of page.calls) assert.match(init.body, /^(\d{3,9}|unknown)$/);
    } finally { page.restore(); }
});

test('one report per code per page load, and five at most', async () => {
    const page = await pageLoad();
    try {
        assert.equal(page.MAX_REPORTS_PER_PAGE_LOAD, 5);
        // Turnstile retries by itself, and a reopened dialog fails the same way.
        for (let i = 0; i < 20; i++) page.reportTurnstileFailure('600010');
        assert.equal(page.calls.length, 1);
        for (let code = 300010; code < 300030; code++) page.reportTurnstileFailure(code);
        assert.equal(page.calls.length, 5);
        page.reportTurnstileFailure('200100');
        assert.equal(page.calls.length, 5);
    } finally { page.restore(); }
    // A reload is a new page, and may report again.
    const next = await pageLoad();
    try {
        next.reportTurnstileFailure('600010');
        assert.equal(next.calls.length, 1);
    } finally { next.restore(); }
});

test('a report that cannot be sent is dropped: no throw, no retry, no unhandled rejection', async () => {
    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on('unhandledRejection', onUnhandled);
    try {
        let attempts = 0;
        const failures = [
            () => { attempts++; throw new TypeError('fetch is blocked'); },
            () => { attempts++; return Promise.reject(new TypeError('Failed to fetch')); },
            () => { attempts++; return Promise.resolve(new Response('{"error":"rate_limited"}', { status: 429 })); },
            () => { attempts++; return Promise.resolve(new Response(null, { status: 503 })); },
            () => { attempts++; return undefined; },
            null,
        ];
        for (const stub of failures) {
            const page = await pageLoad(stub);
            try {
                assert.doesNotThrow(() => page.reportTurnstileFailure('600010'));
                assert.doesNotThrow(() => page.reportTurnstileFailure('600010'));
            } finally { page.restore(); }
        }
        // Each page tried once. A failed report is not sent again.
        assert.equal(attempts, failures.length - 1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepEqual(unhandled, []);
    } finally { process.off('unhandledRejection', onUnhandled); }
});

// The components are JSX, so these read the source, like turnstileFailure.test.mjs.
const turnstile = readFileSync(new URL('../components/Turnstile.jsx', import.meta.url), 'utf8');
const authGate = readFileSync(new URL('../components/AuthGate.jsx', import.meta.url), 'utf8');
const sender = readFileSync(new URL('../app/lib/reportTurnstileFailure.js', import.meta.url), 'utf8');

test('the widget reports a failure where it logs it: once, not on every retry', () => {
    assert.match(turnstile, /import \{ reportTurnstileFailure \} from "\.\.\/app\/lib\/reportTurnstileFailure\.js";/);
    assert.match(turnstile, /if \(lastFailure\.current !== code\) \{\s*lastFailure\.current = code;\s*console\.error\("\[auth\] turnstile check failed:", code\);\s*reportTurnstileFailure\(code\);\s*\}/);
    // The dialog is told whatever happens to the report, and the report returns nothing to act on.
    const onError = turnstile.slice(turnstile.indexOf('"error-callback": (raw) => {'), turnstile.indexOf('return true;'));
    assert.ok(onError.indexOf('onToken(null);') < onError.indexOf('reportTurnstileFailure(code);'));
    assert.match(onError, /reportTurnstileFailure\(code\);\s*\}\s*onFailure\(code\);/);
    assert.doesNotMatch(turnstile, /(await|return|=)\s*reportTurnstileFailure\(/);
});

test('a script that cannot load is reported as the code the dialog files it under', () => {
    assert.equal(CAPTCHA_BLOCKED_CODE, '200500');
    assert.match(turnstile, /s\.onerror = \(\) => \{[^}]*scriptPromise = null;\s*reportTurnstileFailure\(CAPTCHA_BLOCKED_CODE\);\s*reject\(new Error\("turnstile_load_failed"\)\);\s*\};/);
    assert.equal(turnstile.match(/reportTurnstileFailure\(/g).length, 3);
});

test('a widget that waits for a click is not counted: a wait is not a failure', async () => {
    // ADR-0026 amendment 3. The callback tells the dialog and nothing else,
    // and the two calls above stay the only places a report is sent from.
    assert.match(turnstile, /"before-interactive-callback": \(\) => onWaiting\(\),/);
    assert.equal(turnstile.match(/reportTurnstileFailure\(/g).length, 3);
    // The word is no code, so it could not leave the browser as itself.
    const page = await pageLoad();
    try {
        page.reportTurnstileFailure(CAPTCHA_WAITING);
        assert.deepEqual(page.calls.map(([, init]) => init.body), ['unknown']);
    } finally { page.restore(); }
});

test('an unsupported browser is counted under a word of our own, once per page load', async () => {
    // ADR-0026 amendment 5. Turnstile gives this case no code, so the count gets the word "unsupported".
    assert.match(turnstile, /"unsupported-callback": \(\) => \{\s*reportTurnstileFailure\(CAPTCHA_UNSUPPORTED\);\s*onUnsupported\(\);\s*\},/);
    // Three places send a report: a failed check, a script that cannot load, and this.
    assert.equal(turnstile.match(/reportTurnstileFailure\(/g).length, 3);
    assert.equal(CAPTCHA_UNSUPPORTED, 'unsupported');
    const page = await pageLoad();
    try {
        // A reopened dialog mounts a new widget, which is refused again.
        for (let i = 0; i < 5; i++) page.reportTurnstileFailure(CAPTCHA_UNSUPPORTED);
        assert.equal(page.calls.length, 1);
        const [url, init] = page.calls[0];
        assert.equal(url, '/api/turnstile-failure');
        assert.deepEqual(init, { method: 'POST', body: 'unsupported', keepalive: true, credentials: 'omit', cache: 'no-store', referrerPolicy: 'origin' });
        // It shares the cap of five with the codes.
        for (let code = 300010; code < 300030; code++) page.reportTurnstileFailure(code);
        assert.equal(page.calls.length, 5);
    } finally { page.restore(); }
    // The route takes it from a page of ours and writes the word in the same field.
    const { res, lines } = await accept(post('unsupported'));
    assert.equal(res.status, 204);
    assert.deepEqual(lines, [LINE('unsupported')]);
    assert.ok(new TextEncoder().encode('unsupported').length <= REPORT_BODY_LIMIT);
});

test('the dialog itself knows nothing about the report', () => {
    assert.doesNotMatch(authGate, /reportTurnstileFailure|turnstile-failure|TURNSTILE_FAILURE_PATH/);
    // The sender has no state the dialog could read, shows nothing and logs nothing.
    assert.doesNotMatch(sender, /console\.|setNotice|useState|localStorage|sessionStorage|document\.|navigator\.|location\b/);
    assert.deepEqual([...sender.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]), ['MAX_REPORTS_PER_PAGE_LOAD', 'reportTurnstileFailure']);
});
