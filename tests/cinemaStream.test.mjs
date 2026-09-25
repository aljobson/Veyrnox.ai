import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamUpload,readStreamVideo,mediaObservation,verifyStreamSignature,validUploadUrl} from '../lib/cinema/stream.js';
import {uploadChunks} from '../app/veyrnox/social-cinema/creator/tusUpload.js';
const uid='a'.repeat(32),url=`https://upload.cloudflarestream.com/${uid}`,cfg={account:'b'.repeat(32),token:'synthetic-token'};
const video={uid,requireSignedURLs:true,readyToStream:true,status:{state:'ready',pctComplete:'100'},duration:42,input:{width:1080,height:1920}};
test('Stream provisioning binds length, private access, expiry and opaque reservation; no redirects',async()=>{
  let called;
  const result=await createStreamUpload({id:'reservation-id',file_size:123,expires_at:'2026-09-25T13:00:00Z'},cfg,async(target,init)=>{called={target,init};return new Response(null,{status:201,headers:{location:url,'stream-media-id':uid}});});
  assert.equal(result.uid,uid);assert.match(called.target,/direct_user=true$/);assert.equal(called.init.headers['Upload-Length'],'123');assert.match(called.init.headers['Upload-Metadata'],/requiresignedurls/);assert.equal(called.init.redirect,'error');
  for(const bad of ['https://evil.invalid/x','https://upload.cloudflarestream.com.evil.invalid/x','http://upload.cloudflarestream.com/x','https://user@upload.cloudflarestream.com/x','https://upload.cloudflarestream.com:444/x'])assert.equal(validUploadUrl(bad),false);
  await assert.rejects(createStreamUpload({},cfg,async()=>new Response(null,{status:201,headers:{location:'https://evil.invalid', 'stream-media-id':uid}})));
});
test('provider responses require bounded JSON and exact UID',async()=>{
  await assert.rejects(readStreamVideo(uid,cfg,async()=>Response.json({success:true,result:{uid:'c'.repeat(32)}})));
  await assert.rejects(readStreamVideo(uid,cfg,async()=>new Response('x'.repeat(66000))));
  assert.equal((await readStreamVideo(uid,cfg,async()=>Response.json({success:true,result:video}))).uid,uid);
});
test('ready needs private media, completed encoding and validated dimensions/duration; never publishes',()=>{
  assert.equal(mediaObservation(video).p_state,'ready');
  for(const patch of [{requireSignedURLs:false},{duration:601},{duration:0},{input:{width:0,height:1080}}])assert.equal(mediaObservation({...video,...patch}).p_state,'error');
  assert.equal(mediaObservation({...video,status:{state:'ready',pctComplete:'90'}}).p_state,'processing');
  assert.equal(mediaObservation({uid,status:{state:'pendingupload'}}),null);
});
test('webhook HMAC uses unmodified bytes and a five-minute freshness bound',async()=>{
  const now=Math.floor(Date.now()/1000),secret='test-webhook-secret',bytes=new TextEncoder().encode('{"uid":"'+uid+'"}\n');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sign=async time=>[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${time}.${new TextDecoder().decode(bytes)}`)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const header=`time=${now},sig1=${await sign(now)}`;
  assert.equal(await verifyStreamSignature(bytes,header,secret,now),true);
  assert.equal(await verifyStreamSignature(bytes.slice(0,-1),header,secret,now),false);
  assert.equal(await verifyStreamSignature(bytes,header,'wrong',now),false);
  for(const time of [now-301,now+6])assert.equal(await verifyStreamSignature(bytes,`time=${time},sig1=${await sign(time)}`,secret,now),false);
});
test('tus resume honors provider offset and sends no app credentials',async()=>{
  const file=new Blob([new Uint8Array(6*1024*1024)]),calls=[];
  const fetcher=async(target,init)=>{calls.push({target,init});return init.method==='HEAD'?new Response(null,{headers:{'upload-offset':'5242880','upload-length':String(file.size)}}):new Response(null,{status:204,headers:{'upload-offset':String(file.size)}});};
  await uploadChunks(file,url,{fetcher});assert.equal(calls.length,2);assert.equal(calls[1].init.body.size,1048576);assert.equal(calls[1].init.headers['Upload-Offset'],'5242880');assert.equal(calls[1].init.headers.Authorization,undefined);assert.equal(calls[1].init.credentials,'omit');
  await assert.rejects(uploadChunks(file,url,{fetcher:async()=>new Response(null,{headers:{'upload-offset':'0','upload-length':'1'}})}));
  await assert.rejects(uploadChunks(file,url,{fetcher:async(_,init)=>init.method==='HEAD'?new Response(null,{headers:{'upload-offset':'0','upload-length':String(file.size)}}):new Response(null,{status:204,headers:{'upload-offset':'999'}})}));
});
