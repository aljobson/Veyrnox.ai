import test from 'node:test';
import assert from 'node:assert/strict';
import { hasRuntimeReplay } from '../lib/runtimeReplay.js';
test('paused replay lookup scopes keys to the verified owner and encodes PostgREST values',async()=>{
 const calls=[],cfg={};
 const read=async(table,query,config)=>{calls.push({table,query,config});return table==='users'?[{id:'user-1'}]:[{id:'job-1'}];};
 assert.equal(await hasRuntimeReplay('auth+id','key,a&b',cfg,read),true);
 assert.equal(calls[0].query.filter,'auth_id=eq.auth%2Bid');
 assert.equal(calls[1].query.filter,'user_id=eq.user-1&idempotency_key=eq.key%2Ca%26b');
 assert.ok(calls.every(c=>c.config===cfg&&c.query.limit===1));
 assert.equal(await hasRuntimeReplay('auth','key',cfg,async()=>[]),false);
 assert.equal(await hasRuntimeReplay('auth','key',cfg,async table=>table==='users'?[{id:'user-1'}]:[]),false);
 assert.equal(await hasRuntimeReplay('auth','key',cfg,async()=>{throw Error('unavailable');}),false);
});
