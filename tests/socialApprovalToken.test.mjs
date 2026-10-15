import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalToken, verifyApprovalToken } from '../lib/social/approvalToken.js';

const reviewerId = '550e8400-e29b-41d4-a716-446655440000';
const secret = 'a-secure-review-link-secret-that-is-long-enough';

test('approval tokens bind an expiring reviewer id', async () => {
    const token = await createApprovalToken({ reviewerId }, secret);
    assert.equal(await verifyApprovalToken(token, secret), reviewerId);
    assert.equal(await verifyApprovalToken(`${token}x`, secret), null);
    assert.equal(await verifyApprovalToken(token, `${secret}x`), null);
});

test('approval tokens reject expiry and weak secrets', async () => {
    const expired = await createApprovalToken({ reviewerId, expiresInSeconds: -1 }, secret);
    assert.equal(await verifyApprovalToken(expired, secret), null);
    await assert.rejects(() => createApprovalToken({ reviewerId }, 'weak'));
    assert.equal(await verifyApprovalToken('broken', secret), null);
});
