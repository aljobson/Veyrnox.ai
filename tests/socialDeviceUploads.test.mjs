import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
import { checkSocialUpload, socialUploadsEnabled } from '../lib/social/uploadPolicy.js';
import { sweepSocialUploads } from '../lib/social/uploadSweep.js';
const auth = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const key = `social-uploads/${auth}/${id}.png`;
Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test', R2_SECRET_ACCESS_KEY: 'test', R2_BUCKET: 'test',
    PUBLISH_ENABLED: 'true', PUBLISH_UPLOADS_ENABLED: 'true', ACCOUNT_READ_RATE_LIMIT_ENABLED: 'false' });
const { POST, GET, DELETE } = await import('../app/api/v1/social/uploads/route.js');
const req = (body, method = 'POST', owner = auth) => new Request('https://veyrnox.test/api/v1/social/uploads', {
    method, headers: { 'x-veyrnox-auth-id': owner }, ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
});
const upload = { id, r2_key: key, filename: 'test.png', mime_type: 'image/png', size_bytes: 1024, status: 'pending' };
function stub({ rows = [upload], reserve = { ok: true, id, r2_key: key }, range = 'bytes 0-15/1024', bytes, removed = { ok: true } } = {}) {
    const calls = [];
    globalThis.fetch = async (url, init) => {
        const path = new URL(url).pathname;
        calls.push({ path, body: init?.body && JSON.parse(init.body) });
        if (path.endsWith('/consume_social_post_write_request')) return Response.json({ ok: true });
        if (path.endsWith('/reserve_social_upload')) return Response.json(reserve);
        if (path.endsWith('/read_social_upload')) return Response.json({ ok: true, uploads: rows });
        if (path.endsWith('/complete_social_upload')) return Response.json({ ok: true });
        if (path.endsWith('/remove_social_upload')) return Response.json(removed);
        const png = new Uint8Array(16); png.set([137,80,78,71,13,10,26,10]);
        return new Response(bytes || png, { status: 206, headers: { 'Content-Range': range, 'Content-Type': 'image/png' } });
    };
    return calls;
}
test('publish files reject audio, unsupported types, empty and over-limit files', () => {
    for (const [type, size] of [['audio/mpeg',1],['video/quicktime',1],['image/png',0],['image/png',20971521],['video/mp4',104857601]]) assert.equal(checkSocialUpload(type,size).ok,false);
    assert.equal(checkSocialUpload('video/mp4',104857600).ok,true);
    assert.equal(socialUploadsEnabled({ PUBLISH_ENABLED:'true',PUBLISH_UPLOADS_ENABLED:'false' }),false);
});
test('reservation is length-bound and immutable; no credit balance is required', async () => {
    const calls = stub();
    const res = await POST(req({ action:'reserve',rights_confirmed:true,filename:'test.png',content_type:'image/png',size_bytes:1024 }));
    assert.equal(res.status,200);
    const body = await res.json();
    assert.equal(body.headers['If-None-Match'],'*');
    assert.equal(new URL(body.upload_url).searchParams.get('X-Amz-SignedHeaders'),'content-length;content-type;host;if-none-match');
    assert.equal(calls.some((c) => c.path.includes('balance')),false);
});
test('reservation refuses budget failure without returning a URL', async () => {
    stub({ reserve:{ ok:false,code:'UPLOAD_BUDGET_EXCEEDED' } });
    const res = await POST(req({ action:'reserve',rights_confirmed:true,filename:'test.png',content_type:'image/png',size_bytes:1024 }));
    assert.equal(res.status,409); assert.equal((await res.json()).upload_url,undefined);
});
test('completion rejects missing ownership, size mismatch and disguised files', async () => {
    for (const opts of [{ rows:[] },{ range:'bytes 0-15/2048' },{ bytes:new Uint8Array(16) }]) {
        const calls = stub(opts);
        const res = await POST(req({ action:'complete',id }));
        assert.ok([400,404].includes(res.status));
        assert.equal(calls.some((c) => c.path.endsWith('/complete_social_upload')),false);
    }
});
test('verified completion and list expose signed previews, never storage keys', async () => {
    stub();
    const completed = await POST(req({ action:'complete',id }));
    const item = (await completed.json()).upload;
    assert.equal(completed.status,200); assert.equal(item.r2_key,undefined); assert.equal(item.id,id); assert.match(item.url,/X-Amz-Signature=/);
    const listed = await GET(req(null,'GET'));
    assert.equal((await listed.json()).uploads[0].r2_key,undefined);
});
test('disabled uploads and unauthenticated requests fail before network access', async () => {
    let called = false; globalThis.fetch = async () => { called = true; throw new Error('unexpected'); };
    assert.equal((await POST(req({},'POST',''))).status,401);
    process.env.PUBLISH_UPLOADS_ENABLED = 'false';
    assert.equal((await GET(req(null,'GET'))).status,503);
    process.env.PUBLISH_UPLOADS_ENABLED = 'true'; assert.equal(called,false);
});
test('files referenced by posts cannot be removed', async () => {
    stub({ removed:{ ok:false,code:'UPLOAD_IN_USE' } });
    assert.equal((await DELETE(req({ id },'DELETE'))).status,409);
});
test('cleanup releases storage only after confirmed deletion', async () => {
    const released = [];
    const call = async (name, args) => name === 'claim_social_upload_cleanup' ? [{ id, r2_key:key }] : released.push(args.p_id);
    assert.equal((await sweepSocialUploads({}, {}, { call, remove:async () => ({ ok:false }) })).ok,false);
    assert.equal(released.length,0);
    assert.equal((await sweepSocialUploads({}, {}, { call, remove:async () => ({ ok:true }) })).deleted,1);
    assert.deepEqual(released,[id]);
});

test('upload requires an explicit rights confirmation before reserving storage', async () => {
    const calls = stub();
    const res = await POST(req({ action:'reserve',filename:'test.png',content_type:'image/png',size_bytes:1024 }));
    assert.equal(res.status,400);
    assert.equal(calls.some((c) => c.path.endsWith('/reserve_social_upload')),false);
});

test('oversized metadata bodies are rejected before database or storage calls', async () => {
    const calls = stub();
    assert.equal((await POST(req({ action:'reserve',filename:'x'.repeat(5000) }))).status,413);
    assert.equal(calls.length,0);
});
