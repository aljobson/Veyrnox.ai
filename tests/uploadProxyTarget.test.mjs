import test from 'node:test';
import assert from 'node:assert/strict';
import { validateUploadProxyTarget } from '../lib/uploadProxyTarget.js';

const ALLOW = { UPLOAD_PROXY_ALLOWED_HOSTS: 'my-bucket.s3.eu-west-1.amazonaws.com' };

test('allowlist is mandatory regardless of NODE_ENV', () => {
    assert.throws(() => validateUploadProxyTarget('https://my-bucket.s3.amazonaws.com/x', { env: {} }));
    assert.throws(() => validateUploadProxyTarget('https://my-bucket.s3.amazonaws.com/x', { env: { NODE_ENV: 'development' } }));
});

test('only enumerated hosts pass when the allowlist is set', () => {
    assert.equal(validateUploadProxyTarget('https://my-bucket.s3.eu-west-1.amazonaws.com/k', { env: ALLOW }).ok, true);
    assert.equal(validateUploadProxyTarget('https://other.s3.amazonaws.com/k', { env: ALLOW }).reason, 'host_not_allowed');
    assert.equal(validateUploadProxyTarget('http://my-bucket.s3.eu-west-1.amazonaws.com/k', { env: ALLOW }).reason, 'unsafe_protocol');
    assert.equal(validateUploadProxyTarget('https://169.254.169.254/latest', { env: ALLOW }).reason, 'host_not_allowed');
});

test('S3 heuristic only with the explicit dev opt-in', () => {
    const env = { UPLOAD_PROXY_S3_HEURISTIC: '1' };
    assert.equal(validateUploadProxyTarget('https://any-bucket.s3.amazonaws.com/k', { env }).ok, true);
    assert.equal(validateUploadProxyTarget('https://evil.example.com/k', { env }).reason, 'host_not_allowed');
});
