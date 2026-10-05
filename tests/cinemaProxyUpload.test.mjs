import test from 'node:test';
import assert from 'node:assert/strict';
import {uploadProxyChunks} from '../app/veyrnox/social-cinema/creator/proxyUpload.js';
import {UPLOAD_CHUNK_BYTES} from '../lib/cinema/uploadPolicy.js';

const id='11111111-1111-4111-8111-111111111111';
const path=`/cinema/uploads/${id}/transfer?content_id=${id}`;

test('proxy uploader resumes from the server offset and sends bounded chunks only to our API',async()=>{
  const size=UPLOAD_CHUNK_BYTES+17,calls=[],progress=[];
  const file=new Blob([new Uint8Array(size)],{type:'video/mp4'});
  const fetcher=async(target,init)=>{
    calls.push({target,init});
    if(init.method==='GET') return {offset:17,length:size};
    return {offset:Number(init.headers['upload-offset'])+init.body.size,length:size};
  };
  await uploadProxyChunks(file,path,{fetcher,onProgress:(done,total)=>progress.push([done,total])});
  assert.equal(calls[0].init.method,'GET');
  assert.deepEqual(calls.slice(1).map(c=>c.init.body.size),[UPLOAD_CHUNK_BYTES,0].filter((_,i)=>i<1));
  assert.equal(calls[1].target,path);
  assert.equal(calls[1].init.headers['upload-offset'],'17');
  assert.deepEqual(progress.at(-1),[size,size]);
  assert.ok(calls.every(c=>!String(c.target).includes('cloudflare')));
});

test('proxy uploader rejects foreign paths and inconsistent resume state before sending bytes',async()=>{
  const file=new Blob([new Uint8Array(10)]),never=()=>assert.fail('must not fetch');
  await assert.rejects(uploadProxyChunks(file,'https://upload.cloudflarestream.com/grant',{fetcher:never}),/invalid_upload/);
  await assert.rejects(uploadProxyChunks(file,path,{fetcher:async()=>({offset:11,length:10})}),/resume_failed/);
});
