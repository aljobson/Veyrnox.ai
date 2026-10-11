import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', FAL_KEY: 'test-fal',
    PUBLIC_HOST: 'https://veyrnox.test', R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access',
    R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test', FREE_ALLOWANCE_ENABLED: 'false', FAL_SUBMIT_OUTCOME_ENABLED: 'false',
});
const { POST } = await import('../app/api/v1/generations/route.js');
const AUTH = '11111111-1111-4111-8111-111111111111', JOB = '22222222-2222-4222-8222-222222222222';
const START = '33333333-3333-4333-8333-333333333333', END = '44444444-4444-4444-8444-444444444444';
const VIDEO = '55555555-5555-4555-8555-555555555555', AUDIO = '66666666-6666-4666-8666-666666666666';
const FOREIGN = '77777777-7777-4777-8777-777777777777', UPLOAD = `uploads/${AUTH}/88888888-8888-4888-8888-888888888888.png`;
const kling = { id: 'kling-3.0-i2v', provider: 'fal', provider_endpoint: 'fal-ai/kling-video/v3/pro/image-to-video', modality: 'image-to-video', credits_5s: 12, active: true, gated_flag: false };
const latent = { ...kling, id: 'latentsync', provider_endpoint: 'fal-ai/latentsync', modality: 'video-to-video' };
const avatar = { ...kling,id: 'kling-avatar-v2',provider_endpoint: 'fal-ai/kling-video/ai-avatar/v2/standard' };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
const mp4 = readFileSync(new URL('./fixtures/editor-render-360p30.mp4', import.meta.url));
function wav(seconds = 1) {
    const data = 16000 * 2 * seconds, bytes = Buffer.alloc(44 + data);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8,4); bytes.write('WAVEfmt ',8); bytes.writeUInt32LE(16,16);
    bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(16000,24); bytes.writeUInt32LE(32000,28);
    bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(data,40); return bytes;
}
const ref = (asset_id,slot) => ({ asset_id,slot });
function network({ model = kling, overrides = {}, replay = false, rate = { ok: true } } = {}) {
    const assets = Object.fromEntries([[START,'png',png,'image/png'],[END,'png',png,'image/png'],[VIDEO,'mp4',mp4,'video/mp4'],[AUDIO,'wav',wav(),'audio/wav']].map(([id,extension,bytes,mime_type]) => [id,{ ok: true, state: 'STORED', r2_key: `jobs/${id}/output.${extension}`, mime_type, bytes, ...overrides[id] }]));
    const objects = new Map(Object.values(assets).map(asset => [`/test/${asset.r2_key}`,asset])); objects.set(`/test/${UPLOAD}`,{ bytes: png, mime_type: 'image/png' });
    const calls = [], real = globalThis.fetch;
    globalThis.fetch = async (url,init = {}) => {
        const u = new URL(String(url)), body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, pathname: u.pathname, host: u.hostname, body });
        if (u.pathname.includes('/rpc/')) {
            const name = u.pathname.split('/rpc/')[1];
            if (name === 'check_generation_rate_limit') return Response.json(rate);
            if (name === 'get_user_asset') {
                const asset = body.p_auth_id === AUTH && assets[body.p_job_id];
                if (!asset) return Response.json({ ok: false, code: 'NOT_FOUND' });
                const { bytes: _bytes,...record } = asset; return Response.json(record);
            }
            if (name === 'ledger_debit') return Response.json({ ok: true, job_id: JOB, balance_after: 76, idempotent: replay });
            return Response.json({ ok: true });
        }
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([model]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'queue.fal.run') return Response.json({ request_id: 'assignment-task' });
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            const object = objects.get(u.pathname); if (!object) return new Response(null,{ status: 404 });
            const range = /bytes=(\d+)-(\d+)/.exec(init.headers?.Range || '');
            const start = range ? Number(range[1]) : 0, end = Math.min(range ? Number(range[2]) : object.bytes.length - 1,object.bytes.length - 1);
            return new Response(object.bytes.subarray(start,end + 1),{ status: 206, headers: { 'content-type': object.mime_type, 'content-range': `bytes ${start}-${end}/${object.bytes.length}` } });
        }
        throw new Error(`Unexpected request: ${u.hostname}${u.pathname}`);
    };
    return { calls,restore: () => { globalThis.fetch = real; } };
}
const rpcCalls = (net,name) => net.calls.filter(call => call.pathname === `/rest/v1/rpc/${name}`);
const submits = net => net.calls.filter(call => call.host === 'queue.fal.run');
const inspections = net => net.calls.filter(call => call.host.endsWith('.r2.cloudflarestorage.com'));
function post(extra = {}) {
    return POST(new Request('https://veyrnox.test/api/v1/generations',{ method: 'POST',headers: { 'x-veyrnox-auth-id': AUTH,'content-type': 'application/json' }, body: JSON.stringify({ model_id: kling.id,idempotency_key: 'source-assignment-test',consent: true,source_assets: [ref(START,'image'),ref(END,'endImage')],inputs: { prompt: 'A slow cinematic camera move',duration_seconds: 10,image_url: 'https://attacker.example/start.png',video_url: 'https://attacker.example/clip.mp4' },...extra }) }));
}
async function rejected(extra,error,options) {
    const net = network(options);
    try {
        const res = await post(extra); assert.ok(res.status >= 400,error); assert.equal((await res.json()).error,error);
        assert.equal(rpcCalls(net,'ledger_debit').length,0,`${error}: no debit`); assert.equal(submits(net).length,0,`${error}: no dispatch`);
        return net.calls;
    } finally { net.restore(); }
}
test('owned start/end frames are inspected after admission and reach the corrected provider fields with both consent receipts',async () => {
    const net = network();
    try {
        assert.equal((await post()).status,200);
        const payload = submits(net)[0].body;
        assert.deepEqual(Object.keys(payload).sort(),['duration','generate_audio','prompt','start_image_url','end_image_url'].sort());
        assert.equal(payload.duration,'10'); assert.equal(payload.generate_audio,false);
        for (const [field,id] of [['start_image_url',START],['end_image_url',END]]) {
            const url = new URL(payload[field]); assert.equal(url.hostname,'test.r2.cloudflarestorage.com'); assert.equal(url.pathname,`/test/jobs/${id}/output.png`);
            assert.equal(url.searchParams.get('X-Amz-Expires'),'900');
        }
        assert.deepEqual(rpcCalls(net,'get_user_asset').map(c => c.body),[{ p_auth_id: AUTH,p_job_id: START },{ p_auth_id: AUTH,p_job_id: END }]);
        const debit = rpcCalls(net,'ledger_debit')[0].body;
        assert.equal(debit.p_credits,24,'only the catalog priced 5-second unit is multiplied');
        assert.deepEqual(debit.p_inputs.source_assets,{ image_url: START,endImage_url: END });
        assert.equal(debit.p_inputs.image_url,undefined); assert.equal(debit.p_inputs.endImage_url,undefined); assert.equal(debit.p_inputs.source_keys,undefined);
        assert.ok(!net.calls.some(c => c.host === 'attacker.example'));
        const index = c => net.calls.indexOf(c);
        assert.ok(index(rpcCalls(net,'check_generation_rate_limit')[0]) < index(rpcCalls(net,'get_user_asset')[0]));
        assert.ok(net.calls.findIndex(c => c.pathname === '/rest/v1/model_catalog') < index(inspections(net)[0]));
        for (const name of ['job_consent_attested','attest_upload_rights']) assert.ok(index(rpcCalls(net,name)[0]) < index(submits(net)[0]),name);
        assert.deepEqual(rpcCalls(net,'job_consent_attested')[0].body,{ p_job_id: JOB });
        assert.deepEqual(rpcCalls(net,'attest_upload_rights')[0].body,{ p_user_id: AUTH,p_version: 'aup-2026-09-26' });
    } finally { net.restore(); }
});
test('start-only, mixed legacy start with explicit end and the same image in both frame slots work without duplicate inspection',async () => {
    for (const sources of [[ref(START,'image')],[START],[START,ref(END,'endImage')],[ref(START,'endImage'),ref(START,'image')]]) {
        const net = network();
        try {
            assert.equal((await post({ source_assets: sources,inputs: { prompt: 'A camera move',duration_seconds: 5 } })).status,200);
            const payload = submits(net)[0].body; assert.ok(payload.start_image_url); assert.equal(payload.duration,'5');
            assert.equal(!!payload.end_image_url,sources.length === 2);
            assert.equal(rpcCalls(net,'get_user_asset').length,new Set(sources.map(s => typeof s === 'string' ? s : s.asset_id)).size);
            assert.equal(inspections(net).length,rpcCalls(net,'get_user_asset').length);
        } finally { net.restore(); }
    }
});
test('declared video/audio slots inspect real containers and measured lengths without broadening legacy image strings',async () => {
    const net = network({ model: latent });
    try {
        assert.equal((await post({ model_id: latent.id,source_assets: [ref(VIDEO,'video'),ref(AUDIO,'audio')],inputs: {} })).status,200);
        const payload = submits(net)[0].body; assert.deepEqual(Object.keys(payload).sort(),['audio_url','video_url']);
        assert.equal(new URL(payload.video_url).pathname,`/test/jobs/${VIDEO}/output.mp4`); assert.equal(new URL(payload.audio_url).pathname,`/test/jobs/${AUDIO}/output.wav`);
        assert.deepEqual(rpcCalls(net,'ledger_debit')[0].body.p_inputs.source_assets,{ video_url: VIDEO,audio_url: AUDIO });
        assert.ok(inspections(net).length > 2,'MP4 duration is actually inspected with range reads');
    } finally { net.restore(); }
    await rejected({ source_assets: [VIDEO] },'source_type_unsupported');
    await rejected({ model_id: latent.id,source_assets: [ref(VIDEO,'video'),ref(AUDIO,'audio')],inputs: {} },'source_too_long',{ model: latent,overrides: { [AUDIO]: { bytes: wav(41) } } });
    await rejected({ model_id: latent.id,source_assets: [ref(VIDEO,'video'),ref(AUDIO,'audio')],inputs: {} },'source_length_unknown',{ model: latent,overrides: { [AUDIO]: { bytes: wav().subarray(0,20) } } });
});
test('invalid or undeclared slots are refused before storage inspection, debit or dispatch',async () => {
    for (const [extra,error] of [
        [{ source_assets: [ref(START,'image'),ref(END,'image')] },'source_slot_invalid'],
        [{ source_assets: [ref(VIDEO,'video')] },'source_slot_invalid'],
        [{ source_assets: [ref(START,'start_image_url')] },'source_asset_invalid'],
        [{ source_assets: [{ ...ref(START,'image'),url: 'https://attacker.example/a.png' }] },'source_asset_invalid'],
        [{ source_assets: [{ slot: 'image',asset_id: {} }] },'source_asset_invalid'],
        [{ source_assets: [ref(START,'image'),ref(END,'endImage')],source_key: UPLOAD },'source_asset_invalid'],
        [{ source_assets: [ref(START,'image')],inputs: { prompt: 'p',endImage_url: 'https://attacker.example/end.png' } },'inputs_key_not_allowed:endImage_url'],
    ]) {
        const calls = await rejected(extra,error);
        assert.equal(calls.filter(c => c.pathname === '/rest/v1/rpc/get_user_asset' || c.host.endsWith('.r2.cloudflarestorage.com')).length,0,error);
    }
    await rejected({ source_assets: [START,END] },'source_key_invalid');
    await rejected({ source_assets: [ref(END,'endImage')] },'inputs_invalid:image_url');
});
test('unowned, expired, wrong declared MIME and mismatched actual bytes never debit or dispatch',async () => {
    for (const [extra,error,overrides] of [
        [{ source_assets: [ref(FOREIGN,'image')] },'source_not_found',{}],
        [{},'source_not_found',{ [START]: { asset_expires_at: '2020-01-01T00:00:00Z' } }],
        [{ source_assets: [ref(VIDEO,'image')] },'source_type_unsupported',{}],
        [{},'source_type_unsupported',{ [START]: { mime_type: 'image/gif' } }],
        [{},'upload_type_mismatch',{ [START]: { bytes: mp4 } }],
    ]) await rejected(extra,error,{ overrides });
});
test('source consent must be the exact boolean true, regardless of frame roles or other consent-shaped fields',async () => {
    for (const consent of [false,'true',1,null,undefined]) {
        const calls = await rejected({ consent,inputs: { prompt: 'p' },upload_consent: true,rights_confirmed: true },'consent_required');
        assert.equal(calls.filter(c => c.pathname === '/rest/v1/rpc/get_user_asset').length,0);
    }
});
test('inactive or gated catalog and denied attempt checks stop before expensive source reads',async () => {
    for (const [options,error] of [[{ model: { ...kling,active: false } },'model_not_found'],[{ model: { ...kling,gated_flag: true } },'model_gated'],[{ rate: { ok: false,code: 'RATE_LIMITED' } },'rate_limited']]) {
        const calls = await rejected({},error,options);
        assert.equal(calls.filter(c => c.pathname === '/rest/v1/rpc/get_user_asset' || c.host.endsWith('.r2.cloudflarestorage.com')).length,0,error);
    }
});
test('an idempotent accepted replay retains source IDs and records no second provider request',async () => {
    const net = network({ replay: true });
    try {
        const res = await post(); assert.equal(res.status,200); assert.equal((await res.json()).idempotent,true);
        assert.equal(submits(net).length,0); assert.deepEqual(rpcCalls(net,'ledger_debit')[0].body.p_inputs.source_assets,{ image_url: START,endImage_url: END });
    } finally { net.restore(); }
});

