import test from 'node:test';
import assert from 'node:assert/strict';
import { GET, PUT } from '../app/api/v1/projects/[id]/document/route.js';
import { GET as history } from '../app/api/v1/projects/[id]/history/route.js';
import { emptyProjectDocument, equalProjectDocuments, validProjectDocument } from '../lib/projectDocument.js';
const id=crypto.randomUUID(), other=crypto.randomUUID();
Object.assign(process.env,{APP_ENV:'development',PUBLIC_HOST:'http://localhost:3000',SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321',NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_local_test',TENANT_PROJECTS_ENABLED:'true'});
const original=globalThis.fetch;
test.after(()=>{globalThis.fetch=original;});
const req=(body,query='')=>new Request('http://localhost:3000/api/v1/projects/'+id+'/document'+query,{method:body?'PUT':'GET',headers:{authorization:'Bearer test-user','x-veyrnox-auth-id':other,'x-request-id':crypto.randomUUID(),'content-type':'application/json','idempotency-key':'document-test-key'},...(body?{body:JSON.stringify(body)}:{})});
const params={params:Promise.resolve({id})};
test('autosave equality ignores JSONB key ordering but detects edits',()=>{
 const doc=emptyProjectDocument(id);
 const reordered={canvas:{frame_rate:30,aspect_ratio:'16:9'},brief:'',project_id:id,schema_version:1};
 assert.equal(equalProjectDocuments(doc,reordered),true);
 assert.equal(equalProjectDocuments(doc,{...reordered,brief:'Edited'}),false);
 assert.equal(equalProjectDocuments(doc,{...reordered,canvas:{...reordered.canvas,frame_rate:60}}),false);
});
test('v1 document rejects identity injection, unknown fields and oversized or invalid canvas values',()=>{
 const valid=emptyProjectDocument(id);assert.equal(validProjectDocument(valid,id),true);
 for(const bad of [{...valid,project_id:other},{...valid,schema_version:2},{...valid,owner_id:other},{...valid,brief:'x'.repeat(6001)},{...valid,canvas:{aspect_ratio:'16:9',frame_rate:'30'}},{...valid,canvas:{aspect_ratio:'16:9',frame_rate:30,url:'https://example.com'}}])assert.equal(validProjectDocument(bad,id),false);
});
test('empty document only returned for a visible project; hidden project is 404',async()=>{
 let calls=0;globalThis.fetch=async()=>Response.json(++calls===1?[{id}]:[]);
 const r=await GET(req(),params);assert.equal(r.status,200);assert.deepEqual((await r.json()).document,emptyProjectDocument(id));
 globalThis.fetch=async()=>Response.json([]);assert.equal((await GET(req(),params)).status,404);
});
test('invalid saves and mixed restore payload never reach upstream',async()=>{
 globalThis.fetch=async()=>{throw Error('must not call upstream');};
 for(const body of [{expected_revision:-1,document:emptyProjectDocument(id)},{expected_revision:0,document:emptyProjectDocument(other)},{expected_revision:0,document:emptyProjectDocument(id),restore_revision:1},{expected_revision:0,restore_revision:0}])assert.equal((await PUT(req(body),params)).status,400);
});
test('save and restore forward only validated intent and preserve user JWT',async()=>{
 const doc=emptyProjectDocument(id);let sent;
 globalThis.fetch=async(url,init)=>{sent=JSON.parse(init.body);assert.equal(init.headers.authorization,'Bearer test-user');return Response.json({revision:2,document:doc});};
 assert.equal((await PUT(req({expected_revision:1,document:doc}),params)).status,200);
 assert.equal(sent.p_expected_revision,1);assert.equal(sent.p_idempotency_key,'document-test-key');
 await PUT(req({expected_revision:2,restore_revision:1}),params);assert.equal(sent.p_document,null);assert.equal(sent.p_restore_revision,1);
});
test('history pagination is bounded and excludes document content',async()=>{
 const urls=[];globalThis.fetch=async(url)=>{urls.push(String(url));return Response.json(urls.length===1?[{id}]:[]);};
 const r=await history(req(undefined,'?before=40'),params);assert.equal(r.status,200);
 assert.match(urls[1],/limit=50/);assert.match(urls[1],/revision=lt.40/);assert.ok(!urls[1].includes(',document'));
 assert.equal((await history(req(undefined,'?before=0'),params)).status,400);
});
