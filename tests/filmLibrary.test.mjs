import test from 'node:test';
import assert from 'node:assert/strict';
import {filmLibraryHandlers} from '../lib/filmLibraryApi.js';
const id='aaaaaaaa-1111-4111-8111-111111111111';
const cfg={supabaseUrl:'https://db.test',serviceRoleKey:'test'};
const r2cfg={accountId:'test-account',accessKeyId:'test-key',secretAccessKey:'test-secret',bucket:'test-bucket'};
const request=(path='/library/masters',auth='owner')=>new Request(`https://veyrnox.test/api/v1${path}`,{headers:auth?{'x-veyrnox-auth-id':auth}:{}});
const setup=(replies={})=>{
 const calls=[];const signs=[];
 const handlers=filmLibraryHandlers({enabled:true,cfg,r2cfg,
  call:async(name,args)=>{calls.push({name,args});return replies[name]||{ok:true};},
  sign:async(...args)=>{signs.push(args);return {url:'https://media.test/private.mp4',expires:900};}});
 return {...handlers,calls,signs};
};
test('master reads require the authenticated owner even with rollout off',async()=>{
 const h=setup();assert.equal((await h.list(request('/library/masters',null))).status,401);
 assert.equal((await h.asset(request('/library/masters/x/asset',null),id)).status,401);assert.equal(h.calls.length,0);
 const off=filmLibraryHandlers({enabled:false});assert.deepEqual(await (await off.list(request())).json(),{enabled:false,masters:[]});
 assert.equal((await off.asset(request(),id)).status,404);
});
test('the list is owner scoped, contains no signed link and fails closed on malformed data',async()=>{
 const masters=[{id,label:'Empty room — final 16:9 master',sha256:'a'.repeat(64)}];
 const h=setup({list_film_library_masters:{ok:true,masters}});const r=await h.list(request());
 assert.equal(r.headers.get('cache-control'),'no-store');assert.deepEqual(await r.json(),{enabled:true,masters});
 assert.deepEqual(h.calls,[{name:'list_film_library_masters',args:{p_auth_id:'owner'}}]);
 assert.equal((await setup().list(request())).status,503);
});
test('a denied owner lookup never signs another account’s master',async()=>{
 const h=setup({get_film_library_master:{ok:false,code:'NOT_FOUND'}});
 assert.equal((await h.asset(request(),id)).status,404);assert.equal(h.signs.length,0);
 assert.deepEqual(h.calls[1],{name:'get_film_library_master',args:{p_auth_id:'owner',p_id:id}});
});
test('preview and download preserve file digest and retention with a 15-minute link',async()=>{
 const row={ok:true,r2_key:`film-masters/u/${id}.mp4`,sha256:'b'.repeat(64),size_bytes:9616540,expires_at:'2027-01-08T20:57:32Z'};
 const h=setup({get_film_library_master:row});
 const preview=await h.asset(request(),id);assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');
 assert.deepEqual(await preview.json(),{url:'https://media.test/private.mp4',mime_type:'video/mp4',size_bytes:row.size_bytes,sha256:row.sha256,expires_in:900,asset_expires_at:row.expires_at});
 await h.asset(request('/library/masters/x/asset?download=1'),id);
 assert.deepEqual(h.signs[0],[row.r2_key,900,r2cfg,undefined]);
 assert.equal(h.signs[1][3].downloadFilename,'veyrnox-aaaaaaaa.mp4');
});
test('invalid ids and download options never reach storage',async()=>{
 for(const path of ['?download=0','?download=1&download=1']){
  const h=setup();assert.equal((await h.asset(request(`/library/masters/x/asset${path}`),id)).status,400);assert.equal(h.calls.length,0);
 }
 const h=setup();assert.equal((await h.asset(request(),'../../other')).status,400);assert.equal(h.calls.length,0);
});
test('read quotas deny signing and return a bounded retry window',async()=>{
 for(const name of ['list_film_library_masters','consume_asset_link_request']){
  const h=setup({[name]:{ok:false,code:'RATE_LIMITED',retry_after_seconds:1000}});
  const r=name==='list_film_library_masters'?await h.list(request()):await h.asset(request(),id);
  assert.equal(r.status,429);assert.equal(r.headers.get('retry-after'),'60');assert.equal(h.signs.length,0);
 }
 const h=setup({consume_asset_link_request:{ok:false}});assert.equal((await h.asset(request(),id)).status,503);assert.equal(h.signs.length,0);
});
test('database and signing failures leave no success response',async()=>{
 const h=filmLibraryHandlers({enabled:true,cfg,r2cfg,call:async()=>{throw new Error('down');}});
 assert.equal((await h.list(request())).status,503);assert.equal((await h.asset(request(),id)).status,503);
 const s=filmLibraryHandlers({enabled:true,cfg,r2cfg,call:async()=>({ok:true}),sign:async()=>{throw new Error('down');}});
 assert.equal((await s.asset(request(),id)).status,503);
});