test('the existing avatar takes owned photo/speech slots and refuses speech beyond its priced bound',async () => {
    const net = network({ model: avatar });
    try {
        assert.equal((await post({ model_id: avatar.id,source_assets: [ref(START,'image'),ref(AUDIO,'audio')],inputs: { prompt: 'Subtle head motion' } })).status,200);
        const payload = submits(net)[0].body;
        assert.deepEqual(Object.keys(payload).sort(),['audio_url','image_url','prompt']);
        assert.equal(new URL(payload.image_url).pathname,`/test/jobs/${START}/output.png`);
        assert.equal(new URL(payload.audio_url).pathname,`/test/jobs/${AUDIO}/output.wav`);
        assert.equal(rpcCalls(net,'ledger_debit')[0].body.p_credits,12,'one unchanged catalog unit');
    } finally { net.restore(); }
    await rejected({ model_id: avatar.id,source_assets: [ref(START,'image'),ref(AUDIO,'audio')],inputs: { prompt: 'p' } },'source_too_long',{ model: avatar,overrides: { [AUDIO]: { bytes: wav(11) } } });
});


test('owned upload descriptors preserve start/end roles, deduplicate inspection and keep sweep identities',async()=>{
    const net=network();
    try {
        const response=await post({source_assets:[],source_keys:[{key:UPLOAD,slot:'endImage'},{key:UPLOAD,slot:'image'}]});
        assert.equal(response.status,200);
        const payload=submits(net)[0].body;
        assert.equal(payload.start_image_url,payload.end_image_url);
        assert.equal(inspections(net).length,1);
        assert.deepEqual(rpcCalls(net,'ledger_debit')[0].body.p_inputs.source_keys,{endImage_url:UPLOAD,image_url:UPLOAD});
        assert.equal(rpcCalls(net,'ledger_debit')[0].body.p_credits,24);
    }finally{net.restore();}
    const mixed=network();try{
        assert.equal((await post({source_assets:[ref(START,'image')],source_keys:[{key:UPLOAD,slot:'endImage'}]})).status,200);
        assert.equal(new URL(submits(mixed)[0].body.end_image_url).pathname,`/test/${UPLOAD}`);
    }finally{mixed.restore();}
});
test('malformed, conflicting, foreign and wrong-kind uploaded slots refuse without debit or dispatch',async()=>{
    for(const [source_keys,source_assets,error] of [
        [[{key:UPLOAD,slot:'start_image_url'}],[],'source_key_invalid'],
        [[{key:UPLOAD,slot:'image',url:'https://outsider.example/a.png'}],[],'source_key_invalid'],
        [[{key:UPLOAD,slot:'image'},{key:UPLOAD,slot:'image'}],[],'source_slot_invalid'],
        [[{key:UPLOAD,slot:'image'}],[ref(START,'image')],'source_slot_invalid'],
        [[{key:UPLOAD,slot:'video'}],[],'source_slot_invalid'],
        [[{key:UPLOAD.replace(AUTH,FOREIGN),slot:'image'}],[],'source_not_found'],
    ])await rejected({source_keys,source_assets},error);
    await rejected({model_id:latent.id,inputs:{},source_assets:[],source_keys:[{key:UPLOAD,slot:'audio'}]},'source_type_unsupported',{model:latent});
});
