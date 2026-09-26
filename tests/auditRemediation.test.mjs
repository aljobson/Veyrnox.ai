import test from 'node:test';
import assert from 'node:assert/strict';
import { contentSecurityPolicy } from '../lib/contentSecurityPolicy.mjs';
import { inspectProjectAsset } from '../lib/projectAssets.js';
import { readProjectAssetRange } from '../lib/projectAssetRange.js';
import { cleanupProjectAssets } from '../lib/projectAssetCleanup.js';
import { createStreamUpload, readStreamVideo, deleteStreamVideo } from '../lib/cinema/stream.js';

test('CSP keeps staging and production identity origins isolated', () => {
  const staging=contentSecurityPolicy(undefined,false,'staging'),production=contentSecurityPolicy(undefined,false,'production');
  assert.match(staging,/yrqzwqywxfesmbvhzjgj.supabase.co/);assert.doesNotMatch(staging,/xdxdzmsztyzbnzeforxx/);
  assert.match(production,/xdxdzmsztyzbnzeforxx.supabase.co/);assert.doesNotMatch(production,/yrqzwqywxfesmbvhzjgj/);
});
test('signature-only PNG cannot leave quarantine',async()=>{
 const head=new Uint8Array(16);head.set([137,80,78,71,13,10,26,10]);
 assert.equal((await inspectProjectAsset({declaredType:'image/png',byteSize:16,head})).ok,false);
});
test('range reads reject full bodies, mismatched ranges and oversized streams',async()=>{
 const original=globalThis.fetch;
 try {
  for(const response of [new Response(new Uint8Array(4)),new Response(new Uint8Array(4),{status:206,headers:{'content-range':'bytes 1-4/10'}}),new Response(new Uint8Array(5),{status:206,headers:{'content-range':'bytes 0-3/10'}})]) {
   globalThis.fetch=async()=>response;
   await assert.rejects(readProjectAssetRange('https://storage.invalid',0,3,10));
  }
  globalThis.fetch=async()=>new Response(new Uint8Array(4),{status:206,headers:{'content-range':'bytes 0-3/10'}});
  assert.equal((await readProjectAssetRange('https://storage.invalid',0,3,10)).length,4);
  globalThis.fetch=async()=>new Response(new ReadableStream({start(){}}),{status:206,headers:{'content-range':'bytes 0-3/10'}});
  const controller=new AbortController();const pending=readProjectAssetRange('https://storage.invalid',0,3,10,controller.signal);
  setTimeout(()=>controller.abort(),10);await assert.rejects(pending);
 }finally{globalThis.fetch=original;}
});
test('Stream server adapter does not follow redirects or accept redirect responses',async()=>{
 const cfg={account:'b'.repeat(32),token:'synthetic'},uid='a'.repeat(32);
 const fetcher=async(url,init)=>{assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://other.invalid'}});};
 await assert.rejects(createStreamUpload({file_size:1,expires_at:new Date().toISOString()},cfg,fetcher));
 await assert.rejects(readStreamVideo(uid,cfg,fetcher));await assert.rejects(deleteStreamVideo(uid,cfg,fetcher));
});
test('cleanup releases quota only after confirmed deletion and preserves failed work',async()=>{
 const id='11111111-1111-4111-8111-111111111111',key=`org/${id}/project/${id}/asset/${id}/v1.png`;
 const env={TENANT_PROJECTS_ENABLED:'true',SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic',R2_ACCOUNT_ID:'a'.repeat(32),R2_ACCESS_KEY_ID:'synthetic',R2_SECRET_ACCESS_KEY:'synthetic',R2_BUCKET:'test'};
 let finished=0;
 const rpcCall=async name=>name==='claim_project_asset_cleanup'?{items:[{id,r2_key:key}]}:(finished++,true);
 assert.deepEqual(await cleanupProjectAssets(env,{rpcCall,remove:async()=>({ok:false})}),{removed:0,failed:1});assert.equal(finished,0);
 assert.deepEqual(await cleanupProjectAssets(env,{rpcCall,remove:async()=>({ok:true})}),{removed:1,failed:0});assert.equal(finished,1);
 assert.deepEqual(await cleanupProjectAssets({...env,TENANT_PROJECTS_ENABLED:'false'},{rpcCall}),{skipped:'disabled'});
});

test('actual Stream adapter options work in the Workers runtime',async()=>{
 const { Miniflare }=await import('miniflare');
 const { build }=await import('esbuild');
 const bundled=await build({stdin:{contents:`
 import {createStreamUpload,readStreamVideo,deleteStreamVideo} from './lib/cinema/stream.js';
 export default {async fetch(){
  const uid='a'.repeat(32),cfg={account:'b'.repeat(32),token:'synthetic'};
  const transport=async(url,init)=>{
   const request=new Request(url,init);
   if(request.redirect!=='manual')throw Error('redirect followed');
   if(request.method==='POST')return new Response(null,{status:201,headers:{'stream-media-id':uid,location:'https://upload.cloudflarestream.com/'+uid}});
   if(request.method==='DELETE')return new Response(null,{status:204});
   return Response.json({success:true,result:{uid}});
  };
  await createStreamUpload({file_size:1,expires_at:new Date().toISOString()},cfg,transport);
  await readStreamVideo(uid,cfg,transport);await deleteStreamVideo(uid,cfg,transport);
  return new Response('ok');
 }}`,resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
 const mf=new Miniflare({modules:true,compatibilityDate:'2026-08-08',script:bundled.outputFiles[0].text});
 try{assert.equal(await (await mf.dispatchFetch('http://localhost')).text(),'ok');}finally{await mf.dispose();}
});
