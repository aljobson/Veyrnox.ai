import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedance25Session, seedance25Models } from '../lib/seedance25Client.mjs';
const model = { id:'seedance-2.5-edit',credits:76,media:{video:{required:true,maxFiles:1}} };
test('actions require catalog video slots and never expose gated placeholders',()=>{
 assert.deepEqual(seedance25Models([model,{...model,gated:true},{...model,media:{}},{...model,id:'other'}]),[model]);
});
test('web and phone use exact quote, reuse uploads and retain retry identity after lost response',async()=>{
 const sent=[];let uploads=0, attempts=0;
 const session=createSeedance25Session({makeKey:()=> 'stable-key',reference:async()=>{uploads++;return {slot:'video',origin:'upload',key:'owned'};},
 request:async(path,body)=>{sent.push({path,body});if(path.endsWith('/quote'))return {model_id:model.id,credits:152,units:2,source_seconds:5.055};
 if(++attempts===1)throw new Error('network');return {job_id:'accepted'};}});
 await assert.rejects(session.submit());
 await session.quote(model,'prompt'); await session.quote(model,'new prompt'); assert.equal(uploads,1);
 await assert.rejects(session.submit()); assert.equal(session.attempted,true);
 await assert.rejects(session.quote(model,'cannot replace unknown request'));
 assert.deepEqual(await session.submit(),{job_id:'accepted'});
 assert.deepEqual(sent.at(-1).body,sent.at(-2).body);
 assert.equal(sent.at(-1).body.confirmed_credits,152);
 assert.deepEqual(sent.at(-1).body.inputs,{prompt:'new prompt'});
});
test('account changes after source upload prevent quote or debit',async()=>{
 let current=true;
 const session=createSeedance25Session({makeKey:()=>'',reference:async()=>{current=false;return {};},current:()=>current,request:()=>assert.fail('no request')});
 await assert.rejects(session.quote(model,'x'),/account_changed/);
});
