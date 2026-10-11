import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUDIO_STEMS,demucsOutputs} from '../lib/audioStems.mjs';
import {capabilityFor,publicCapabilities,shapePayload,checkInputs,checkSource} from '../lib/modelCapabilities.js';
import {generationModelsForMode,generationInputs,generationQuote,generationSources} from '../app/veyrnox/_lib/editorGeneration.mjs';
import {listLibraryMedia,loadLibraryBlob} from '../app/veyrnox/_lib/editorLibrary.mjs';
import {jobIdFromMediaId,mediaToRelink} from '../app/veyrnox/_lib/editorProject.mjs';
import {isShelfModel} from '../app/veyrnox/_lib/tokens.js';
const contract=JSON.parse(readFileSync(new URL('./fixtures/demucs-contract.json',import.meta.url)));
const record=capabilityFor('fal-ai/demucs'),cap=publicCapabilities(record);
const model={id:'demucs-stems',kind:'audio',takesPrompt:false,isSpeech:false,media:cap.media,outputStems:cap.outputStems,credits:6};
const id='12345678-1234-4123-8123-123456789012';
test('fixed six-stem payload matches independently captured official input/output schemas',()=>{
 const payload=shapePayload(record,{audio_url:'https://owned.invalid/source.wav'}),spec=contract.schemas.DemucsInput;
 assert.deepEqual(payload,{audio_url:'https://owned.invalid/source.wav',model:'htdemucs_6s',stems:['vocals','drums','bass','other','guitar','piano'],shifts:1,overlap:.25,output_format:'mp3'});
 for(const k of Object.keys(payload))assert.ok(spec.properties[k],k);
 assert.ok(spec.properties.model.enum.includes(payload.model));assert.ok(spec.properties.output_format.enum.includes(payload.output_format));
 assert.deepEqual(spec.properties.stems.anyOf[0].items.enum,payload.stems);
 for(const k of AUDIO_STEMS)assert.ok(contract.schemas.DemucsOutput.properties[k]);
 assert.equal(checkInputs(record,{audio_url:'https://owned.invalid/source.wav'}).ok,true);
 assert.equal(checkInputs(record,{}).ok,false);for(const k of ['shifts','model','stems','output_format'])assert.equal(checkInputs(record,{audio_url:'x',[k]:'override'}).ok,false);
 for(const seconds of [undefined,NaN,121])assert.equal(checkSource(record,{audio_url:{seconds}}).ok,false);
 assert.equal(checkSource(record,{audio_url:{seconds:120}}).ok,true);
});
test('dedicated editor mode requires exact ungated contract, one source and recorded consent',()=>{
 assert.deepEqual(generationModelsForMode([model,{...model,gated:true},{...model,outputStems:['vocals']}],'separation'),[model]);
 assert.equal(isShelfModel(cap),false);assert.deepEqual(generationInputs(model,{prompt:'hidden text'}),{inputs:{}});assert.equal(generationQuote(model,120),6);
 assert.ok(generationSources(model,{},true).error);const source={assetId:id,mimeType:'audio/wav'};
 assert.ok(generationSources(model,{audio:source},false).error);assert.deepEqual(generationSources(model,{audio:source},true),{assets:[{asset_id:id,slot:'audio'}]});
});
test('output parser accepts complete declared MP3 files only, including optional vendor MIME metadata',()=>{
 const payload=Object.fromEntries(AUDIO_STEMS.map(label=>[label,{url:`https://provider.invalid/${label}.mp3`,content_type:'audio/mpeg'}]));
 assert.equal(demucsOutputs({payload}).length,6);delete payload.vocals.content_type;assert.equal(demucsOutputs({payload}).length,6);
 for(const patch of [null,{url:'http://provider.invalid/v.mp3'},{url:payload.bass.url},{url:'https://provider.invalid/v.wav',content_type:'audio/wav'}])assert.equal(demucsOutputs({payload:{...payload,vocals:patch}}),null);
});
test('closed-panel Library recovery exposes six stems and fetches each only when selected',async()=>{
 const calls=[],fetcher=async path=>{calls.push(path);return path.startsWith('/jobs?')?{jobs:[{job_id:id,model_id:'demucs-stems',has_asset:true}]}:{mime_type:'audio/mpeg',output_stems:AUDIO_STEMS,url:'https://owned.invalid/stem.mp3'};};
 const items=await listLibraryMedia(fetcher);assert.deepEqual(items.map(x=>x.stem),AUDIO_STEMS);assert.equal(calls.length,2);
 const seen=[];await loadLibraryBlob(fetcher,id,async(url,init)=>{seen.push(init.credentials);return new Response(new Blob(['mp3'],{type:'audio/mpeg'}));},{stem:'bass'});
 assert.equal(calls.at(-1),`/jobs/${id}/asset?stem=bass`);assert.deepEqual(seen,['omit']);
 const before=calls.length;await assert.rejects(loadLibraryBlob(fetcher,id,fetch,{stem:'../../bad'}));assert.equal(calls.length,before);
});
test('saved stem IDs reopen their exact owned output and malformed suffixes never become primary vocals',()=>{
 const media=Object.fromEntries(AUDIO_STEMS.map(stem=>['j-'+id+'--'+stem,{id:'j-'+id+'--'+stem,kind:'audio',name:stem}]));
 assert.deepEqual(mediaToRelink({media}).library.map(x=>[x.jobId,x.stem]),AUDIO_STEMS.map(x=>[id,x]));
 for(const bad of ['j-'+id+'--unknown','j-'+id+'--vocals--bass'])assert.equal(jobIdFromMediaId(bad),null);
 assert.equal(jobIdFromMediaId('j-old-library-id'),'old-library-id');
});
