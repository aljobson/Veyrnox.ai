import test from 'node:test';
import assert from 'node:assert/strict';
import {saveFilmMaster} from '../app/veyrnox/_lib/filmMasterSave.mjs';
import {putObject} from '../packages/adapters/r2.js';
const id='11111111-1111-4111-8111-111111111111',options={blob:new Blob(['master']),jobId:id,uploadId:id,label:'Master',consent:true};
test('client hashes bytes, uploads write-once, finalizes, and accepts a replayed transfer',async()=>{
 for(const status of [200,412]){const paths=[],progress=[];const result=await saveFilmMaster({...options,onProgress:p=>progress.push(p),fetcher:async(path,init)=>{paths.push(path);const b=JSON.parse(init.body);if(paths.length===1){assert.match(b.sha256,/^[a-f0-9]{64}$/);assert.equal(b.rights_confirmed,true);return {ticket:'sealed',upload_url:'https://media.test/put',headers:{'If-None-Match':'*'}};}assert.deepEqual(b,{ticket:'sealed'});return {saved:true,id};},transfer:async(_url,init)=>{assert.equal(init.body,options.blob);assert.equal(init.credentials,'omit');return {ok:status===200,status};}});assert.equal(result.url,`/app/library#master-${id}`);assert.equal(paths.length,2);assert.equal(progress.at(-1),'Verifying and saving…');}
});
test('an existing master skips transfer; upload failure never finalizes',async()=>{
 assert.equal((await saveFilmMaster({...options,fetcher:async()=>({saved:true,id}),transfer:()=>assert.fail('reuploaded')})).id,id);
 let calls=0;await assert.rejects(saveFilmMaster({...options,fetcher:async()=>{calls++;return {ticket:'sealed',upload_url:'https://media.test/put',headers:{}};},transfer:async()=>({ok:false,status:500})}),/could not be uploaded/);assert.equal(calls,1);
});
test('aborts, oversized files and absent rights do not issue a save',async()=>{
 const controller=new AbortController();controller.abort();for(const change of [{signal:controller.signal},{consent:false},{blob:new Blob([new Uint8Array(26214401)])}])await assert.rejects(saveFilmMaster({...options,...change,fetcher:()=>assert.fail('issued request')}));
});
test('immutable server copies sign If-None-Match and report conflict without overwriting',async()=>{
 const original=globalThis.fetch;let request;
 globalThis.fetch=async(_url,init)=>{request=init;return new Response(null,{status:412});};
 try{assert.deepEqual(await putObject('film-masters/u/id.mp4',new Uint8Array([1]),'video/mp4',{accountId:'test',accessKeyId:'test',secretAccessKey:'test',bucket:'test'},{onlyIfAbsent:true}),{ok:false,status:412});assert.equal(request.headers['if-none-match'],'*');assert.match(request.headers.authorization,/SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date/);}finally{globalThis.fetch=original;}
});
