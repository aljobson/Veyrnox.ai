import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ORIGINAL_AUDIO,originalAudioBlob,synthesizeOriginalAudio,originalAudioProblem,restoreOriginalAudio } from '../app/veyrnox/_lib/editorOriginalAudio.mjs';
import { emptySequence,addSequenceMedia,addSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { documentForTimeline,timelineFromDocument,mediaToRelink } from '../app/veyrnox/_lib/editorProject.mjs';
import { emptyProjectDocument } from '../lib/projectDocument.js';
test('every original catalog sound produces bounded, audible PCM with click-free ends',()=>{
    for(const p of ORIGINAL_AUDIO){const samples=synthesizeOriginalAudio(p.id);let energy=0,peak=0;for(const s of samples){assert.ok(Number.isFinite(s));energy+=s*s;peak=Math.max(peak,Math.abs(s));}assert.equal(samples.length,Math.round(p.seconds*48000));assert.ok(Math.sqrt(energy/samples.length)>.005,p.id);assert.ok(peak<.5,p.id);assert.equal(samples[0],0);assert.ok(Math.abs(samples.at(-1))<.001);}
});
test('WAV headers and sample data describe the exact generated mono source; regeneration is byte-identical',async()=>{
    const a=await originalAudioBlob('soft-keys').arrayBuffer(),b=await originalAudioBlob('soft-keys').arrayBuffer(),v=new DataView(a),ascii=(at,n)=>new TextDecoder().decode(new Uint8Array(a,at,n));assert.equal(ascii(0,4),'RIFF');assert.equal(ascii(8,4),'WAVE');assert.equal(v.getUint32(4,true),a.byteLength-8);assert.equal(v.getUint16(20,true),1);assert.equal(v.getUint16(22,true),1);assert.equal(v.getUint32(24,true),48000);assert.equal(v.getUint16(34,true),16);assert.equal(v.getUint32(40,true),48000*10*2);const digest=x=>createHash('sha256').update(new Uint8Array(x)).digest('hex');assert.equal(digest(a),digest(b));
});
test('saved original sound identities reopen without network or relinking and preserve existing blobs',async()=>{
    let t=addSequenceMedia(emptySequence(),{id:'sound1',kind:'audio',name:'Soft keys',frames:300,width:0,height:0,hasAudio:true,originalAudio:{version:1,presetId:'soft-keys'}});t=addSequenceClip(t,'audio','sound1');assert.equal(validateSequence(t),null);
    const saved=documentForTimeline(emptyProjectDocument(crypto.randomUUID()),t),opened=timelineFromDocument(JSON.parse(JSON.stringify(saved)));assert.equal(opened.problem,null);assert.deepEqual(mediaToRelink(opened.timeline),{library:[],assets:[],local:[]});const blobs=new Map();restoreOriginalAudio(opened.timeline,blobs);assert.ok(blobs.get('sound1').size>44);const existing=blobs.get('sound1');restoreOriginalAudio(opened.timeline,blobs);assert.equal(blobs.get('sound1'),existing);
});
test('unknown presets and algorithm versions cannot select arbitrary files or huge allocations',()=>{
    for(const source of [null,{version:2,presetId:'soft-keys'},{version:1,presetId:'https://untrusted.invalid'},{version:1,presetId:'soft-keys',url:'bad'}])assert.ok(originalAudioProblem(source));assert.throws(()=>synthesizeOriginalAudio('missing'));assert.throws(()=>synthesizeOriginalAudio('soft-keys',1e9));
});
