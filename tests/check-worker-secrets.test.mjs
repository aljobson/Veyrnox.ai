import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPreserved, failureLine, liveVersions, secretNames } from '../scripts/check-worker-secrets.mjs';

const version = (names) => ({ resources: { bindings: names.map((name) => ({ type: 'secret_text', name })) } });
test('missing pilot binding fails even when other secrets survive', () => {
    assert.throws(() => assertPreserved(['API_KEY', 'PUBLISH_TESTER_AUTH_IDS'], [version(['API_KEY'])]), /PUBLISH_TESTER_AUTH_IDS/);
});
test('plain text with the same name cannot replace a secret', () => {
    assert.throws(() => assertPreserved(['PILOT'], [{ resources: { bindings: [{ name: 'PILOT', type: 'plain_text', text: 'private value' }] } }]), /missing/);
    assert.deepEqual(secretNames(version(['PILOT'])), ['PILOT']);
});
test('all serving versions must preserve bindings, not just one side of a split', () => {
    assert.throws(() => assertPreserved(['PILOT'], [version(['PILOT']), version([])]), /missing/);
    assert.doesNotThrow(() => assertPreserved(['PILOT'], [version(['PILOT', 'NEW'])]));
});
test('unreadable metadata fails closed', () => {
    assert.throws(() => secretNames({}), /unavailable/);
    assert.throws(() => assertPreserved([], []), /unavailable/);
});
test('reads the latest deployment rather than newest uploaded version', async () => {
    const paths = [];
    const result = await liveVersions({ accountId: 'account', workerName: 'worker', token: 'not-logged', fetchImpl: async (url) => {
        paths.push(url);
        return { ok: true, json: async () => ({ success: true, result: url.endsWith('/deployments')
            ? { deployments: [{ created_on: '2026-01-01', versions: [{ version_id: 'old', percentage: 100 }] },
                { created_on: '2026-10-09', versions: [{ version_id: 'live', percentage: 100 }, { version_id: 'inactive', percentage: 0 }] }] }
            : version(['PILOT']) }) };
    } });
    assert.equal(paths.length, 2);
    assert.ok(paths[1].endsWith('/versions/live'));
    assertPreserved(['PILOT'], result);
});

// 2026-10-09 and -10 (#753): one failed read of the Cloudflare API failed a
// deploy (a 504), then rolled back a healthy one (a 404 on the version that
// had just been uploaded). The API is faked: each list answers one try, and
// its last answer repeats.
const TOKEN = 'cf-token-not-logged';
const PRIVATE = 'private value';
const ok = (result) => ({ ok: true, status: 200, json: async () => ({ success: true, result }) });
const status = (code) => ({ ok: false, status: code, json: async () => ({ success: false, errors: [{ message: PRIVATE }] }) });
const DEPLOYMENTS = { deployments: [{ created_on: '2026-10-09', versions: [{ version_id: 'live', percentage: 100 }] }] };
function fakeApi({ deployments = [ok(DEPLOYMENTS)], versions = [ok(version(['PILOT']))], ...options } = {}) {
    const calls = { deployments: 0, versions: 0 };
    const sleeps = [];
    const lines = [];
    const fetchImpl = async (url) => {
        const kind = url.endsWith('/deployments') ? 'deployments' : 'versions';
        const answers = kind === 'deployments' ? deployments : versions;
        const answer = answers[Math.min(calls[kind]++, answers.length - 1)];
        if (answer instanceof Error) throw answer;
        return typeof answer === 'function' ? answer() : answer;
    };
    const read = () => liveVersions({ accountId: 'account', workerName: 'worker', token: TOKEN, fetchImpl,
        sleep: async (ms) => { sleeps.push(ms); }, log: (line) => lines.push(line), ...options });
    return { calls, sleeps, lines, read, failure: () => read().then(() => assert.fail('the read passed'), (error) => error) };
}

test('a 404 on a version uploaded seconds ago is read again, and the check passes', async () => {
    const api = fakeApi({ versions: [status(404), ok(version(['PILOT']))] });
    assertPreserved(['PILOT'], await api.read());
    assert.deepEqual(api.calls, { deployments: 1, versions: 2 });
    assert.deepEqual(api.sleeps, [1000]);
    assert.match(api.lines.join('\n'), /^::notice::GET \/versions\/live answered 404 \(try 1 of 5\); trying again in 1 s\.$/);
});

test('both sides of a split are read, one after the other, each with its own tries', async () => {
    const split = { deployments: [{ created_on: '2026-10-09', versions: [{ version_id: 'a', percentage: 90 }, { version_id: 'b', percentage: 10 }] }] };
    const paths = [];
    const api = fakeApi({ deployments: [ok(split)], versions: [status(404), ok(version(['PILOT'])), () => { paths.push('b'); return ok(version([])); }] });
    const versions = await api.read();
    assert.deepEqual(api.calls, { deployments: 1, versions: 3 });
    assert.deepEqual([api.sleeps, paths], [[1000], ['b']]);
    assert.throws(() => assertPreserved(['PILOT'], versions), /missing secret bindings: PILOT/);
});

