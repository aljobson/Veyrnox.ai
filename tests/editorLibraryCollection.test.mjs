import test from 'node:test';
import assert from 'node:assert/strict';
import {listEditorLibrary,loadEditorLibraryItem,librarySourceFromId} from '../app/veyrnox/_lib/editorLibraryCollection.mjs';
import {mediaToRelink} from '../app/veyrnox/_lib/editorProject.mjs';
import {listDeviceLibrary,saveDeviceLibrary,loadDeviceLibrary} from '../app/veyrnox/_lib/deviceLibrary.mjs';
const id='e2bf7651-2264-4860-907d-977852aa1b9d',actor='b91a230d-d5fb-4188-b5c4-733802a9bb8e';
const next={before:'2026-10-10T12:00:00Z',before_id:id};
test('the first editor Library page contains generated images, saved edits, masters and device originals',async()=>{
 const paths=[];const call=async path=>{paths.push(path);if(path==='/jobs?limit=24')return {jobs:[{job_id:id,has_asset:true,label:'Generated image'}],next};if(path===`/jobs/${id}/asset`)return {mime_type:'image/png'};if(path==='/library/editor-renders')return {renders:[{id,label:'Saved edit',state:'stored'}]};if(path==='/library/masters')return {masters:[{id,label:'Film master'}]};throw new Error(path);};
 const page=await listEditorLibrary(call,{actor,deviceList:async()=>[{id,mediaId:`d-${id}`,kind:'audio',label:'Original',source:'device'}]});
 assert.deepEqual(new Set(page.items.map(x=>x.source)),new Set(['device','editor','master','generation']));assert.equal(page.items.find(x=>x.source==='generation').kind,'image');assert.deepEqual(page.next,next);assert.deepEqual(page.warnings,[]);assert.equal(paths.length,4);
});
test('older generations remain reachable by the server cursor without duplicating saved exports',async()=>{
 const paths=[];const page=await listEditorLibrary(async path=>{paths.push(path);return {jobs:[{job_id:id,has_asset:false}],next:null};},{actor,cursor:next,deviceList:()=>assert.fail('reloaded device list')});
 assert.equal(paths.length,1);assert.ok(paths[0].includes(`before=${encodeURIComponent(next.before)}&before_id=${id}`));assert.deepEqual(page.items,[]);assert.equal(page.next,null);
});
test('backend failures produce visible warnings; expired media alone is omitted and authentication failures escape',async()=>{
 const call=async path=>{if(path.startsWith('/jobs?'))return {jobs:[{job_id:id,has_asset:true}]};throw Object.assign(new Error('backend'),{status:path.startsWith('/jobs/')?429:503});};
 const page=await listEditorLibrary(call,{actor,deviceList:async()=>[]});assert.equal(page.warnings.length,3);
 await assert.rejects(listEditorLibrary(async path=>{if(path.startsWith('/jobs?'))return {jobs:[{job_id:id,has_asset:true}]};throw Object.assign(new Error('signed out'),{status:401});},{actor,deviceList:async()=>[]}),/signed out/);
 const expired=await listEditorLibrary(async path=>{if(path.startsWith('/jobs?'))return {jobs:[{job_id:id,has_asset:true}]};throw Object.assign(new Error('gone'),{status:404});},{actor,deviceList:async()=>[]});assert.deepEqual(expired.warnings,[]);
});
test('guest Library remains local and source IDs cannot select arbitrary routes',async()=>{
 const page=await listEditorLibrary(()=>assert.fail('guest network access'),{deviceList:async owner=>{assert.equal(owner,'guest');return [];}});assert.deepEqual(page.items,[]);
 for(const value of [`e-${id}/asset`,`d-${id}?actor=other`,'f-not-a-uuid','j-test'])assert.equal(librarySourceFromId(value),null);
 await assert.rejects(loadEditorLibraryItem(()=>assert.fail('cloud access'),{mediaId:`e-${id}`}),/Sign in/);
 await assert.rejects(loadDeviceLibrary('other-account',id),/current account/);await assert.rejects(saveDeviceLibrary('other-account',null,null),/current account/);
 await assert.rejects(listDeviceLibrary('guest',{factory:null}),/unavailable/);
});
test('saved v3 sources keep their stable references and device reads stay bound to the actor',async()=>{
 const media=Object.fromEntries(['d','e','f'].map(prefix=>[`${prefix}-${id}`,{id:`${prefix}-${id}`,name:'Original',kind:'video',frames:90}]));
 const need=mediaToRelink({media});assert.equal(need.local.length,0);assert.deepEqual(need.library.map(x=>x.source),['device','editor','master']);
 let loaded=false;const result=await loadEditorLibraryItem(()=>assert.fail('device network call'),need.library[0],{actor,isCurrent:()=>true,deviceLoad:async(owner,fileId,options)=>{assert.equal(owner,actor);assert.equal(fileId,id);assert.equal(options.isCurrent(),true);loaded=true;return {blob:new Blob(['original']),kind:'video'};}});assert.equal(loaded,true);assert.equal(result.blob.size,8);
});
test('saved master imports verify owned URLs, byte count and SHA-256 before any editor ingest',async()=>{
 const bytes=new Uint8Array([1,2,3,4]),sha256=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');const url='https://fb18d9f7052afbea5a5e0eae69948af2.r2.cloudflarestorage.com/library/master.mp4';
 const call=async path=>{assert.equal(path,`/library/masters/${id}/asset`);return {url,mime_type:'video/mp4',size_bytes:bytes.length,sha256};};
 const result=await loadEditorLibraryItem(call,{mediaId:`f-${id}`,label:'Master.mp4'},{actor,fetchBytes:async()=>new Response(bytes)});assert.equal(result.blob.name,'Master.mp4');
 await assert.rejects(loadEditorLibraryItem(call,{mediaId:`f-${id}`},{actor,fetchBytes:async()=>new Response(new Uint8Array(4))}),/verified bytes/);
 await assert.rejects(loadEditorLibraryItem(call,{mediaId:`f-${id}`},{actor,isCurrent:()=>false,fetchBytes:async()=>new Response(bytes)}),/account changed/);
});

test('the unified Library retains six separate source IDs and reloads the selected instrument',async()=>{
 const stems=['vocals','drums','bass','other','guitar','piano'];
 const call=async path=>{if(path.startsWith('/jobs?'))return {jobs:[{job_id:id,has_asset:true,model_id:'demucs-stems',label:'Original song'}]};if(path.endsWith('/asset'))return {mime_type:'audio/mpeg',output_stems:stems};return {};};
 const page=await listEditorLibrary(call,{actor,deviceList:async()=>[]});assert.equal(page.items.length,6);assert.equal(new Set(page.items.map(x=>x.mediaId)).size,6);
 const bass=page.items.find(x=>x.stem==='bass');assert.equal(bass.mediaId,`j-${id}--bass`);let received=false;
 const result=await loadEditorLibraryItem(async path=>{assert.equal(path,`/jobs/${id}/asset?stem=bass`);received=true;return {mime_type:'audio/mpeg',url:'https://assets.test/bass.mp3'};},bass,{actor,fetchBytes:async()=>new Response('audio')});assert.equal(received,true);assert.equal(result.kind,'audio');
});
