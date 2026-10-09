// ADR-0067 amendment 10: work that must finish after the reader has gone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestWaitUntil } from '../lib/requestWaitUntil.js';

test('hands work to the request\'s own waitUntil, called on its context', () => {
    const handed = [];
    const ctx = { waitUntil(work) { assert.equal(this, ctx, 'a detached waitUntil is refused by the Worker'); handed.push(work); } };
    const waitUntil = requestWaitUntil(() => ({ env: {}, ctx }));
    const work = Promise.resolve();
    waitUntil(work);
    assert.deepEqual(handed, [work]);
});

test('where there is no Worker there is nothing to hand work to', () => {
    assert.equal(requestWaitUntil(() => { throw new Error('no request context'); }), null);
    assert.equal(requestWaitUntil(() => ({ env: {} })), null);
    assert.equal(requestWaitUntil(() => ({ env: {}, ctx: {} })), null);
    assert.equal(requestWaitUntil(), null, 'the real lookup, outside a Worker');
});

test('the Worker is told when a reader disconnects, in every environment', () => {
    const raw = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
    const lists = [...raw.matchAll(/"compatibility_flags"\s*:\s*(\[[^\]]*\])/g)].map((m) => JSON.parse(m[1]));
    // Environments inherit the top-level list. One that set its own would have to repeat the flag.
    assert.ok(lists.length >= 1);
    for (const flags of lists) assert.ok(flags.includes('enable_request_signal'), 'without it Stop and a closed tab are never seen');
});
