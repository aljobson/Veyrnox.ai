import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence, addSequenceMedia, addSequenceClip, updateSequenceTrack } from '../app/veyrnox/_lib/editorSequence.mjs';
import { speechSelection, timelineSpeechPCM } from '../app/veyrnox/_lib/editorSpeechAudio.mjs';
import { recognizeTimelineSpeech } from '../app/veyrnox/_lib/editorSpeechRecognition.mjs';
const fixture=()=>{
    let tl=emptySequence();for(const id of ['video-source','audio-source','late-source'])tl=addSequenceMedia(tl,{id,kind:id==='video-source'?'video':'audio',frames:18000,width:id==='video-source'?640:0,height:id==='video-source'?360:0,name:id,hasAudio:true});
    tl=addSequenceClip(tl,'video','video-source',{len:18000});tl=addSequenceClip(tl,'audio','audio-source',{len:300});return addSequenceClip(tl,'audio','late-source',{start:15000,len:300});
};
const runtime=record=>({
    BlobSource:class {constructor(blob){this.blob=blob;}}, ALL_FORMATS:[],
    Input:class {constructor({source}){this.source=source;record.inputs.push(this);}dispose(){record.disposed++;}},
    async mixAudio(tl,inputs,length,signal,window){record.mix={tl,ids:[...inputs.keys()],length,window};return {numberOfChannels:1,sampleRate:48000,getChannelData:()=>Float32Array.from({length},(_,i)=>.2*Math.sin(i/8))};}
});
test('selected-track ranges in long projects load only intersecting media and dispose inputs',async()=>{
    const tl=fixture(), record={inputs:[],disposed:0}, plan=speechSelection(tl,{trackId:'audio-0',startFrame:15000,endFrame:15030});
    assert.deepEqual(plan.mediaIds,['late-source']);assert.equal(plan.seconds,1);
    const pcm=await timelineSpeechPCM(tl,new Map([['late-source',new Blob(['source'])]]),{trackId:'audio-0',startFrame:15000,endFrame:15030,audioRuntime:runtime(record)});
    assert.equal(pcm.length,16000);assert.equal(record.inputs.length,1);assert.equal(record.disposed,1);assert.deepEqual(record.mix.window,{startFrame:15000,endFrame:15030});assert.equal(record.mix.tl.video.length,0);
});
test('selection respects mute, whole-mix solo and source availability, with no implicit substitute track',async()=>{
    const tl=updateSequenceTrack(fixture(),'video-0',{solo:true});
    assert.deepEqual(speechSelection(tl,{startFrame:0,endFrame:30}).mediaIds,['video-source']);
    assert.deepEqual(speechSelection(tl,{trackId:'audio-0',startFrame:0,endFrame:30}).mediaIds,['audio-source']);
    assert.deepEqual(speechSelection(updateSequenceTrack(tl,'audio-0',{muted:true}),{trackId:'audio-0',startFrame:0,endFrame:30}).mediaIds,[]);
    for(const options of [{trackId:'text-0',startFrame:0,endFrame:30},{trackId:'missing',startFrame:0,endFrame:30},{startFrame:0,endFrame:3601},{startFrame:15000,endFrame:15000},{startFrame:0.5,endFrame:30}])assert.throws(()=>speechSelection(tl,options));
    const record={inputs:[],disposed:0};await assert.rejects(timelineSpeechPCM(tl,new Map(),{trackId:'audio-0',startFrame:0,endFrame:30,audioRuntime:runtime(record)}),/Relink audio-source/);assert.equal(record.inputs.length,0);
});
test('recognition requires only the available outgoing transition tail, without changing the edit',async()=>{
    const transition=(frames,rate=1)=>{
        let tl=emptySequence();
        for(const [id,count] of [['outgoing',frames],['incoming',60]])tl=addSequenceMedia(tl,{id,kind:'video',frames:count,width:640,height:360,name:id,hasAudio:true});
        tl=addSequenceClip(tl,'video','outgoing',{len:30,rate});return addSequenceClip(tl,'video','incoming',{start:30,len:30,transition:30});
    };
    const exhausted=transition(30),plan=speechSelection(exhausted,{startFrame:45,endFrame:60});
    assert.deepEqual(plan.mediaIds,['incoming']);assert.equal(plan.timeline,exhausted,'preflight must retain both clips and their fade relationship');
    const record={inputs:[],disposed:0};
    const pcm=await timelineSpeechPCM(exhausted,new Map([['incoming',new Blob(['source'])]]),{startFrame:45,endFrame:60,audioRuntime:runtime(record)});
    assert.equal(pcm.length,8000);assert.deepEqual(record.mix.ids,['incoming']);assert.equal(record.mix.tl.video.length,2);assert.equal(record.disposed,1);
    assert.deepEqual(speechSelection(transition(60),{startFrame:45,endFrame:60}).mediaIds,['outgoing','incoming']);
    const faster=transition(90,2);
    assert.deepEqual(speechSelection(faster,{startFrame:44,endFrame:45}).mediaIds,['outgoing','incoming']);
    assert.deepEqual(speechSelection(faster,{startFrame:45,endFrame:60}).mediaIds,['incoming'],'the source-limited tail is half-open at its last frame');
});
test('actual recognition results retain timeline offset while word intervals stay cue-relative',async()=>{
    const record={inputs:[],disposed:0};
    class Worker {postMessage(){queueMicrotask(()=>this.onmessage({data:{stage:'result',result:{text:'Hello world',chunks:[{text:'Hello',timestamp:[.1,.4]},{text:'world',timestamp:[.4,.9]}]}}}));}terminate(){record.terminated=true;}}
    const cues=await recognizeTimelineSpeech(fixture(),new Map([['audio-source',new Blob(['source'])]]),{trackId:'audio-0',startFrame:30,endFrame:60,audioRuntime:runtime(record),WorkerClass:Worker});
    assert.equal(cues[0].start,33);assert.deepEqual(cues[0].words.map(w=>[w.start,w.len]),[[0,9],[9,15]]);assert.equal(cues[0].wordsEstimated,false);assert.equal(record.terminated,true);assert.equal(record.disposed,1);
});
