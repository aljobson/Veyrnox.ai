import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(
    `export async function resolve(s, c, next) { return next(s === 'next/server' ? 'next/server.js' : s, c); }`,
));
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-role' });
const route = await import('../app/api/v1/jobs/[id]/provenance/route.js');
const id = '11111111-1111-4111-8111-111111111111';

function mockDb({ catalogName, modelId }) {
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/rpc/get_user_job')) return Response.json({ ok: true, state: 'STORED', model_id: modelId, credits: 28, created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:02:00Z' });
        if (u.includes('/rest/v1/model_catalog')) return Response.json([{ id: modelId, name: catalogName, modality: 'image-to-video' }]);
        if (u.includes('/rest/v1/assets')) return Response.json([{ sha256: 'a'.repeat(64), mime_type: 'video/mp4', size_bytes: 10 }]);
        return Response.json([]);
    };
}
const call = () => route.GET(new Request('https://veyrnox.test/api/v1/jobs/x/provenance', { headers: { 'x-veyrnox-auth-id': 'verified-user' } }), { params: Promise.resolve({ id }) });

test('provenance names the model without the supplier or its route notes', async () => {
    mockDb({ catalogName: 'Kling 3.0 Pro I2V (kie, no audio)', modelId: 'kling-3.0-i2v-kie' });
    const res = await call();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.model.name, 'Kling 3.0 Pro I2V');
    assert.equal(body.model.id, 'kling-3.0-i2v-a1');
    assert.doesNotMatch(JSON.stringify(body), /\b(kie|fal|grsai|crun|higgsfield|byteplus|openrouter|replicate)\b/i);
});

test('a retired model falls back to a supplier-neutral id', async () => {
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.includes('/rpc/get_user_job')) return Response.json({ ok: true, state: 'STORED', model_id: 'nano-banana-pro-grsai', credits: 6, created_at: '2026-11-18T10:00:00Z', updated_at: '2026-11-18T10:02:00Z' });
        return Response.json([]);
    };
    const body = await (await call()).json();
    assert.equal(body.model.id, 'nano-banana-pro-a2');
    assert.equal(body.model.name, 'nano-banana-pro');
});

for (const task of ['edit', 'extend']) test(`Seedance 2.5 ${task} provenance never names its supplier`, async () => {
    mockDb({ catalogName: task === 'edit' ? 'Restyle clip' : 'Extend clip', modelId: `seedance-2.5-${task}` });
    const response = await call();
    assert.equal(response.status, 200);
    assert.doesNotMatch(JSON.stringify(await response.json()), /\b(crun|byteplus|mediaoss)\b/i);
});
