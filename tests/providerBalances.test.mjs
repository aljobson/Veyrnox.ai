import test from 'node:test';
import assert from 'node:assert/strict';

import {
    ERRORS, FAL_BILLING_URL, KIE_CREDIT_URL, OPENROUTER_CREDITS_URL, PROVIDERS, TIMEOUT_MS,
    assess, checkAll, exitCode, floorFor, readFalBalance, readKieBalance, readOpenrouterBalance, reportLines,
} from '../scripts/lib/provider-balances.mjs';

const KEY = 'secret-key-value-9f8e7d';

/** A fetch that answers every call the same way and records what it was asked. */
function answer(status, body, { throws } = {}) {
    const calls = [];
    const fetcher = async (url, init) => {
        calls.push({ url: String(url), init });
        if (throws) throw throws;
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    };
    return { fetcher, calls };
}

test('fal: the documented shape is read, from the fixed URL, with the key in the header only', async () => {
    const net = answer(200, { username: 'team', credits: { current_balance: 24.5, currency: 'USD' } });
    assert.deepEqual(await readFalBalance(KEY, net.fetcher), { ok: true, balance: 24.5, unit: 'USD' });
    assert.equal(net.calls.length, 1);
    assert.equal(net.calls[0].url, FAL_BILLING_URL);
    assert.equal(net.calls[0].init.headers.Authorization, `Key ${KEY}`);
    assert.equal(net.calls[0].init.method, 'GET');
    assert.equal(net.calls[0].init.redirect, 'manual');
    assert.ok(net.calls[0].init.signal instanceof AbortSignal, 'the read is bounded by a timeout');
});

test('kie: data is the balance; a failing code inside an HTTP 200 is a failure', async () => {
    const ok = answer(200, { code: 200, msg: 'success', data: 100.5 });
    assert.deepEqual(await readKieBalance(KEY, ok.fetcher), { ok: true, balance: 100.5, unit: 'credits' });
    assert.equal(ok.calls[0].url, KIE_CREDIT_URL);
    assert.equal(ok.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    for (const [code, error] of [[401, 'auth_failed'], [429, 'rate_limited'], [500, 'unavailable'], [455, 'bad_response'], [402, 'bad_response']]) {
        assert.deepEqual(await readKieBalance(KEY, answer(200, { code, msg: 'x', data: null }).fetcher), { ok: false, error }, `code ${code}`);
    }
    assert.deepEqual(await readKieBalance(KEY, answer(200, { code: 200, msg: 'success', data: '100' }).fetcher), { ok: false, error: 'bad_response' });
});

test('openrouter: balance is purchased minus used', async () => {
    const net = answer(200, { data: { total_credits: 100.5, total_usage: 25.75 } });
    assert.deepEqual(await readOpenrouterBalance(KEY, net.fetcher), { ok: true, balance: 74.75, unit: 'USD' });
    assert.equal(net.calls[0].url, OPENROUTER_CREDITS_URL);
    assert.equal(net.calls[0].init.headers.Authorization, `Bearer ${KEY}`);
    assert.deepEqual(await readOpenrouterBalance(KEY, answer(200, { data: { total_credits: 100.5 } }).fetcher), { ok: false, error: 'bad_response' });
});

test('every reader maps HTTP failures to a typed error and never to a balance', async () => {
    const cases = [[401, 'auth_failed'], [403, 'forbidden'], [429, 'rate_limited'], [500, 'unavailable'], [503, 'unavailable'], [404, 'bad_response'], [400, 'bad_response']];
    for (const read of [readFalBalance, readKieBalance, readOpenrouterBalance]) {
        for (const [status, error] of cases) {
            assert.deepEqual(await read(KEY, answer(status, { credits: { current_balance: 1, currency: 'USD' }, code: 200, data: { total_credits: 1, total_usage: 0 } }).fetcher),
                { ok: false, error }, `${read.name} ${status}`);
        }
        // Not JSON, JSON that is not an object, an oversized body, no key.
        assert.deepEqual(await read(KEY, answer(200, '<html>').fetcher), { ok: false, error: 'bad_response' }, read.name);
        assert.deepEqual(await read(KEY, answer(200, '[]').fetcher), { ok: false, error: 'bad_response' }, read.name);
        assert.deepEqual(await read(KEY, answer(200, `{"pad":"${'x'.repeat(70 * 1024)}"}`).fetcher), { ok: false, error: 'bad_response' }, read.name);
        assert.deepEqual(await read('', answer(200, {}).fetcher), { ok: false, error: 'not_configured' }, read.name);
        assert.deepEqual(await read(undefined, answer(200, {}).fetcher), { ok: false, error: 'not_configured' }, read.name);
    }
});

test('a timeout and a transport error are typed, and the key is not in the result', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const down = new TypeError(`fetch failed for ${KEY}`);
    for (const read of [readFalBalance, readKieBalance, readOpenrouterBalance]) {
        assert.deepEqual(await read(KEY, answer(0, '', { throws: timeout }).fetcher), { ok: false, error: 'timeout' }, read.name);
        const r = await read(KEY, answer(0, '', { throws: down }).fetcher);
        assert.deepEqual(r, { ok: false, error: 'unreachable' }, read.name);
        assert.ok(!JSON.stringify(r).includes(KEY));
    }
    assert.equal(TIMEOUT_MS, 15000);
});

