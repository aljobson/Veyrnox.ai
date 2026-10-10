import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/v1/projects/[id]/assets/route.js';

Object.assign(process.env, { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000',
    SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_local_test', TENANT_PROJECTS_ENABLED: 'true' });
const originalFetch = globalThis.fetch;
test.after(() => { globalThis.fetch = originalFetch; });
const id = crypto.randomUUID();
const request = () => new Request(`http://localhost:3000/api/v1/projects/${id}/assets`, {
    method: 'POST', headers: { 'x-veyrnox-auth-id': crypto.randomUUID(), 'x-request-id': crypto.randomUUID(), authorization: 'Bearer test-user',
        'content-type': 'application/json', 'idempotency-key': 'project-media-gate-test' },
    body: JSON.stringify({ media_type: 'video/mp4', size_bytes: 100 }),
});

test('cloud document activation does not permit project uploads without their own gate', async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('No reservation or signing is permitted'); };
    for (const value of [undefined, 'false']) {
        if (value === undefined) delete process.env.PROJECT_MEDIA_UPLOADS_ENABLED;
        else process.env.PROJECT_MEDIA_UPLOADS_ENABLED = value;
        const response = await POST(request(), { params: { id } });
        assert.equal(response.status, 404);
        assert.equal((await response.json()).error.code, 'NOT_FOUND');
    }
    assert.equal(calls, 0);
});

test('the staging upload gate retains the existing storage configuration check', async () => {
    process.env.PROJECT_MEDIA_UPLOADS_ENABLED = 'true';
    for (const key of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']) delete process.env[key];
    const response = await POST(request(), { params: { id } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'STORAGE_UNAVAILABLE');
});
