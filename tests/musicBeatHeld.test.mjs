import test from 'node:test';
import assert from 'node:assert/strict';
import { audioDoc } from './musicBeatAudioFixtures.mjs';
import { validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
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

function exportSong() {
  const source = { source: 'song', name: 'Part', bpm: null, durationSec: 2, sourceChannels: 2, encodedBytes: 100,
    ref: { songId: 'e40439d1-646a-4c11-9c12-69fa3a851234', versionId: 'e40439d1-646a-4c11-9c12-69fa3a851234', jobId: 'e40439d1-646a-4c11-9c12-69fa3a851234' } };
  const song = audioDoc(source), track = song.tracks[1];
  song.assets = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`a${i}`, { ...source, ref: { ...source.ref, jobId: `e40439d1-646a-4c11-9c12-69fa3a8512${String(i).padStart(2, '0')}` } }]));
  song.tracks = Object.keys(song.assets).map((assetId, i) => ({ ...track, id: `t${i}`, regions: [{ ...track.regions[0], id: `r${i}`, assetId }] }));
  assert.equal(validateBeat(song).ok, true);
  return song;
}
test('16 one-asset stems make 16 fresh per-file checks; a 16-asset mix makes 16 with at most four in flight', async () => {
  const song = exportSong();
  // A duplicate region on the same track must share its signing check.
  song.tracks[0].regions.push({ ...song.tracks[0].regions[0], id: 'rdup', start: 3840 });
  let calls = 0, inFlight = 0, peak = 0;
  const options = { state: () => ({ status: 'ready' }), markHeld: () => {}, request: async () => {
    calls++; peak = Math.max(peak, ++inFlight);
    await new Promise(resolve => setImmediate(resolve)); inFlight--;
    return { url: 'unused' };
  } };
  const confirm = exportAvailabilityGuard(song, options);
  for (const track of song.tracks) await confirm({ soloTrackId: track.id });
  assert.equal(calls, 16); assert.equal(peak, 1);
  calls = 0; await confirm();
  assert.equal(calls, 16); assert.equal(peak, 4); assert.equal(inFlight, 0);
  await confirm(); assert.equal(calls, 32, 'cached WAV redelivery checks every asset again');
});

test('a hold landing between stem 3 and stem 4 stops at stem 4 and prevents further files', async () => {
  const song = exportSong(); let calls = 0, files = 0;
  const marked = [];
  const confirm = exportAvailabilityGuard(song, {
    state: () => ({ status: 'ready' }), markHeld: a => marked.push(a),
    request: async () => { if (++calls === 4) throw { status: 404, body: { error: 'held' } }; return { url: 'unused' }; },
  });
  await assert.rejects(async () => {
    for (const track of song.tracks) { await confirm({ soloTrackId: track.id }); files++; }
  }, { message: HELD_EXPORT });
  assert.equal(files, 3); assert.equal(calls, 4); assert.deepEqual(marked, [song.assets.a3]);
  await assert.rejects(confirm({ soloTrackId: 't4' }), { message: HELD_EXPORT });
  assert.equal(calls, 4);
});

test('an export confirmation rate limit fails closed before a file is delivered', async () => {
  let files = 0;
  const confirm = exportAvailabilityGuard(exportSong(), { state: () => ({ status: 'ready' }), markHeld: () => {},
    request: async () => { throw { status: 429, code: 'rate_limited', retryAfter: 60 }; } });
  await assert.rejects(async () => { await confirm(); files++; }, { message: UNCONFIRMED_EXPORT });
  assert.equal(files, 0);
});

test('range checks ignore muted and non-overlapping assets; pattern exports make no checks', async () => {
  const song = exportSong(), paths = [];
  song.cycle = { on: true, start: 0, end: 3840 };
  for (const track of song.tracks.slice(2)) track.regions[0].start = 7680;
  song.tracks[1].mute = true;
  const confirm = exportAvailabilityGuard(song, { state: () => ({ status: 'ready' }), markHeld: () => {},
    request: async path => { paths.push(path); return { url: 'unused' }; } });
  await confirm({ range: 'cycle' }); assert.deepEqual(paths, [`/jobs/${song.assets.a0.ref.jobId}/asset`]);
  await confirm({ pattern: true }); assert.equal(paths.length, 1);
});
