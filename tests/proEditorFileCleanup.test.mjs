import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupProjectFiles } from '../lib/projectFileCleanup.js';
const env = { TENANT_PROJECTS_ENABLED:'true', EDITOR_RUNTIME_FLAGS:'{}', SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test',R2_ACCOUNT_ID:'test',R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test',R2_BUCKET:'test',R2_JURISDICTION:'eu' };
const items = Array.from({length:9},()=>{const id=crypto.randomUUID();return {id,r2_key:`org/${crypto.randomUUID()}/project/${crypto.randomUUID()}/file/${id}/v1.fcproj`};});
test('cleanup runs with proEditor off, deletes in batches of four and only purges confirmed deletions', async () => {
 let active=0,max=0; const finished=[];
 const result=await cleanupProjectFiles(env,{rpcCall:async(name,args)=>{if(name.startsWith('claim_'))return {items,claimed_unpurged:9};finished.push(args);return true;},remove:async key=>{
  active++;max=Math.max(max,active);await new Promise(r=>setImmediate(r));active--;return {ok:key!==items[0].r2_key};
 }});
 assert.equal(max,4);assert.equal(result.removed,8);assert.equal(result.claimed_unpurged,1);
 assert.equal(finished.find(x=>x.p_id===items[0].id).p_error,'delete_failed');
 assert.equal(finished.filter(x=>x.p_error===null).length,8);
});
test('cleanup validates keys and IDs before deleting and is tenant gated', async () => {
 let deletes=0;
 const deps={rpcCall:async name=>name.startsWith('claim_')?{items:[{...items[0],r2_key:items[1].r2_key}],claimed_unpurged:1}:true,remove:async()=>{deletes++;return {ok:true};}};
 assert.equal((await cleanupProjectFiles(env,deps)).failed,1);assert.equal(deletes,0);
 assert.deepEqual(await cleanupProjectFiles({...env,TENANT_PROJECTS_ENABLED:'false'},deps),{skipped:'disabled'});
});
test('code deployed before the migration: a missing function is "not migrated", not a failure', async () => {
 const logs=[];const info=console.info;console.info=line=>logs.push(line);
 try {
  for (const error of [Object.assign(new Error('missing'),{status:404}), Object.assign(new Error('missing'),{status:400,body:{code:'PGRST202'}})]) {
   const result=await cleanupProjectFiles(env,{rpcCall:async()=>{throw error;},remove:async()=>({ok:true})});
   assert.deepEqual(result,{skipped:'not_migrated'});
  }
  assert.equal(logs.length,0,'no failure line is logged for an unmigrated database');
  const other=await cleanupProjectFiles(env,{rpcCall:async()=>{throw Object.assign(new Error('boom'),{status:500});},remove:async()=>({ok:true})});
  assert.equal(other.failed,1);assert.equal(other.claimed_unpurged,0);
 } finally { console.info=info; }
});
