import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBeat, validateBeat } from '../app/veyrnox/_lib/music/beat/beatDocument.mjs';
import { generateBody, replaceRange, actionEligibility, actionBody, aiPaths } from '../app/veyrnox/_lib/music/beat/beatAi.mjs';
import { validAsset } from '../app/veyrnox/_lib/music/beat/beatAudioRules.mjs';
import { placeAiResults } from '../app/veyrnox/_lib/music/beat/beatAiOps.mjs';
import { placementIds, validPending, writePending, readPending, singleFlight, submitPending } from '../app/veyrnox/_lib/music/beat/beatAiPending.mjs';
import { parseMusicQuote, musicBeatAiEnabled, musicRpcStatus, publicMusicError } from '../lib/musicBackend.js';
import { toPublicModels, normalizeCachedModels } from '../lib/publicCatalog.js';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const doc = () => ({ ...createBeat({ id: uuid(1) }), tempo: { bpm: 120 } });
const asset = { source: 'song', ref: { songId: uuid(2), versionId: uuid(3), jobId: uuid(4) }, name: 'Part', bpm: null, durationSec: 10, sourceChannels: 2, encodedBytes: 1000 };
const region = { id: 'r2', start: 0, length: 7680, phaseSec: 1, reverse: false };
const key = `beat-ai.${uuid(5)}`;
const pending = () => ({ op: 'generate', key, quoteId: uuid(6), submitPath: '/music/generations', source: null,
  prompt: 'Sax hook', placement: { afterTrackId: 't1', start: 0, length: 7680, phaseSec: 0, sourceTrackId: null, cycle: { start: 0, end: 7680 } },
  placementIds: placementIds(key), state: 'pending', createdAt: 1 });
