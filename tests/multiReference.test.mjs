import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, capabilityFor, checkSource, checkInputs, shapePayload, publicCapabilities } from '../lib/modelCapabilities.js';
import { OTHERS } from '../lib/additionalModelCapabilities.js';
import { readGenerationSources, resolveGenerationSources } from '../lib/generationSources.js';
import { effectiveMaxFiles, multiReferenceEnabled, verifiedReferenceLimit, hardMaxFiles } from '../lib/multiReference.mjs';
import { mediaGenerationSources } from '../app/veyrnox/_lib/chatMedia.js';
import { cleanCreateDraft, reopenDraftSources } from '../lib/createDraftRecovery.js';
import { moveSlotSource, generationSourceState } from '../lib/generationSourceSlots.mjs';
import { writeStudioDraft, takeStudioDraft } from '../app/veyrnox/_lib/landingDraft.js';
import { startMcpVideo } from '../lib/mcpVideo.js';
import { planAttachments } from '../lib/createAttach.mjs';
const record = capabilityFor('fal-ai/nano-banana-pro/edit');
const assetId = '11111111-1111-4111-8111-111111111111';
const references = [{slot:'image',origin:'upload',key:'a'}, {slot:'image',origin:'asset',asset_id:assetId}, {slot:'image',origin:'upload',key:'c'}];
async function flag(value, run) {
  const old = process.env.MULTI_REFERENCE_ENABLED;
  process.env.MULTI_REFERENCE_ENABLED = value;
  try { return await run(); } finally { if (old === undefined) delete process.env.MULTI_REFERENCE_ENABLED; else process.env.MULTI_REFERENCE_ENABLED = old; }
}
const source = name => ({ok:true,url:`https://owned.test/${name}`,contentType:'image/png',sizeBytes:10,dimensions:{width:100,height:100}});
test('every raised limit has a verified array contract and pricing evidence', () => {
  for (const [endpoint, additional] of Object.entries(OTHERS)) assert.equal(REGISTRY[endpoint], additional);
  for (const [endpoint, r] of Object.entries(REGISTRY)) {
    assert.equal(capabilityFor(endpoint), r);
    for (const [slot, spec] of Object.entries(r.media)) {
    assert.ok(Number.isInteger(spec.max ?? 1) && (spec.max ?? 1) >= 1 && (spec.max ?? 1) <= 3);
    if ((spec.max ?? 1) > 1) { assert.equal(spec.list,true); assert.match(spec.verification,/^https:\/\//); assert.match(spec.priceVerification,/^https:\/\//); assert.match(spec.verifiedAt,/^\d{4}-\d{2}-\d{2}$/); assert.ok(verifiedReferenceLimit(spec), `${endpoint}:${slot} needs dated count and price verification`); }
    }
  }
});
test('single-reference provider payloads stay unchanged with the flag off and on', async () => {
  for (const enabled of ['false','true']) await flag(enabled, () => {
    for (const r of Object.values(REGISTRY).filter(r => !r.derive)) {
      for (const [slot,spec] of Object.entries(r.media)) {
        assert.deepEqual(shapePayload(r,{[`${slot}_url`]:'url'})[spec.field],spec.list ? ['url'] : 'url');
      }
    }
    assert.equal(publicCapabilities(record).media.image.maxFiles,enabled === 'true' ? 3 : 1);
  });
  assert.equal(effectiveMaxFiles({max:3,list:false},{MULTI_REFERENCE_ENABLED:'true'}),1);
});
test('mixed origins remain ordered through resolution and flat provider arrays', async () => flag('true', async () => {
  const parsed = readGenerationSources({references}); assert.equal(parsed.ok,true);
  const calls = [];
  const result = await resolveGenerationSources({...parsed,record}, {
    upload:async (_owner,key) => { calls.push(key); return source(key); },
    asset:async (_owner,id) => { calls.push(id); return source(id); },
  });
  assert.equal(result.ok,true); assert.deepEqual(calls,['a',assetId,'c']);
  assert.deepEqual(result.references,references);
  assert.deepEqual(shapePayload(record,result.inputs).image_urls,calls.map(id=>`https://owned.test/${id}`));
  assert.equal(checkInputs(record,{prompt:'p',...result.inputs}).ok,true);
  assert.equal(checkSource(record,result.sources).ok,true);
}));
test('flag-off counts and unknown slots stop before inspecting any source', async () => flag('false', async () => {
  let calls = 0;
  const result = await resolveGenerationSources({references,record},{upload:async()=>{calls++;return source('a');}});
  assert.equal(result.error,'source_count_exceeded'); assert.equal(calls,0);
  assert.equal(readGenerationSources({references,source_keys:[]}).error,'references_ambiguous');
  assert.equal(readGenerationSources({references:[...references,...references,...references,...references]}).error,'references_invalid');
}));
test('every reference receives pixel, duration, type and aggregate size checks', async () => flag('true', async () => {
  const bounded = {...record,media:{image:{...record.media.image,maxPixels:100,maxSeconds:5}}};
  const okay = {dimensions:{width:10,height:10},seconds:5};
  assert.equal(checkSource(bounded,{image_url:[okay,{...okay,dimensions:{width:11,height:10}},okay]}).error,'source_too_large');
  assert.equal(checkSource(bounded,{image_url:[okay,okay,{...okay,seconds:6}]}).error,'source_too_long');
  assert.equal(checkSource(bounded,{image_url:[okay,okay,{...okay,seconds:null}]}).error,'source_length_unknown');
  assert.equal(checkSource(bounded,{image_url:[okay,okay,okay,okay]}).error,'source_count_exceeded');
  const wrong = await resolveGenerationSources({references,record},{upload:async()=>source('a'),asset:async()=>({...source('b'),contentType:'video/mp4'})});
  assert.equal(wrong.error,'source_type_unsupported');
  const big = await resolveGenerationSources({references,record},{upload:async()=>({...source('a'),sizeBytes:300*1024*1024}),asset:async()=>({...source('b'),sizeBytes:300*1024*1024})});
  assert.equal(big.error,'sources_too_large');
}));
test('web serialization, reorder, draft recovery and handoff retain mixed source positions', async () => {
  const sources = {image:[{file:{name:'a.png'}},{assetId,label:'Library'}, {file:{name:'c.png'}}]};
  const model = {id:'edit',media:{image:{maxFiles:3}}};
  const sent = await mediaGenerationSources(model,sources,async file=>file.name);
  assert.deepEqual(sent.references.map(ref=>ref.origin),['upload','asset','upload']);
  const moved = moveSlotSource(sources,'image',2,0);
  assert.equal(moved.image[0].file.name,'c.png');
  const draft = cleanCreateDraft({modelId:'edit',sources});
  assert.equal(draft.needsUpload,true); assert.equal(draft.sources.image.length,3);
  const reopened = await reopenDraftSources(draft.sources,async()=>({url:'https://owned.test/library',mime_type:'image/png'}));
  assert.equal(reopened.restored.image[1].assetId,assetId);
  assert.equal(reopened.restored.image.filter(ref=>ref.needsUpload).length,2);
  await assert.rejects(mediaGenerationSources(model,reopened.restored,async()=>''),/reattach/);
  const store = new Map(), storage = {setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k),removeItem:k=>store.delete(k)};
  assert.equal(writeStudioDraft(storage,{model:'edit',prompt:'p',sources}),true);
  const handoff = takeStudioDraft(storage,'edit');
  assert.equal(handoff.needsUpload,true); assert.equal(handoff.sources.image[1].assetId,assetId);
  assert.equal(handoff.sources.image.length,3);
});
test('planner chooses the model fitting three images and reports the fourth', () => {
  const single={id:'single',kind:'image',credits:1,media:{image:{required:true}}},multi={...single,id:'multi',media:{image:{required:true,maxFiles:3}}};
  const files=Array.from({length:4},(_,i)=>({name:String(i),type:'image/png'}));
  const plan=planAttachments([single,multi],single,files);
  assert.equal(plan.model.id,'multi'); assert.deepEqual(plan.assignments.map(a=>a.file),files.slice(0,3)); assert.deepEqual(plan.unused,[files[3]]);
});
test('MCP honors the current model limit and the flag', async () => {
  const args={model_id:'video',prompt:'p',source_assets:Array.from({length:3},()=>({slot:'image',asset_id:assetId})),consent:true,user_approved:true,confirmed_credits:5};
  const calls=[]; const deps={findModel:async()=>({id:'video',modality:'image-to-video',credits:5,durations:[5],capabilities:{media:{image:{maxFiles:3}}}}),createGeneration:async body=>{calls.push(body);return{response:{ok:true},data:{job_id:'j'}};}};
  await flag('true',async()=>assert.equal((await startMcpVideo(args,deps)).ok,true));
  assert.equal(calls[0].references.length,3);
  await flag('false',async()=>assert.equal((await startMcpVideo(args,deps)).body.error,'source_count_exceeded'));
  assert.equal(calls.length,1);
});

test('Kie keeps one start image; a last frame is not a generic reference', async () => {
  const {buildRequest,parseEndpoint} = await import('../packages/adapters/kie.js');
  for (const enabled of ['false','true']) await flag(enabled,()=>{
    assert.deepEqual(buildRequest(parseEndpoint('market:kling-3.0/video'),{prompt:'p',image_url:'one'}).body.input.image_urls,['one']);
    const two=buildRequest(parseEndpoint('market:kling-3.0/video'),{prompt:'p',image_url:['one','two']});
    assert.equal(two.error,'source_count_exceeded');
    assert.equal(publicCapabilities(capabilityFor('market:kling-3.0/video')).media.image.maxFiles,1);
  });
});

test('late multi-reference flag is off unless explicitly the string true', () => {
  for (const value of [undefined, '', 'false', 'TRUE', '1', true, 1]) {
    const env = value === undefined ? {} : {MULTI_REFERENCE_ENABLED:value};
    assert.equal(multiReferenceEnabled(env), false);
    assert.equal(effectiveMaxFiles({max:3,list:true},env),1);
  }
  assert.equal(effectiveMaxFiles(record.media.image,{MULTI_REFERENCE_ENABLED:'true'}),3);
});

test('unverified raised limits fail closed even with the flag enabled', () => {
  const verified = record.media.image, env = {MULTI_REFERENCE_ENABLED:'true'};
  for (const field of ['verification','verifiedAt','priceVerification']) {
    for (const value of [undefined, '', 'unverified', 'http://example.test', '2026-02-30']) {
      assert.equal(effectiveMaxFiles({...verified,[field]:value},env),1,`${field}=${value}`);
    }
  }
  assert.equal(effectiveMaxFiles({max:3,list:true},env),1);
});

test('unknown totals fail closed and individually valid videos hit the combined bound', async () => flag('true', async () => {
  for (const sizeBytes of [undefined, null, NaN, -1, 0]) {
    const result = await resolveGenerationSources({record,references:references.slice(0,1)}, {upload:async()=>({...source('a'),sizeBytes})});
    assert.equal(result.error,'source_size_unknown');
  }
  // Synthetic verified endpoint exercises a future multi-video slot without raising any catalog cap.
  const videoRecord = {media:{video:{...record.media.image,field:'video_urls'}}};
  const videos = ['a','b','c'].map(key=>({slot:'video',origin:'upload',key}));
  const resolve = count => resolveGenerationSources({record:videoRecord,references:videos.slice(0,count)}, {
    upload:async()=>({...source('video'),contentType:'video/mp4',sizeBytes:100*1024*1024}),
  });
  assert.equal((await resolve(2)).ok,true,'exactly 200 MiB fits');
  assert.equal((await resolve(3)).error,'sources_too_large','each file fits its 100 MiB cap, their sum does not');
}));

test('optional incomplete references block readiness and serialization before any upload', async () => {
  const media = {image:{required:false,maxFiles:3}};
  for (const placeholder of [{needsUpload:true},{needsUpload:true,assetId}]) {
    const sources = {image:[{file:{name:'first.png'}},placeholder]};
    assert.deepEqual(generationSourceState(media,sources),{needsReattach:true,hasSource:false,missingSource:true});
    await assert.rejects(mediaGenerationSources({media},sources,()=>assert.fail('must validate all references before uploading')), {code:'source_reattach_required'});
  }
  assert.deepEqual(generationSourceState(media,{}),{needsReattach:false,hasSource:false,missingSource:false});
  assert.deepEqual(generationSourceState(media,{image:{assetId}}),{needsReattach:false,hasSource:true,missingSource:false});
});

test('dispatch uses the hard contract after the admission flag turns off', async () => {
  const {buildRequest,parseEndpoint}=await import('../packages/adapters/kie.js');
  const target=parseEndpoint('market:kling-3.0/video');
  const stored={prompt:'p',image_url:['admitted-start']};
  const admitted=await flag('true',()=>buildRequest(target,stored));
  await flag('false',()=>{
    assert.deepEqual(buildRequest(target,stored),admitted);
    assert.equal(buildRequest(target,{...stored,image_url:['start','last']}).error,'source_count_exceeded');
    // Future verified multi-reference contracts keep their hard bound even when admission closes.
    assert.equal(hardMaxFiles(record.media.image),3);
    assert.equal(effectiveMaxFiles(record.media.image),1);
  });
});

test('a synthetic admitted multi-file contract survives a flag change at Kie dispatch', async () => {
  const {buildRequest,parseEndpoint}=await import('../packages/adapters/kie.js');
  const endpoint=capabilityFor('market:kling-3.0/video'), original=endpoint.media.image;
  // Test-only future contract: production Kling remains one start frame. This
  // catches dispatch accidentally consulting the live admission switch again.
  endpoint.media.image={...original,max:3,verifiedAt:'2026-10-26',verification:'https://fixture.invalid/count',priceVerification:'https://fixture.invalid/price'};
  try {
    const inputs={prompt:'p',image_url:['one','two','three']}, target=parseEndpoint('market:kling-3.0/video');
    const admitted=await flag('true',()=>{
      assert.equal(effectiveMaxFiles(endpoint.media.image),3);
      return buildRequest(target,inputs);
    });
    assert.equal(admitted.ok,true);
    await flag('false',()=>{
      assert.equal(effectiveMaxFiles(endpoint.media.image),1);
      assert.deepEqual(buildRequest(target,inputs),admitted);
      assert.equal(buildRequest(target,{...inputs,image_url:[...inputs.image_url,'four']}).error,'source_count_exceeded');
    });
  } finally { endpoint.media.image=original; }
});
