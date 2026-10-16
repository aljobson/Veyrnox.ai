import test from 'node:test';
import assert from 'node:assert/strict';
import { apiErrorDetails } from '../app/lib/apiErrorDetails.js';

test('legacy error codes remain stable for existing client branches', () => {
  assert.deepEqual(apiErrorDetails({ error: 'insufficient_balance' }, 402), { code: 'insufficient_balance', message: 'insufficient_balance' });
});
test('structured API failures expose their code and message rather than object coercion', () => {
  assert.deepEqual(apiErrorDetails({ error: { code: 'FORBIDDEN', message: 'Access denied.', requestId: 'request-1' } }, 403), { code: 'FORBIDDEN', message: 'Access denied.' });
});
test('malformed or absent error bodies have stable safe fallback values', () => {
  for (const body of [null, { error: [] }, { error: 123 }, { error: { code: 123, message: {} } }]) {
    assert.deepEqual(apiErrorDetails(body, 502), { code: 'gateway_error', message: 'HTTP 502' });
  }
});
