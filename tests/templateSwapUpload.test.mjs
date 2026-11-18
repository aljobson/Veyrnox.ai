import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`export async function load(url,c,next) {
 if(url.endsWith('/app/veyrnox/_lib/gateway.js')) return {format:'module',shortCircuit:true,source:"export const gatewayFetch=(...args)=>globalThis.reserve(...args); export class GatewayError extends Error { constructor(m,p){super(m);Object.assign(this,p);} }"};
 return next(url,c);
}`));
const { uploadSourceFile } = await import('../app/veyrnox/_lib/uploadSourceFile.js');
const file = new Blob(['png'], {type:'image/png'});
test('no-signal uploader keeps original request shapes and result', async () => {
  let put; globalThis.reserve = async (path, init) => { assert.equal(path,'/uploads'); assert.deepEqual(init,{method:'POST',body:JSON.stringify({content_type:file.type,size_bytes:file.size})}); return {upload_url:'https://upload.test',content_type:'image/png',key:'key'}; };
  globalThis.fetch=async (url,init)=>{put=init;return {ok:true};};
  assert.equal(await uploadSourceFile(file),'key'); assert.deepEqual(put,{method:'PUT',headers:{'Content-Type':'image/png'},body:file});
});
for (const phase of ['reservation','between','put']) test(`abort during ${phase} prevents any follow-up`, async () => {
  const controller = new AbortController(); let puts=0, generations=0;
  globalThis.reserve = async (path, { signal }) => {
    if(path==='/generations') generations++;
    assert.equal(signal,controller.signal);
    if(phase==='reservation'){controller.abort(); throw Error('reservation interrupted');}
    if(phase==='between') controller.abort();
    return {upload_url:'https://upload.test',key:'key',content_type:'image/png'};
  };
  globalThis.fetch = async (_, { signal }) => { puts++; assert.equal(signal,controller.signal); controller.abort(); throw Error('put interrupted'); };
  await assert.rejects(uploadSourceFile(file,{signal:controller.signal}), {name:'AbortError'});
  assert.equal(puts,phase==='put'?1:0); assert.equal(generations,0);
});
test('real gateway 401 during upload reservation emits expired and retains both processed files', async () => {
  const { readFileSync } = await import('node:fs');
  const { createSwapStore } = await import('../app/veyrnox/_lib/templateSwapStore.mjs');
  const { createSwapActions } = await import('../app/veyrnox/_lib/templateSwapActions.mjs');
  const store=createSwapStore({revoke(){}});store.session('A');
  const processed=[new Blob(['front'],{type:'image/png'}),new Blob(['crop'],{type:'image/png'})];
  const source=readFileSync(new URL('../app/veyrnox/_lib/gateway.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const session=()=>store.owner()?{access_token:'token',user:{id:store.owner()}}:null;
  const deps={getFreshAccessToken:async()=>session()?.access_token,getSession:session,clearSession:reason=>{assert.equal(reason,'expired');store.session(null,reason);},
    getSelectedSocialBrand:()=>null,setSelectedSocialBrand(){},assertSocialBrandSnapshot(){},captureOperationalError(){},normaliseGatewayPath:x=>x,apiErrorDetails(){return{};},waitForStepUp(){}};
  const gateway=new Function(...Object.keys(deps),source+'\nreturn {gatewayFetch, GatewayError};')(...Object.values(deps));
  const uploadSource=readFileSync(new URL('../app/veyrnox/_lib/uploadSourceFile.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
  const upload=new Function('gatewayFetch','GatewayError',uploadSource+'\nreturn uploadSourceFile;')(gateway.gatewayFetch,gateway.GatewayError);
  let expired=true;const puts=[];let reservations=0,generations=0;
  globalThis.fetch=async(url,init)=>{
    if(String(url).endsWith('/uploads')){reservations++;return expired?Response.json({error:'unauthenticated'},{status:401}):Response.json({upload_url:'https://put.test',content_type:'image/png',key:'upload-'+reservations});}
    if(String(url).endsWith('/generations')){generations++;return Response.json({job_id:'job',balance_after:9});}
    puts.push(await init.body.text());return new Response('',{status:200});
  };
  const actions=createSwapActions(store,{makeKey:()=> 'key',objectURL:()=> 'url',processPhoto:async()=>({files:processed}),upload,gateway:gateway.gatewayFetch});
  await actions.choose('test',new Blob(['raw']));await actions.submit('test',{id:'test',model:'kling-o1-reference',credits:47});
  assert.equal(store.owner(),null);assert.equal(generations,0);assert.deepEqual(puts,[]);
  store.session('A');assert.deepEqual(store.get('test')[0].files,processed);expired=false;
  await actions.submit('test',{id:'test',model:'kling-o1-reference',credits:47});
  assert.deepEqual(puts,['front','crop']);assert.equal(generations,1);
});