test('assess: at or under the floor is low, above is ok, any failure or bad floor is unreadable', () => {
    assert.equal(assess({ ok: true, balance: 20, unit: 'USD' }, 20), 'low');
    assert.equal(assess({ ok: true, balance: 0, unit: 'USD' }, 20), 'low');
    assert.equal(assess({ ok: true, balance: 20.01, unit: 'USD' }, 20), 'ok');
    assert.equal(assess({ ok: false, error: 'auth_failed' }, 20), 'unreadable');
    assert.equal(assess({ ok: true, balance: 1000, unit: 'USD' }, NaN), 'unreadable');
    assert.equal(assess({ ok: true, balance: 1000, unit: 'USD' }, -1), 'unreadable');
    assert.equal(assess({ ok: true, balance: 1000, unit: 'USD' }, '20'), 'unreadable');
    assert.equal(assess(null, 20), 'unreadable');
});

test('floors come from the variable when set, else the default; garbage is not a floor', () => {
    const fal = PROVIDERS.find((p) => p.id === 'fal');
    assert.equal(floorFor(fal, {}), 20);
    assert.equal(floorFor(fal, { PROVIDER_BALANCE_FLOOR_FAL_USD: '' }), 20);
    assert.equal(floorFor(fal, { PROVIDER_BALANCE_FLOOR_FAL_USD: '55.5' }), 55.5);
    assert.equal(floorFor(fal, { PROVIDER_BALANCE_FLOOR_FAL_USD: '0' }), 0);
    assert.ok(Number.isNaN(floorFor(fal, { PROVIDER_BALANCE_FLOOR_FAL_USD: 'twenty' })));
    assert.ok(Number.isNaN(floorFor(fal, { PROVIDER_BALANCE_FLOOR_FAL_USD: '-5' })));
    assert.deepEqual(PROVIDERS.map((p) => p.id), ['fal', 'kie', 'openrouter']);
    assert.deepEqual(PROVIDERS.map((p) => p.keyVar), ['FAL_BILLING_KEY', 'KIE_BALANCE_API_KEY', 'OPENROUTER_MANAGEMENT_KEY']);
});

/** A fetch keyed by URL for the full check. */
function network(byUrl) {
    return async (url) => {
        const a = byUrl[String(url)];
        if (!a) return new Response('', { status: 404 });
        return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
    };
}
const ENV = { FAL_BILLING_KEY: 'f', KIE_BALANCE_API_KEY: 'k', OPENROUTER_MANAGEMENT_KEY: 'o' };
const fine = {
    [FAL_BILLING_URL]: { body: { username: 't', credits: { current_balance: 50, currency: 'USD' } } },
    [KIE_CREDIT_URL]: { body: { code: 200, msg: 'success', data: 9000 } },
    [OPENROUTER_CREDITS_URL]: { body: { data: { total_credits: 40, total_usage: 5 } } },
};

test('checkAll: all above floor exits 0 and the report carries no figure unless asked', async () => {
    const results = await checkAll(ENV, network(fine));
    assert.deepEqual(results.map((r) => [r.id, r.state]), [['fal', 'ok'], ['kie', 'ok'], ['openrouter', 'ok']]);
    assert.equal(exitCode(results), 0);
    const lines = reportLines(results);
    assert.deepEqual(lines, [
        'ok         fal        above floor 20 USD',
        'ok         kie        above floor 4000 credits',
        'ok         openrouter above floor 10 USD',
    ]);
    assert.ok(!lines.join('\n').match(/\b(50|9000|35)\b/), 'figures stay out by default');
    assert.match(reportLines(results, { showFigures: true })[0], /\(balance 50 USD\)/);
});

test('checkAll: a low balance exits 1 even when another provider is unreadable', async () => {
    const results = await checkAll(ENV, network({
        ...fine,
        [KIE_CREDIT_URL]: { body: { code: 200, msg: 'success', data: 4000 } },
        [OPENROUTER_CREDITS_URL]: { status: 403, body: { error: { code: 403, message: 'Only management keys can perform this operation' } } },
    }));
    assert.deepEqual(results.map((r) => r.state), ['ok', 'low', 'unreadable']);
    assert.equal(exitCode(results), 1);
    const lines = reportLines(results);
    assert.equal(lines[1], 'LOW        kie        at or under floor 4000 credits');
    assert.equal(lines[2], `UNREADABLE openrouter could not read balance: ${ERRORS.forbidden}; floor 10 USD`);
});

test('checkAll: an unreadable provider is exit 2, never a pass, and a missing key is unreadable', async () => {
    const results = await checkAll({ ...ENV, OPENROUTER_MANAGEMENT_KEY: undefined }, network(fine));
    assert.deepEqual(results.map((r) => r.state), ['ok', 'ok', 'unreadable']);
    assert.equal(exitCode(results), 2);
    assert.equal(reportLines(results)[2], `UNREADABLE openrouter could not read balance: ${ERRORS.not_configured}; floor 10 USD`);

    const badFloor = await checkAll({ ...ENV, PROVIDER_BALANCE_FLOOR_FAL_USD: 'lots' }, network(fine));
    assert.equal(badFloor[0].state, 'unreadable');
    assert.equal(exitCode(badFloor), 2);
    assert.equal(reportLines(badFloor)[0], 'UNREADABLE fal        could not read balance: floor is not a non-negative number; floor invalid (USD)');
});
