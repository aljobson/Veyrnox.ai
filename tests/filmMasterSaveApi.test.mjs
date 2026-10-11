import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filmMasterSaveHandlers } from '../lib/filmMasterSaveApi.js';
import { inspectFilmMaster } from '../lib/filmMasterInspection.js';
import { sha256Hex } from '../packages/adapters/r2.js';
import { cleanUnregisteredFilmMaster } from '../lib/filmMasterUploadCleanup.js';
import { readFilmMasterBytes } from '../lib/filmMasterBytes.js';
const auth='11111111-1111-4111-8111-111111111111', user='22222222-2222-4222-8222-222222222222', job='33333333-3333-4333-8333-333333333333', id='44444444-4444-4444-8444-444444444444';
const bytes=new Uint8Array(await readFile(new URL('./fixtures/film-master-1080p24.mp4',import.meta.url))), hash=await sha256Hex(bytes);
const cfg={supabaseUrl:'https://db.test',serviceRoleKey:'test'}, r2cfg={accountId:'test',accessKeyId:'test',secretAccessKey:'test',bucket:'test'};
const time=Date.parse('2026-10-11T12:00:00Z');
const body={upload_id:id,source_job_id:job,sha256:hash,size_bytes:bytes.length,label:'Quiet room',rights_confirmed:true};
const req=(body,owner=auth)=>new Request('https://veyrnox.test/api/v1/library/masters',{method:'POST',headers:{'content-type':'application/json',...(owner?{'x-veyrnox-auth-id':owner}:{})},body:JSON.stringify(body)});
function setup(options={}) {
 const calls=[],objects=new Map(),reservations=new Map(),masters=[];let puts=0;
 const handlers=filmMasterSaveHandlers({enabled:true,cfg,r2cfg,now:()=>time,
  call:async(name,args)=>{
   calls.push({name,args});
   if(options[name]) return options[name](args);
   if(name==='consume_upload_request')return {ok:true};
   if(name==='get_user_asset')return {ok:true,state:'STORED',mime_type:'video/mp4',r2_key:'source.mp4',asset_expires_at:'2027-01-01T00:00:00Z'};
   if(name==='list_film_library_masters')return {ok:true,masters};
   if(name==='reserve_upload'){reservations.set(args.p_key,{user_id:user,size_bytes:args.p_size,created_at:new Date(time).toISOString(),put_expires_at:new Date(time+960000).toISOString()});return {ok:true};}
   if(name==='store_film_library_master'){let row=masters.find(m=>m.sha256===args.p_sha256);if(!row){row={id:args.p_id,source_job_id:args.p_source_job_id,sha256:args.p_sha256};masters.push(row);}return {ok:true,id:row.id,idempotent:masters.length>1};}
   throw Error('unexpected '+name);
  },find:async(table,query)=>{
   if(table==='users')return [{id:user,frozen_at:options.frozen?'2026-10-11':null}];
   if(table==='assets')return [{sha256:'a'.repeat(64)}];
   if(table==='upload_reservations')return [reservations.get(new URLSearchParams(query.filter).get('r2_key').slice(3))].filter(Boolean);
  }, list:async()=>({ok:true,objects:[]}),
  sign:async(key,type,ttl,_cfg,size)=>{assert.equal(type,'video/mp4');assert(ttl<=900);assert.equal(size,bytes.length);return {url:'https://media.test/upload',headers:{'Content-Type':type,'If-None-Match':'*'}};},
  get:async(key)=>{const value=objects.get(key);return value?{ok:true,response:new Response(value,{headers:{'content-type':'video/mp4','content-length':String(value.length)}})}:{ok:false};},
  put:async(key,data,type,_cfg,condition)=>{assert.deepEqual(condition,{onlyIfAbsent:true});assert.equal(type,'video/mp4');puts++;if(objects.has(key))return {ok:false,status:412};objects.set(key,data);return {ok:true};},
 });
 return {...handlers,calls,objects,reservations,masters,get puts(){return puts;}};
}
async function uploaded(h,requestBody=body){const r=await h.begin(req(requestBody));assert.equal(r.status,200);const grant=await r.json();h.objects.set(`uploads/${auth}/${id}.mp4`,bytes);return grant;}
test('real MP4 packets establish 1080p, 24fps and exact duration; wrong dimensions, rate and truncated bytes fail',async()=>{
 assert.deepEqual(await inspectFilmMaster(bytes),{width:1920,height:1080,frame_rate:24,seconds:1});
 for(const bad of [bytes.subarray(0,100),new Uint8Array([1,2,3])])assert.equal(await inspectFilmMaster(bad),null);
 const dimensions=bytes.slice();const tkhd=Buffer.from(dimensions).indexOf('tkhd');new DataView(dimensions.buffer).setUint32(tkhd+80,1280*65536);assert.equal(await inspectFilmMaster(dimensions),null);
 const rate=bytes.slice();const stts=Buffer.from(rate).indexOf('stts');new DataView(rate.buffer).setUint32(stts+16,1);assert.equal(await inspectFilmMaster(rate),null);
});
test('save checks stored bytes and readback before registering; replay returns one Library card',async()=>{
 const h=setup(),grant=await uploaded(h);const r=await h.finish(req({ticket:grant.ticket}));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal((await r.json()).library_url,`/app/library#master-${id}`);
 assert.equal(h.puts,1);assert.equal(h.masters.length,1);
 const write=h.calls.find(c=>c.name==='store_film_library_master').args;assert.equal(write.p_source_sha256,'a'.repeat(64));assert.equal(write.p_seconds,1);assert.equal(write.p_sha256,hash);
 assert.equal((await (await h.begin(req(body))).json()).id,id);assert.equal((await (await h.finish(req({ticket:grant.ticket}))).json()).id,id);assert.equal(h.puts,1);assert.equal(h.masters.length,1);
 assert(h.calls.every(c=>!/(ledger|balance|generation|job_stored)/.test(c.name)));
});
test('authentication, frozen state, rate limit, source expiry and consent refuse before uploading',async()=>{
 assert.equal((await setup().begin(req(body,null))).status,401);
 assert.equal((await setup({frozen:true}).begin(req(body))).status,403);
 assert.equal((await setup({consume_upload_request:()=>({ok:false,code:'RATE_LIMITED'})}).begin(req(body))).status,429);
 for(const value of [{ok:false},{ok:true,state:'STORED',mime_type:'video/mp4',asset_expires_at:'2026-01-01'}])assert.equal((await setup({get_user_asset:()=>value}).begin(req(body))).status,404);
 for(const change of [{rights_confirmed:false},{size_bytes:26214401},{sha256:'bad'},{source_job_id:'../../victim'},{label:''},{unexpected:'path'}]){const h=setup();assert.equal((await h.begin(req({...body,...change}))).status,400);assert.equal(h.reservations.size,0);}
});
test('sealed tickets cannot change owner, source, expiry or metadata',async()=>{
 const h=setup(),grant=await uploaded(h);
 for(const ticket of [grant.ticket+'x','bad','',grant.ticket.split('.')[0]+'.AAAA'])assert.equal((await h.finish(req({ticket}))).status,409);
 assert.equal((await h.finish(req({ticket:grant.ticket},user))).status,409);assert.equal(h.puts,0);
 h.reservations.clear();assert.equal((await h.finish(req({ticket:grant.ticket}))).status,409);
});
test('wrong stored bytes, missing transfer and non-master media never register a Library entry',async()=>{
 const h=setup(),grant=await uploaded(h);h.objects.clear();assert.equal((await h.finish(req({ticket:grant.ticket}))).status,409);
 const key=`uploads/${auth}/${id}.mp4`;const bad=bytes.slice();bad[bad.length-1]^=1;h.objects.set(key,bad);assert.equal((await h.finish(req({ticket:grant.ticket}))).status,400);assert.equal(h.puts,0);
 const invalid=setup(),invalidGrant=await uploaded(invalid,{...body,sha256:await sha256Hex(new Uint8Array(bytes.length))});invalid.objects.set(key,new Uint8Array(bytes.length));assert.equal((await invalid.finish(req({ticket:invalidGrant.ticket}))).status,400);assert.equal(invalid.puts,0);
});
test('lost registration reply retries immutable bytes without overwriting',async()=>{
 let failed=true;const h=setup({store_film_library_master:()=>{if(failed){failed=false;throw Error('lost reply');}return {ok:true,id,idempotent:true};}}),grant=await uploaded(h);
 assert.equal((await h.finish(req({ticket:grant.ticket}))).status,503);assert.equal((await h.finish(req({ticket:grant.ticket}))).status,200);assert.equal(h.puts,2);assert.equal(h.objects.size,2);
});
test('expired reservations are not renewed, and storage budget refusal never signs',async()=>{
 const h=setup();h.reservations.set(`uploads/${auth}/${id}.mp4`,{user_id:user,size_bytes:bytes.length,created_at:'2026-10-11T11:00:00Z',put_expires_at:'2026-10-11T11:16:00Z'});assert.equal((await h.begin(req(body))).status,409);
 const limited=setup({reserve_upload:()=>({ok:false,code:'UPLOAD_BUDGET_EXCEEDED'})});assert.equal((await limited.begin(req(body))).status,429);
});
test('cleanup preserves registered masters and fails closed; only confirmed orphan deletion recovers budget',async()=>{
 const row={r2_key:`uploads/${auth}/${id}.mp4`,user_id:user},removed=[];
 assert.equal((await cleanUnregisteredFilmMaster(row,{},cfg,{enabled:true,call:async()=>({ok:true}),remove:()=>assert.fail('deleted registered master')})).ok,true);
 assert.equal((await cleanUnregisteredFilmMaster(row,{},cfg,{enabled:true,call:async()=>{throw Error('down');},remove:()=>assert.fail('deleted without lookup')})).ok,false);
 assert.equal((await cleanUnregisteredFilmMaster(row,{},cfg,{enabled:true,call:async()=>({ok:false,code:'NOT_FOUND'}),remove:async key=>{removed.push(key);return {ok:true};}})).ok,true);assert.deepEqual(removed,[`film-masters/${user}/${id}.mp4`]);
 assert.equal((await cleanUnregisteredFilmMaster(row,{},cfg,{enabled:false,call:()=>assert.fail('called unapplied RPC')})).ok,true);
});
test('stream length enforcement rejects truncated and oversized bodies without a second whole-file allocation',async()=>{
 for(const value of [bytes.subarray(0,bytes.length-1),new Uint8Array(bytes.length+1)])await assert.rejects(readFilmMasterBytes(new Response(value).body,bytes.length,AbortSignal.timeout(1000)),/size_mismatch/);
});
