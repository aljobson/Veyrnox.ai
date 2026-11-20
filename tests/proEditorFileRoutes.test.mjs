import test from 'node:test';
import assert from 'node:assert/strict';
import { POST as reserve, GET as list } from '../app/api/v1/projects/[id]/pro/files/route.js';
import { POST as inspect } from '../app/api/v1/projects/[id]/pro/files/[fileId]/inspect/route.js';
import { GET as download } from '../app/api/v1/projects/[id]/pro/files/[fileId]/download/route.js';
import { GET as head, PUT as putHead } from '../app/api/v1/projects/[id]/pro/head/route.js';
import { createProEditorStorage } from '../app/veyrnox/_lib/proEditorStorage.mjs';
import { createSaveTracker } from '../app/veyrnox/_lib/proEditorSaves.mjs';
import { sha256, withFileInspection } from '../lib/projectFiles.js';
const id = crypto.randomUUID(), fileId = crypto.randomUUID(), actorId = crypto.randomUUID(), sessionId = 'a'.repeat(32);
Object.assign(process.env, { APP_ENV: 'development', PUBLIC_HOST: 'http://localhost:3000', SUPABASE_URL: 'http://127.0.0.1:54321',
 NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_local_test', SUPABASE_SERVICE_ROLE_KEY: 'local-test',
 TENANT_PROJECTS_ENABLED: 'true', EDITOR_RUNTIME_FLAGS: '{"proEditor":"true"}', R2_ACCOUNT_ID: 'local-test', R2_ACCESS_KEY_ID: 'local-test', R2_SECRET_ACCESS_KEY: 'local-test', R2_BUCKET: 'test', R2_JURISDICTION: 'eu' });
