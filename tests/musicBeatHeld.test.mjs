import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmAssetAvailability, assertNoHeldAssets, playbackHoldObserver, HELD_EXPORT, UNCONFIRMED_EXPORT } from '../app/veyrnox/_lib/music/beat/beatAssetAvailability.mjs';
const asset={source:'song',ref:{jobId:'job'}},doc={tempo:{bpm:120},assets:{a1:asset},tracks:[{regions:[{assetId:'a1'},{assetId:'a1'}]}]};
test('cached render must confirm release on each delivery; held marks the region and refuses',async()=>{
  const states=new Map();let calls=0,hold=false;
  const options={state:a=>states.get(a)||{status:'ready'},markHeld:a=>states.set(a,{status:'held'}),request:async()=>{
    calls++;if(hold)throw {status:404,code:'held'};return {url:'unused'};
  }};
  await confirmAssetAvailability(doc,options);assert.equal(calls,1);
  hold=true;await assert.rejects(confirmAssetAvailability(doc,options),{message:HELD_EXPORT});
  assert.equal(states.get(asset).status,'held');assert.throws(()=>assertNoHeldAssets(doc,options.state),{message:HELD_EXPORT});
});
test('offline, rate-limit and server failures fail closed; local sounds and takes make no requests',async()=>{
  for(const status of [0,429,503])await assert.rejects(confirmAssetAvailability(doc,{state:()=>({status:'ready'}),markHeld:()=>{},request:async()=>{throw {status};}}),{message:UNCONFIRMED_EXPORT});
  await confirmAssetAvailability({...doc,assets:{a1:{source:'take',ref:'take'}}},{state:()=>({status:'ready'}),request:()=>assert.fail('local project must not fetch'),markHeld:()=>{}});
});

test('a newly discovered hold stops playback once; already-held placeholders permit later playback',()=>{
  let held=false,stops=0,announcement='';
  const observe=playbackHoldObserver({current:()=>doc,state:()=>({status:held?'held':'ready'}),playing:()=>true,stop:()=>stops++,announce:s=>announcement=s});
  observe();assert.equal(stops,0);held=true;observe();assert.equal(stops,1);assert.match(announcement,/Playback stopped/);
  observe();assert.equal(stops,1);
});
