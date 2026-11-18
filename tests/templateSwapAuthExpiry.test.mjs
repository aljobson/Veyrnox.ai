import test from 'node:test';
import assert from 'node:assert/strict';
import { adoptSession, clearSession, getFreshAccessToken, onSessionChange } from '../app/lib/authClient.js';
import { createSwapStore } from '../app/veyrnox/_lib/templateSwapStore.mjs';
import { createSwapActions } from '../app/veyrnox/_lib/templateSwapActions.mjs';
const now = Math.floor(Date.now()/1000);
test('definitive refresh rejection suspends PNGs and original attempt; reauth retries retained bytes', async t => {
  const revoked=[], uploads=[]; const store=createSwapStore({revoke:u=>revoked.push(u)});
  const unsubscribe=onSessionChange((s,event)=>store.session(s?.user?.id||null,event?.reason));
  t.after(unsubscribe);
  adoptSession({access_token:'old',expires_at:now+1,user:{id:'A'}});
  const files=[new Blob(['front'],{type:'image/png'}),new Blob(['crop'],{type:'image/png'})];
  store.put({accountId:'A',templateId:'test',key:'original',state:'refund_pending',body:{},references:[{key:'first'},{key:'second'}],files,urls:['front-url','crop-url'],job_id:'old-job'});
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'invalid_grant'},{status:401}));
  assert.equal(await getFreshAccessToken(),null); assert.equal(store.owner(),null); assert.equal(revoked.length,0);
  adoptSession({access_token:'new',expires_at:now+3600,user:{id:'A'}});
  assert.equal(store.get('test')[0].key,'original'); assert.deepEqual(store.get('test')[0].files,files);
  const actions=createSwapActions(store,{makeKey:()=> 'retry',objectURL:()=> 'retry-url',upload:async f=>{uploads.push(await f.text());return 'upload-'+uploads.length;},gateway:async()=>({job_id:'new-job'})});
  await actions.submit('test',{id:'test',model:'kling-o1-reference',credits:47}); assert.deepEqual(uploads,['front','crop']);
  clearSession(); assert.equal(store.owner(),null);
});
test('refresh rejection then another account removes PNGs; transient refresh keeps session', async t => {
  const revoked=[]; const store=createSwapStore({revoke:u=>revoked.push(u)});
  const unsubscribe=onSessionChange((s,e)=>store.session(s?.user?.id||null,e?.reason));t.after(unsubscribe);
  adoptSession({access_token:'old',expires_at:now+1,user:{id:'A'}});
  store.put({accountId:'A',templateId:'test',key:'key',state:'unknown',files:[new Blob(['png'])],urls:['url']});
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'temporary'},{status:503}));
  await getFreshAccessToken();assert.equal(store.owner(),'A');
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:'invalid_grant'},{status:401}));
  await getFreshAccessToken();adoptSession({access_token:'B',expires_at:now+3600,user:{id:'B'}});
  assert.deepEqual(revoked,['url']);assert.deepEqual(store.get('test'),[]);clearSession();
});
test('explicit signout purges immediately while token refresh is still pending', async t => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://auth.test';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test';
  const { signOut } = await import('../app/lib/authClient.js');
  const store=createSwapStore({revoke(){}});
  const unsubscribe=onSessionChange((s,e)=>store.session(s?.user?.id||null,e?.reason));t.after(unsubscribe);
  adoptSession({access_token:'old',expires_at:now+1,user:{id:'A'}});
  store.put({accountId:'A',templateId:'test',key:'key',state:'unknown',files:[new Blob(['png'])]});
  let release;const pending=new Promise(r=>{release=r;});
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    const body=JSON.parse(init.body||'{}');
    if(body.action==='refresh'){await pending;return Response.json({access_token:'renewed',expires_in:3600,user:{id:'A'}});}
    return Response.json({ok:true});
  });
  const signingOut=signOut();assert.equal(store.owner(),null);assert.deepEqual(store.get('test'),[]);
  release();await signingOut;store.session('A');assert.deepEqual(store.get('test'),[]);
});
test('a pending signout from A cannot purge a later B session or its draft', async t => {
  const {signOut,getStoredUserId}=await import('../app/lib/authClient.js');
  const store=createSwapStore({revoke(){}});
  const unsubscribe=onSessionChange((s,e)=>store.session(s?.user?.id||null,e?.reason));t.after(unsubscribe);
  adoptSession({access_token:'old-A',expires_at:now+1,user:{id:'A'}});
  let release;const wait=new Promise(r=>{release=r;});
  t.mock.method(globalThis,'fetch',async()=>{await wait;return Response.json({access_token:'new-A',expires_in:3600,user:{id:'A'}});});
  const pending=signOut();
  adoptSession({access_token:'B',expires_at:now+3600,user:{id:'B'}});
  store.put({accountId:'B',templateId:'test',key:'B-key',state:'ready',files:[new Blob(['B'])]});
  release();await pending;
  assert.equal(getStoredUserId(),'B');assert.equal(store.owner(),'B');assert.equal(await store.get('test')[0].files[0].text(),'B');clearSession();
});
