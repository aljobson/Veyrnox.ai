import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabaseError } from '../packages/db/supabase-client.js';
import { providerSpendBody, providerSpendError, providerSpendLimit } from '../lib/providerSpend.js';

test('maps per-account spend limits to a retryable 429 without exposing amounts', () => {
    const limit = providerSpendLimit({ code: 'PROVIDER_SPEND_LIMIT', scope: 'user_day', retry_after_seconds: 123 });
    assert.deepEqual(limit, { scope: 'user_day', retryAfter: 123, status: 429 });
    assert.deepEqual(providerSpendBody(limit), { error: 'supplier_spend_limit', retry_after_seconds: 123 });
});

test('maps platform and closed circuit breakers to 503', () => {
    assert.equal(providerSpendLimit({ code: 'PROVIDER_SPEND_LIMIT', scope: 'global_hour', retry_after_seconds: 5 }).status, 503);
    assert.equal(providerSpendLimit({ code: 'PROVIDER_SPEND_LIMIT', scope: 'provider_day', retry_after_seconds: 5 }).status, 503);
    assert.equal(providerSpendLimit({ code: 'PROVIDER_SPEND_UNAVAILABLE', scope: 'closed' }).status, 503);
});

test('extracts the database trigger refusal from a PostgREST error body', () => {
    const error = new SupabaseError('rpc failed', {
        status: 400,
        body: { code: 'P0001', message: 'PROVIDER_SPEND_LIMIT:user_hour:3599' },
    });
    assert.deepEqual(providerSpendError(error), { scope: 'user_hour', retryAfter: 3599, status: 429 });
});

test('does not reclassify unrelated database errors', () => {
    assert.equal(providerSpendError(new Error('PROVIDER_SPEND_LIMIT:user_day:10')), null);
    assert.equal(providerSpendLimit({ code: 'INSUFFICIENT_BALANCE' }), null);
});

