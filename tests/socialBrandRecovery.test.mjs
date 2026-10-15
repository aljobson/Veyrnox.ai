import test from 'node:test';
import assert from 'node:assert/strict';
const store = new Map([['veyrnox_supabase_session', JSON.stringify({access_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'tester'}})]]);
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
globalThis.window={dispatchEvent(){},addEventListener(){},removeEventListener(){}};
globalThis.CustomEvent=class{constructor(type){this.type=type;}};
const {gatewayFetch}=await import('../app/veyrnox/_lib/gateway.js');
const {setSelectedSocialBrand,getSelectedSocialBrand}=await import('../app/lib/socialBrandSelection.js');
test('removed team selection recovers a read once without the rejected brand header',async()=>{
 setSelectedSocialBrand('removed-brand');const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push(init);return calls.length===1?Response.json({error:'brand_not_found'},{status:404}):Response.json({accounts:[]});};
 assert.deepEqual(await gatewayFetch('/social/accounts'),{accounts:[]});assert.equal(calls.length,2);assert.equal(calls[0].headers['x-publish-brand-id'],'removed-brand');assert.equal(calls[1].headers['x-publish-brand-id'],undefined);assert.equal(getSelectedSocialBrand(),'');
});
test('never retries a write under another brand',async()=>{
 setSelectedSocialBrand('removed-brand');let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'brand_not_found'},{status:404});};
 await assert.rejects(gatewayFetch('/social/smartlink',{method:'PUT',body:'{}'}),{status:404});assert.equal(calls,1);assert.equal(getSelectedSocialBrand(),'removed-brand');
});
test('does not retry unrelated missing resources or loop on a missing default brand',async()=>{
 setSelectedSocialBrand('removed-brand');let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'brand_not_found'},{status:404});};
 await assert.rejects(gatewayFetch('/social/accounts'),{status:404});assert.equal(calls,2);
 setSelectedSocialBrand('valid-brand');calls=0;globalThis.fetch=async()=>{calls++;return Response.json({error:'post_not_found'},{status:404});};
 await assert.rejects(gatewayFetch('/social/posts/missing'),{status:404});assert.equal(calls,1);assert.equal(getSelectedSocialBrand(),'valid-brand');
});
