import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECKS, assessResponse, checkSite } from '../scripts/check-site-health.mjs';

const healthy = check => ({
    status: check.status,
    contentType: check.html ? 'text/html; charset=utf-8' : check.json ? 'application/json' : 'text/plain',
    body: check.json ? '{"error":"unauthorized"}' : `${check.contains ?? ''}`,
});

test('a healthy response for every check passes', () => {
    for (const check of CHECKS) assert.deepEqual(assessResponse(check, healthy(check)), []);
});

test('wrong status, wrong content type, missing marker and non-JSON are each reported', () => {
    const home = CHECKS.find(c => c.path === '/');
    assert.match(assessResponse(home, { ...healthy(home), status: 500 }).join(), /status 500, expected 200/);
    assert.match(assessResponse(home, { ...healthy(home), contentType: 'application/json' }).join(), /expected text\/html/);
    assert.match(assessResponse(home, { ...healthy(home), body: 'Application error' }).join(), /missing "Veyrnox"/);
    const api = CHECKS.find(c => c.json);
    assert.match(assessResponse(api, { ...healthy(api), body: '<html>' }).join(), /not JSON/);
    assert.match(assessResponse(api, { ...healthy(api), body: '{}' }).join(), /no error code/);
});

test('an unauthenticated API that answers 200 fails the middleware check', () => {
    const api = CHECKS.find(c => c.json);
    assert.match(assessResponse(api, { ...healthy(api), status: 200 }).join(), /status 200, expected 401/);
});

test('a transient failure recovers on retry', async () => {
    let calls = 0;
    const result = await checkSite('https://example.test', {
        delayMs: 0,
        fetchOne: async (_base, check) => (calls++ < CHECKS.length ? { status: 502, body: '' } : healthy(check)),
    });
    assert.deepEqual(result.problems, []);
});

test('a persistent failure is reported after every attempt is used', async () => {
    let calls = 0;
    const result = await checkSite('https://example.test', {
        attempts: 2, delayMs: 0,
        fetchOne: async (_base, check) => { calls++; return check.path === '/pricing' ? { status: 500 } : healthy(check); },
    });
    assert.equal(calls, CHECKS.length * 2);
    assert.match(result.problems.join(), /\/pricing: status 500/);
    assert.equal(result.unreachable, 0);
});

test('network errors count as unreachable', async () => {
    const result = await checkSite('https://example.test', {
        attempts: 1, delayMs: 0,
        fetchOne: async () => { throw Object.assign(new Error('x'), { name: 'TimeoutError' }); },
    });
    assert.equal(result.unreachable, CHECKS.length);
    assert.match(result.problems[0], /unreachable \(TimeoutError\)/);
});
