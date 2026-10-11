import test from 'node:test';
import assert from 'node:assert/strict';
import { processAudio } from '../app/veyrnox/_lib/editorDsp.mjs';
import { fft } from '../app/veyrnox/_lib/editorNoise.mjs';
import { AUDIO_DEFAULTS } from '../app/veyrnox/_lib/editorAudioSettings.mjs';
import { audioWorkingBytes } from '../app/veyrnox/_lib/editorSpeed.mjs';
import { emptySequence,addSequenceMedia,addSequenceClip,updateSequenceClip,extractSequenceAudio } from '../app/veyrnox/_lib/editorSequence.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const sr=48000,signal=new AbortController().signal;
const tone=(seconds=2)=>Float32Array.from({length:seconds*sr},(_,i)=>Math.sin(i/sr*2*Math.PI*440)*.4);
const chunks=data=>[{timestamp:0,sampleRate:sr,channels:[data,Float32Array.from(data,x=>-x)]}];
const clip={in:0,len:30,rate:2,volume:1,preservePitch:true};
function amplitude(data,hz,from=.2,to=.8){let a=0,b=0,count=0;for(let i=Math.round(from*sr);i<Math.round(to*sr);i++){a+=data[i]*Math.cos(i/sr*2*Math.PI*hz);b+=data[i]*Math.sin(i/sr*2*Math.PI*hz);count++;}return Math.hypot(a,b)*2/count;}
const rms=data=>Math.sqrt(data.reduce((sum,v)=>sum+v*v,0)/data.length);
test('pitch preservation and custom pitch keep duration, frequency and stereo phase',async()=>{
    const source=tone(),preserved=await processAudio(chunks(source),clip,sr,sr,signal);
    assert.equal(preserved[0].length,sr);assert.ok(amplitude(preserved[0],440)>.3);assert.ok(amplitude(preserved[0],880)<.03);
    for(let i=0;i<sr;i++)assert.ok(Math.abs(preserved[0][i]+preserved[1][i])<1e-6);
    const raised=await processAudio(chunks(source),{...clip,audioProcessing:{...AUDIO_DEFAULTS,pitch:12}},sr,sr,signal);assert.ok(amplitude(raised[0],880)>.3);assert.ok(amplitude(raised[0],440)<.03);
});
test('learned spectral suppression reduces noise while retaining a voiced tone',async()=>{
    let seed=91;const clean=tone(2),noisy=Float32Array.from(clean,(v,i)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (i<sr*.4?0:v)+(seed/2**32-.5)*.12;});
    const result=await processAudio(chunks(noisy),{in:0,len:60,rate:1,volume:1,audioProcessing:{...AUDIO_DEFAULTS,noiseReduction:1,noiseLength:.3}},sr*2,sr,signal);
    const originalNoise=rms(noisy.subarray(sr*.1,sr*.3)),remainingNoise=rms(result[0].subarray(sr*.1,sr*.3));assert.ok(remainingNoise<originalNoise*.65,`${remainingNoise}/${originalNoise}`);
    assert.ok(amplitude(result[0],440,.6,1.8)>.35);
});
test('FFT analysis reconstructs samples; processing cancels before expensive work',async()=>{
    const original=Float64Array.from({length:2048},(_,i)=>Math.sin(i*.013)+Math.cos(i*.27)),real=original.slice(),imag=new Float64Array(real.length);fft(real,imag);fft(real,imag,true);for(let i=0;i<real.length;i++)assert.ok(Math.abs(real[i]-original[i])<1e-10);
    const controller=new AbortController();controller.abort();await assert.rejects(processAudio(chunks(tone()),clip,sr,sr,controller.signal),{name:'AbortError'});
});
test('audio settings persist/extract, reject invalid profiles and account for retained sound memory',()=>{
    let tl=addSequenceClip(addSequenceMedia(emptySequence(),{id:'source',kind:'video',frames:300,name:'Source',hasAudio:true,width:640,height:360}),'video','source',{len:120});
    tl=updateSequenceClip(tl,'video','v1',{preservePitch:true,audioProcessing:{...AUDIO_DEFAULTS,voice:'deep',noiseReduction:.5,noiseStart:1}});assert.equal(tl.error,undefined);
    const extracted=extractSequenceAudio(tl,'v1');assert.equal(extracted.audio[0].preservePitch,true);assert.deepEqual(extracted.audio[0].audioProcessing,tl.video[0].audioProcessing);
    const id='11111111-1111-4111-8111-111111111111';assert.equal(validProjectDocument(JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),tl))),id),true);
    for(const patch of [{preservePitch:'yes'},{audioProcessing:{...AUDIO_DEFAULTS,pitch:13}},{audioProcessing:{...AUDIO_DEFAULTS,voice:'fake'}},{audioProcessing:{...AUDIO_DEFAULTS,noiseReduction:1,noiseStart:10}}])assert.ok(updateSequenceClip(tl,'video','v1',patch).error);
    assert.ok(audioWorkingBytes(tl)>4*sr*2*4);
    const large={...tl,media:{source:{...tl.media.source,frames:180000}},video:[{...tl.video[0],len:18000,rate:8,preservePitch:false,audioProcessing:{...AUDIO_DEFAULTS}}]};assert.ok(audioWorkingBytes(large)>512*1024*1024);
});
