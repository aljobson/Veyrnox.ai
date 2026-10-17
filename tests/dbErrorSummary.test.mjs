import test from 'node:test';
import assert from 'node:assert/strict';
import { dbErrorSummary } from '../lib/dbErrorSummary.js';

test('a PostgREST error body gives the status, code and message', () => {
    const text = dbErrorSummary({ status: 403, body: { code: '42501', message: 'permission denied for table top_ups', hint: null } });
    assert.equal(text, 'status=403 code=42501 message=permission denied for table top_ups');
});

test('a plain-text body (such as a gateway block page) is shown, so it can be told apart from a database refusal', () => {
    assert.match(dbErrorSummary({ status: 403, body: 'error code: 1010' }), /^status=403 text=error code: 1010$/);
    assert.equal(dbErrorSummary({ status: 502, body: null }), 'status=502 body=none');
    assert.equal(dbErrorSummary(new Error('x')), 'status=none body=none');
    assert.equal(dbErrorSummary(null), 'status=none body=none');
    assert.equal(dbErrorSummary({ status: 'oops', body: [] }), 'status=none body=none');
});

test('credentials, control characters and long text are masked or cut before logging', () => {
    const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.sig_abc-123';
    const text = dbErrorSummary({ status: 401, body: { code: 'PGRST301', message: `bad token ${jwt} and Bearer abc.def sk_live_ABC123 whsec_XYZ789 sb_secret_k3y\nnext` } });
    assert.ok(!/eyJ|sk_live|whsec_|sb_secret|abc\.def/.test(text), text);
    assert.match(text, /\[masked\]/);
    assert.ok(!text.includes('\n'));
    assert.ok(dbErrorSummary({ status: 500, body: { message: 'x'.repeat(5000) } }).length < 260);
    assert.ok(dbErrorSummary({ status: 500, body: 'y'.repeat(5000) }).length < 200);
});