test('a 404 on every try fails closed, and says the Worker could not be read', async () => {
    const api = fakeApi({ versions: [status(404)] });
    const error = await api.failure();
    assert.deepEqual(api.calls, { deployments: 1, versions: 5 });
    assert.deepEqual(api.sleeps, [1000, 2000, 4000, 8000]);
    assert.match(error.message, /^GET \/versions\/live answered 404; gave up after 5 tries over \d+ s$/);
    assert.match(failureLine(error), /^Secret binding check could not read the live Worker, so the bindings were NOT checked: GET /);
    assert.doesNotMatch(failureLine(error), /missing/);
});

test('a readable version that lacks a name fails at once: one read, no further tries', async () => {
    const api = fakeApi({ versions: [ok(version(['API_KEY']))] });
    const versions = await api.read();
    assert.deepEqual(api.calls, { deployments: 1, versions: 1 });
    assert.deepEqual(api.sleeps, []);
    assert.deepEqual(api.lines, []);
    let error;
    try { assertPreserved(['API_KEY', 'PUBLISH_TESTER_AUTH_IDS'], versions); } catch (thrown) { error = thrown; }
    assert.equal(failureLine(error), 'Secret binding check failed: Live Worker is missing secret bindings: PUBLISH_TESTER_AUTH_IDS');
});

test('408, 429, any 5xx, a timeout, a network error and an answer that broke off are tried again', async () => {
    const timeout = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    const network = new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    const brokeOff = { ok: true, status: 200, json: async () => { throw new TypeError('terminated'); } };
    for (const first of [status(408), status(429), status(500), status(502), status(503), status(504), status(522), timeout, network, brokeOff]) {
        for (const read of ['deployments', 'versions']) {
            const api = fakeApi({ [read]: [first, read === 'deployments' ? ok(DEPLOYMENTS) : ok(version(['PILOT']))] });
            assertPreserved(['PILOT'], await api.read());
            assert.deepEqual(api.sleeps, [1000]);
            assert.equal(api.calls[read], 2);
        }
    }
    const api = fakeApi({ deployments: [network, timeout, ok(DEPLOYMENTS)] });
    await api.read();
    assert.match(api.lines[0], /GET \/deployments did not answer \(ECONNRESET\) \(try 1 of 5\)/);
    assert.match(api.lines[1], /GET \/deployments did not answer \(TimeoutError\) \(try 2 of 5\); trying again in 2 s\./);
});

test('401, 403, another 4xx and an answer of the wrong shape are final: one try', async () => {
    const notJson = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    const refused = { ok: true, status: 200, json: async () => ({ success: false, result: null }) };
    for (const answer of [status(401), status(403), status(400), notJson, refused]) {
        for (const read of ['deployments', 'versions']) {
            const api = fakeApi({ [read]: [answer, read === 'deployments' ? ok(DEPLOYMENTS) : ok(version(['PILOT']))] });
            const error = await api.failure();
            assert.match(error.message, /; not tried again$/);
            assert.match(failureLine(error), /could not read the live Worker/);
            assert.equal(api.calls[read], 1);
            assert.deepEqual(api.sleeps, []);
        }
    }
    const empty = fakeApi({ deployments: [ok({ deployments: [] })] });
    assert.match(failureLine(await empty.failure()), /could not read the live Worker.*Live deployment unavailable/);
    assert.equal(empty.calls.deployments, 1);
    const noBindings = await fakeApi({ versions: [ok({ id: 'live' })] }).read();
    let error;
    try { assertPreserved(['PILOT'], noBindings); } catch (thrown) { error = thrown; }
    assert.match(failureLine(error), /could not read the live Worker.*bindings unavailable/);
});

test('the whole check stops at its time budget, and a read left with no time is not made', async () => {
    let clock = 0;
    const hang = () => { clock += 10_000; throw new DOMException('timeout', 'TimeoutError'); };
    const timed = { now: () => clock, sleep: async (ms) => { clock += ms; } };
    const hung = fakeApi({ deployments: [hang], ...timed });
    const error = await hung.failure();
    // 10 + 1 + 10 + 2 + 10 + 4 + 10 s: an 8 s wait would pass the 45 s budget.
    assert.equal(hung.calls.deployments, 4);
    assert.match(error.message, /^GET \/deployments did not answer \(TimeoutError\); gave up after 4 tries over \d+ s$/);

    clock = 0;
    const slow = fakeApi({ deployments: [() => { clock += 45_000; return ok(DEPLOYMENTS); }], ...timed });
    assert.match(failureLine(await slow.failure()), /could not read the live Worker.*GET \/versions\/live was not tried: the 45 s for the whole check were used up/);
    assert.equal(slow.calls.versions, 0);
});

test('no binding value, API error text or token reaches the log or the error', async () => {
    const odd = { deployments: [{ created_on: '2026-10-09', versions: [{ version_id: 'x\n::error::owned', percentage: 100 }] }] };
    const telling = new TypeError(`fetch failed for ${TOKEN}: ${PRIVATE}`);
    const api = fakeApi({ deployments: [telling, status(503), ok(odd)], versions: [status(404)] });
    const error = await api.failure();
    const said = [...api.lines, error.message, failureLine(error)].join('|');
    assert.equal(said.includes(TOKEN), false);
    assert.equal(said.includes(PRIVATE), false);
    assert.equal(/[\r\n]/.test(said), false, 'a version id from the API broke the log line');
    assert.equal(api.lines.length, 6);
});