test('generation body is bounded, instrumental, simple, valid and keeps an 80-character title within the parser', () => {
  const d = doc(); d.title = 'x'.repeat(80);
  const body = generateBody(d, 'Warm keys', 'C Major');
  assert.equal(body.title.length,80); assert.equal(body.duration_seconds,10); assert.equal(body.model_id,'ace-step-loop');
  assert.equal(parseMusicQuote(body).ok,true); assert.equal(parseMusicQuote({ ...body, mode:'custom' }).ok,false);
  assert.equal(parseMusicQuote({ ...body, model_id:'ace-step' }).ok,false);
  assert.throws(() => generateBody({ ...d, tempo:{bpm:221} },'x'),/220/);
  assert.throws(() => generateBody({ ...d, cycle:{start:0,end:200000} },'x'),/60 seconds/);
  assert.throws(() => generateBody(d,'x','bad'),/key/);
});
test('current-version eligibility uses the real song response and rejects repeated/reversed replacement', () => {
  const d=doc(), song={version_id:uuid(3),current_version:{id:uuid(3)}};
  assert.equal(actionEligibility('extend',d,region,asset,song,{}),'');
  assert.match(actionEligibility('extend',d,region,asset,{...song,version_id:uuid(7)},{}),/current version/);
  assert.match(actionEligibility('replace',d,{...region,length:38400},asset,song,{}),/doesn't repeat/);
  assert.match(actionEligibility('replace',d,{...region,reverse:true},asset,song,{}),/reversed/);
  assert.match(actionEligibility('stems',d,region,asset,song,{status:'held'}),/held/);
});
test('replacement maps trimmed and second-pass ranges and refuses wrap crossings', () => {
  const d=doc(); d.cycle={start:1920,end:5760};
  assert.deepEqual(replaceRange(d,region,asset),{start_seconds:2,end_seconds:4});
  assert.deepEqual(replaceRange({...d,cycle:{start:19200,end:23040}}, {...region,phaseSec:0,length:38400},asset),{start_seconds:0,end_seconds:2});
  assert.throws(()=>replaceRange({...d,cycle:{start:15360,end:23040}}, {...region,length:38400},asset),/one pass/);
  assert.throws(()=>replaceRange(d,{...region,reverse:true},asset),/reversed/);
});
test('region quote bodies use exact operation parsers and no current-version commit', () => {
  const args={doc:doc(),region,asset,prompt:'Brass',instrument:'drums',rights:true};
  assert.deepEqual(actionBody('stems',args),{version_id:uuid(3),rights_confirmed:true});
  assert.deepEqual(actionBody('targetStems',args),{version_id:uuid(3),rights_confirmed:true,instrument:'drums'});
  assert.equal(aiPaths('replace',uuid(2)).submit,`/music/songs/${uuid(2)}/replacements`);
});
test('new source refs validate without changing old v4 and preserve lineage', () => {
  assert.equal(validateBeat(doc()).ok,true);
  for (const [source,extra] of [['stem',{part:'vocals'}],['target',{kind:'target',instrument:'drums'}]]) {
    const a={...asset,source,ref:{songId:uuid(2),versionId:uuid(3),requestId:uuid(4),...extra}};
    assert.equal(validAsset(a,120),true); assert.equal(validAsset({...a,ref:{...a.ref,requestId:'bad'}},120),false);
  }
});
test('pair placement is one immutable edit, idempotent, B-only audible, track cap enforced', () => {
  const d=doc(), r=pending(), results=[{ordinal:0,asset,name:'A'},{ordinal:1,asset,name:'B'}];
  const next=placeAiResults(d,r,results); assert.equal(next.tracks.length,3); assert.equal(d.tracks.length,1);
  assert.equal(next.tracks[1].mute,false); assert.equal(next.tracks[2].mute,true); assert.equal(validateBeat(next).ok,true);
  assert.equal(placeAiResults(next,r,results),next);
  assert.equal(placeAiResults(d,r,[results[1]]).tracks[1].mute,false);
  const full={...d,tracks:Array.from({length:15},(_,i)=>({...d.tracks[0],id:`t${i}`,regions:[]}))};
  assert.throws(()=>placeAiResults(full,r,results),/Remove a track/);
});
test('persistent records reject injected paths and malformed refs; two taps share one POST and retries reuse the key', async () => {
  const r=pending(), data=new Map(), storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};
  assert.equal(validPending(r),true); assert.equal(validPending({...r,submitPath:'/other'}),false);
  writePending(uuid(1),r,storage); assert.deepEqual(readPending(uuid(1),storage),[r]);
  const gate=singleFlight(); let calls=0, release; const seen=[];
  const request=async(path,init)=>{calls++;seen.push(JSON.parse(init.body));await new Promise(r=>release=r);return {ok:true};};
  const one=gate(()=>submitPending(r,request)),two=gate(()=>submitPending(r,request)); await Promise.resolve();
  assert.equal(calls,1); release(); await Promise.all([one,two]);
  await submitPending(r,async(_path,init)=>seen.push(JSON.parse(init.body))); assert.equal(seen[0].idempotency_key,seen[1].idempotency_key);
  assert.throws(()=>writePending(uuid(1),r,{...storage,setItem:()=>{throw Error('quota');}}),/storage/);
});
test('flag fails closed and loop stays absent from public projections even if active', () => {
  const flags={ui:true,schema:true,generation:true,dispatch:true,beatEditor:true,beatAi:true};
  assert.equal(musicBeatAiEnabled({MUSIC_RUNTIME_FLAGS:JSON.stringify(flags)}),true);
  for(const field of ['ui','schema','generation','dispatch','beatEditor','beatAi']) assert.equal(musicBeatAiEnabled({MUSIC_RUNTIME_FLAGS:JSON.stringify({...flags,[field]:false})}),false);
  const row={id:'ace-step-loop',provider_endpoint:'fal-ai/ace-step-1.5',active:true};
  assert.deepEqual(toPublicModels([row]),[]);assert.deepEqual(normalizeCachedModels([row]),[]);
  assert.equal(musicRpcStatus('HELD'),409);assert.equal(publicMusicError('HELD'),'source_held');
});
test('resume never POSTs and legacy prompt is hidden while the existing layer list stays', () => {
  const hook=readFileSync(new URL('../app/veyrnox/_components/music/beat/useBeatAiRequest.js',import.meta.url),'utf8');
  assert.match(hook,/gatewayFetch\(aiPollPath\(r\)\)/);assert.match(hook,/keep\(r\);[\s\S]*submitPending\(r/);
  const bar=readFileSync(new URL('../app/veyrnox/_components/music/beat/BeatMagicBar.jsx',import.meta.url),'utf8');
  assert.match(bar,/!hidePrompt && !generation/);assert.match(bar,/loops.layers.map/);
});
