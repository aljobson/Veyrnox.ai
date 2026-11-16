import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmAssetAvailability, exportAvailabilityGuard, assertNoHeldAssets, playbackHoldObserver, HELD_EXPORT, UNCONFIRMED_EXPORT } from '../app/veyrnox/_lib/music/beat/beatAssetAvailability.mjs';
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

test('16 stems share 16 distinct checks, with four in flight and a fresh check for the next action', async () => {
  const assets = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`a${i}`, { source: 'song', ref: { jobId: `job${i}` } }]));
  // Include aliases of the same source, which must share its signing check.
  assets.alias = { ...assets.a0 };
  const song = { ...doc, assets, tracks: Object.keys(assets).map(assetId => ({ regions: [{ assetId }] })) };
  let calls = 0, inFlight = 0, peak = 0, files = 0, now = 0;
  const options = { state: () => ({ status: 'ready' }), markHeld: () => {}, request: async () => {
    calls++; peak = Math.max(peak, ++inFlight);
    await new Promise(resolve => setImmediate(resolve)); inFlight--;
    return { url: 'unused' };
  } };
  const confirm = exportAvailabilityGuard(song, options, () => now);
  for (let i = 0; i < 16; i++) { await confirm(); files++; now += 1100; }
  assert.equal(files, 16); assert.equal(calls, 16); assert.equal(peak, 4); assert.equal(inFlight, 0);
  await exportAvailabilityGuard(song, options, () => now)();
  assert.equal(calls, 32);
});

test('a hold at the 60-second re-confirmation stops any further files', async () => {
  let now = 0, calls = 0, files = 0, held = false;
  const confirm = exportAvailabilityGuard(doc, {
    state: () => ({ status: held ? 'held' : 'ready' }), markHeld: () => { held = true; },
    request: async () => { if (++calls > 1) throw { status: 404, body: { error: 'held' } }; return { url: 'unused' }; },
  }, () => now);
  const deliver = async () => { await confirm(); files++; };
  await deliver(); now = 60_000; await deliver();
  assert.equal(calls, 1);
  now++; await assert.rejects(deliver(), { message: HELD_EXPORT });
  await assert.rejects(deliver(), { message: HELD_EXPORT });
  assert.equal(files, 2); assert.equal(calls, 2); assert.equal(held, true);
});

test('an export confirmation rate limit fails closed before a file is delivered', async () => {
  let files = 0;
  const confirm = exportAvailabilityGuard(doc, { state: () => ({ status: 'ready' }), markHeld: () => {},
    request: async () => { throw { status: 429, code: 'rate_limited', retryAfter: 60 }; } });
  await assert.rejects(async () => { await confirm(); files++; }, { message: UNCONFIRMED_EXPORT });
  assert.equal(files, 0);
});