const original = globalThis.fetch;
test.after(() => { globalThis.fetch = original; });
const params = { params: Promise.resolve({ id, fileId }) };
const req = (method = 'GET', body) => new Request(`http://localhost:3000/api/v1/projects/${id}/pro/files`, { method,
 headers: { authorization: 'Bearer user-jwt', 'x-veyrnox-auth-id': actorId, 'x-request-id': crypto.randomUUID(), 'content-type': 'application/json', 'idempotency-key': 'file-test-key' },
 ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const bytes = new TextEncoder().encode('{"format":"filmcraft.project","schema_version":17,"project":{}}');
const file = { id: fileId, file_id: fileId, state: 'quarantined', cleanup_state: 'live', declared_bytes: bytes.length, created_at: new Date().toISOString(), r2_key: `org/${id}/project/${id}/file/${fileId}/v1.fcproj` };
const inspected = { ...file, state: 'inspected', content_sha256: await sha256(bytes), byte_size: bytes.length };
test('both gates return 404 for all six handlers before auth, config or any upstream call', async () => {
 globalThis.fetch = async () => { throw Error('must not fetch'); };
 for (const [tenant, flags] of [['false', '{"proEditor":"true"}'], ['true','{}'], ['true','{"proEditor":true}']]) {
  process.env.TENANT_PROJECTS_ENABLED = tenant; process.env.EDITOR_RUNTIME_FLAGS = flags;
  for (const handler of [reserve,list,inspect,download,head,putHead]) assert.equal((await handler(req(),params)).status,404);
 }
 process.env.TENANT_PROJECTS_ENABLED = 'true'; process.env.EDITOR_RUNTIME_FLAGS = '{"proEditor":"true"}';
});
test('reservation signs immutable JSON PUT and resumes settled states without URLs', async () => {
 globalThis.fetch = async (_url, init) => { assert.equal(init.headers.authorization,'Bearer user-jwt'); return Response.json(file); };
 const signed = await (await reserve(req('POST',{ label:'Cut.fcproj',size_bytes:bytes.length }),params)).json();
 assert.equal(signed.headers['If-None-Match'],'*'); assert.equal(signed.content_type,'application/json'); assert.match(signed.upload_url,/if-none-match/);
 for (const saved of [inspected,{ ...file,state:'rejected',reject_reason:'invalid_json' }]) {
  globalThis.fetch = async () => Response.json(saved);
  const body = await (await reserve(req('POST',{ label:'Cut.fcproj',size_bytes:bytes.length }),params)).json();
  assert.equal(body.state,saved.state); assert.equal(body.upload_url,undefined); assert.equal(body.r2_key,undefined);
 }
 for (const [saved,code] of [[{...file,created_at:'2000-01-01'},'upload-closed'],[{...inspected,cleanup_state:'purged'},'file-unavailable']]) {
  globalThis.fetch = async () => Response.json(saved); const r = await reserve(req('POST',{label:'Cut.fcproj',size_bytes:bytes.length}),params);
  assert.equal(r.status,409); assert.equal((await r.json()).error.code,code);
 }
});
test('boundary rejects invalid inputs; list/download/head read with caller JWT and live inspected filter', async () => {
 globalThis.fetch = async () => { throw Error('must not fetch'); };
 for (const body of [{label:'../x',size_bytes:1},{label:'x',size_bytes:8388609},{label:'x',size_bytes:1,extra:1}]) assert.equal((await reserve(req('POST',body),params)).status,400);
 assert.equal((await putHead(req('PUT',{expected_revision:-1,file_id:fileId}),params)).status,400);
 const urls = []; globalThis.fetch = async (url,init) => { urls.push(String(url)); assert.equal(init.headers.authorization,'Bearer user-jwt'); return Response.json([{id}]); };
 assert.equal((await list(req(),params)).status,200); assert.match(urls[1],/state=eq.inspected&cleanup_state=eq.live/); assert.ok(!urls[1].includes('r2_key'));
 globalThis.fetch = async () => Response.json([file]); assert.equal((await download(req(),params)).status,404);
 globalThis.fetch = async () => Response.json([{...inspected,cleanup_state:'claimed'}]); assert.equal((await download(req(),params)).status,409);
 globalThis.fetch = async () => Response.json([inspected]); assert.equal((await download(req(),params)).status,200);
 globalThis.fetch = async () => Response.json([]); assert.equal((await head(req(),params)).status,404);
});
test('inspection records a verdict then verifies a fresh live read; transport failure never writes a rejection', async () => {
 let recorded, reads = 0;
 globalThis.fetch = async (url,init) => {
  const path = String(url);
  if (path.includes('consume_project_file_inspection')) return Response.json(true);
  if (path.includes('/rest/v1/project_files?')) return Response.json([++reads === 1 ? file : inspected]);
  if (path.includes('record_project_file_inspection')) { recorded = JSON.parse(init.body); return Response.json(inspected); }
  if (path.includes('list-type=2')) return new Response(`<ListBucketResult><Contents><Key>${file.r2_key}</Key><LastModified>2026-11-19T00:00:00Z</LastModified><Size>${bytes.length}</Size></Contents></ListBucketResult>`);
  return new Response(bytes);
 };
 const r = await inspect(req('POST'),params); assert.equal(r.status,200); assert.equal((await r.json()).content_sha256,inspected.content_sha256); assert.equal(recorded.p_byte_size,bytes.length); assert.equal(reads,2);
 recorded = null;
 globalThis.fetch = async url => {
  if (String(url).includes('consume_project_file_inspection')) return Response.json(true);
  if (String(url).includes('/rest/v1/project_files?')) return Response.json([file]);
  return new Response('',{status:503});
 };
 assert.equal((await inspect(req('POST'),params)).status,503); assert.equal(recorded,null);
});
test('route -> tenantRequest -> adapter -> tracker promotes a stale head as revision-conflict without vendor details', async () => {
 const apiFetch = async (path,init) => {
  const request = new Request('http://localhost:3000'+path,{...init,headers:{...init.headers,authorization:'Bearer user-jwt','x-veyrnox-auth-id':actorId,'x-request-id':crypto.randomUUID()}});
  return path.endsWith('/head') ? putHead(request,params) : reserve(request,params);
 };
 globalThis.fetch = async url => String(url).includes('set_pro_project_head')
  ? Response.json({code:'PT409',message:'VERSION_CONFLICT',details:'vendor secret'},{status:409}) : Response.json(inspected);
 const tracker = createSaveTracker({ ...createProEditorStorage({projectId:id,sessionId,fetch:apiFetch,uploadFetch:async()=>{ throw Error('no upload expected'); }}),sha256,now:Date.now });
 const candidateId = await tracker.receive({sessionId,name:'Cut.fcproj',bytes,seq:1}); await tracker.idle();
 assert.equal(tracker.snapshot().candidates[0].state,'committed');
 assert.deepEqual(await tracker.promote(candidateId),{ok:false,reason:'revision-conflict'});
 const r = await putHead(req('PUT',{expected_revision:0,file_id:fileId}),params);
 assert.ok(!(await r.text()).includes('vendor secret'));
 for (const [status,code,expected] of [[429,'STORAGE_QUOTA_EXCEEDED','storage-quota-exceeded'],[429,'LIMIT_REACHED','limit-reached'],[409,'IDEMPOTENCY_CONFLICT','idempotency-conflict'],[409,'FILE_UNAVAILABLE','file-unavailable'],[409,'secret','conflict']]) {
  globalThis.fetch = async () => Response.json({message:code},{status});
  assert.equal((await (await putHead(req('PUT',{expected_revision:0,file_id:fileId}),params)).json()).error.code,expected);
 }
});
test('invalid stored payloads receive fixed rejections and cleanup winning the final read prevents success', async () => {
 const cases = [
  [new TextEncoder().encode('{'), 'invalid_json'],
  [new TextEncoder().encode('{"format":"wrong","schema_version":17,"project":{}}'),'invalid_format'],
  [new TextEncoder().encode('{"format":"filmcraft.project","schema_version":"17","project":{}}'),'invalid_schema'],
  [new TextEncoder().encode('{"format":"filmcraft.project","schema_version":17,"project":[]}'),'invalid_project'],
  [bytes,'size_mismatch',bytes.length+1], [bytes,'too_large',8388609],
 ];
 for (const [stored,reason,size=stored.length] of cases) {
  let recorded, readCount=0;
  const reserved={...file,declared_bytes:stored.length};
  globalThis.fetch=async(url,init)=>{
   const path=String(url);
   if(path.includes('consume_project_file_inspection'))return Response.json(true);
   if(path.includes('/rest/v1/project_files?'))return Response.json([++readCount===1?reserved:{...reserved,state:'rejected',reject_reason:reason}]);
   if(path.includes('record_project_file_inspection')){recorded=JSON.parse(init.body);return Response.json({state:'rejected'});}
   if(path.includes('list-type=2'))return new Response(`<ListBucketResult><Contents><Key>${file.r2_key}</Key><LastModified>2026-11-19T00:00:00Z</LastModified><Size>${size}</Size></Contents></ListBucketResult>`);
   return new Response(stored);
  };
  const response=await inspect(req('POST'),params);assert.equal(response.status,200);assert.equal(recorded.p_reject_reason,reason);assert.equal((await response.json()).state,'rejected');
 }
 let reads=0;
 globalThis.fetch=async(url)=>{
  const path=String(url);
  if(path.includes('consume_project_file_inspection'))return Response.json(true);
  if(path.includes('/rest/v1/project_files?'))return Response.json([++reads===1?file:{...inspected,cleanup_state:'claimed'}]);
  if(path.includes('record_project_file_inspection'))return Response.json(inspected);
  if(path.includes('list-type=2'))return new Response(`<ListBucketResult><Contents><Key>${file.r2_key}</Key><LastModified>2026-11-19T00:00:00Z</LastModified><Size>${bytes.length}</Size></Contents></ListBucketResult>`);
  return new Response(bytes);
 };
 const response=await inspect(req('POST'),params);assert.equal(response.status,409);assert.equal((await response.json()).error.code,'file-unavailable');
});

test('a busy isolate answers 503 before any rate-limit token is spent', async () => {
 let consumed = 0, release;
 const hold = withFileInspection(() => new Promise(r => { release = r; }));
 globalThis.fetch = async (url) => {
  if (String(url).includes('consume_project_file_inspection')) { consumed++; return Response.json(true); }
  if (String(url).includes('/rest/v1/project_files?')) return Response.json([file]);
  return new Response('', { status: 503 });
 };
 const r = await inspect(req('POST'), params);
 assert.equal(r.status, 503);
 assert.equal((await r.json()).error.code, 'inspection-busy');
 assert.equal(consumed, 0, 'no token spent while the isolate was busy');
 release(); await hold;
});
