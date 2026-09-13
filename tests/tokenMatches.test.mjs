import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenMatches, bearerToken } from '../lib/tokenMatches.js';

test('matches only the exact secret', async () => {
    assert.equal(await tokenMatches('s3cret-token', 's3cret-token'), true);
    assert.equal(await tokenMatches('s3cret-tokeN', 's3cret-token'), false);
    assert.equal(await tokenMatches('s3cret', 's3cret-token'), false);
});

test('fails closed on a missing token or an unset secret', async () => {
    for (const [p, e] of [[null, 'x'], [undefined, 'x'], ['', 'x'], ['x', ''], ['x', undefined], ['', '']]) {
        assert.equal(await tokenMatches(p, e), false, `${p} vs ${e}`);
    }
});

test('reads a bearer token and nothing else', () => {
    assert.equal(bearerToken('Bearer abc.def'), 'abc.def');
    for (const h of [null, '', 'Bearer', 'Bearer ', 'bearer abc', 'Basic abc', 'Bearer a b', 'abc']) {
        assert.equal(bearerToken(h), null, String(h));
    }
});
