import test from 'node:test';
import assert from 'node:assert/strict';
import { mixAudio, SAMPLE_RATE } from '../app/veyrnox/_lib/editorAudio.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, reverseSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { AUDIO_DEFAULTS } from '../app/veyrnox/_lib/editorAudioSettings.mjs';
import { speechSelection, timelineSpeechPCM } from '../app/veyrnox/_lib/editorSpeechAudio.mjs';
// A deterministic scheduling probe evaluates gain ramps and source offsets, not browser Biquad quality.
class Param {
    value=1;events=[];
    setValueAtTime(value,time){this.events.push({value,time,type:'set'});}
    linearRampToValueAtTime(value,time){this.events.push({value,time,type:'ramp'});}
    at(time){let previous={value:this.value,time:0};for(const event of this.events){if(time<event.time)return event.type==='ramp'?previous.value+(event.value-previous.value)*(time-previous.time)/(event.time-previous.time):previous.value;previous=event;}return previous.value;}
}
const buffer=(channels,length,sampleRate)=>({length,numberOfChannels:channels,sampleRate,duration:length/sampleRate,data:Array.from({length:channels},()=>new Float32Array(length)),getChannelData(ch){return this.data[ch];},copyToChannel(data,ch){this.data[ch].set(data);}});
class Context {
    static all=[];
    constructor(channels,length,sampleRate){this.channels=channels;this.length=length;this.sampleRate=sampleRate;this.sources=[];this.destination={};Context.all.push(this);}
    createBuffer(...args){return buffer(...args);}
    node(){return {connect(target){this.target=target;}};}
    createGain(){return {...this.node(),gain:new Param()};}
    createBiquadFilter(){return {...this.node(),frequency:new Param(),gain:new Param()};}
    createStereoPanner(){return {...this.node(),pan:new Param()};}
    createBufferSource(){const node={...this.node(),playbackRate:new Param(),start(time,offset=0){assert.ok(time>=0);this.when=time;this.offset=offset;},stop(time){this.until=time;}};this.sources.push(node);return node;}
    async startRendering(){const out=this.createBuffer(this.channels,this.length,this.sampleRate);for(const source of this.sources){for(let i=Math.max(0,Math.round(source.when*this.sampleRate));i<Math.min(this.length,Math.round(source.until*this.sampleRate));i++){const time=i/this.sampleRate,pos=Math.round(((time-source.when)*source.playbackRate.value+source.offset)*source.buffer.sampleRate);if(pos>=source.buffer.length)continue;let gain=1,node=source.target;while(node&&node!==this.destination){if(node.gain&&!node.frequency)gain*=node.gain.at(time);node=node.target;}for(let ch=0;ch<this.channels;ch++)out.data[ch][i]+=source.buffer.getChannelData(Math.min(ch,source.buffer.numberOfChannels-1))[pos]*gain;}}return out;}
}
class Sink {
    static requests=[];
    constructor(track){this.track=track;}
    async *buffers(from,to){assert.ok(to>from,'decode windows must have positive duration');Sink.requests.push([this.track.id,from,to]);const start=Math.max(0,Math.floor(from*SAMPLE_RATE)),end=Math.min(this.track.samples.length,Math.ceil(to*SAMPLE_RATE)),part=this.track.samples.subarray(start,end),out=buffer(1,part.length,SAMPLE_RATE);out.copyToChannel(part,0);yield {timestamp:start/SAMPLE_RATE,buffer:out};}
}
const signal=()=>new AbortController().signal;
const fixture=options=>{let tl=addSequenceMedia(emptySequence(),{id:'sound',kind:'audio',frames:90,width:0,height:0,hasAudio:true,name:'Original'});return addSequenceClip(tl,'audio','sound',{len:60,...options});};
const inputs=samples=>new Map([['sound',{async getPrimaryAudioTrack(){return {id:'sound',samples};}}]]);
const compare=(actual,expected)=>{assert.equal(actual.length,expected.length);let maximum=0;for(let i=0;i<actual.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));assert.ok(maximum<1e-6,`waveform difference ${maximum}`);};
async function withContext(run){const saved=globalThis.OfflineAudioContext;globalThis.OfflineAudioContext=Context;try{await run();}finally{if(saved===undefined)delete globalThis.OfflineAudioContext;else globalThis.OfflineAudioContext=saved;}}
test('bounded mixing decodes intersecting source audio and continues original fade envelopes sample for sample',()=>withContext(async()=>{
    const tl=fixture({fadeIn:45,fadeOut:45,volume:.5}),samples=Float32Array.from({length:3*SAMPLE_RATE},(_,i)=>.4*Math.sin(i/9));
    const full=await mixAudio(tl,inputs(samples),2*SAMPLE_RATE,signal(),{BufferSink:Sink});Sink.requests=[];
    const window=await mixAudio(tl,inputs(samples),SAMPLE_RATE,signal(),{startFrame:15,endFrame:45,BufferSink:Sink});
    compare(window.getChannelData(0),full.getChannelData(0).subarray(SAMPLE_RATE/2,SAMPLE_RATE*1.5));assert.deepEqual(Sink.requests,[['sound',.5,1.5]]);
}));
test('bounded nonlinear DSP retains reverse mapping and gate attack/release from the original clip start',()=>withContext(async()=>{
    let tl=fixture({audioProcessing:{...AUDIO_DEFAULTS,gateDb:-20,voice:'robot'}});tl=reverseSequenceClip(tl,'audio',tl.audio[0].id);
    const samples=Float32Array.from({length:3*SAMPLE_RATE},(_,i)=>(i<SAMPLE_RATE?.35:.001)*Math.sin(i/9));
    const full=await mixAudio(tl,inputs(samples),2*SAMPLE_RATE,signal(),{BufferSink:Sink});
    const window=await mixAudio(tl,inputs(samples),SAMPLE_RATE,signal(),{startFrame:30,endFrame:60,BufferSink:Sink});
    compare(window.getChannelData(0),full.getChannelData(0).subarray(SAMPLE_RATE,2*SAMPLE_RATE));
}));
test('stateful filters retain their original preroll, while long dry sources allocate only selected output',()=>withContext(async()=>{
    const samples=new Float32Array(3*SAMPLE_RATE).fill(.1),filtered=fixture({eq:{low:3,mid:0,high:0}});
    await mixAudio(filtered,inputs(samples),SAMPLE_RATE,signal(),{startFrame:30,endFrame:60,BufferSink:Sink});assert.equal(Context.all.at(-1).length,2*SAMPLE_RATE,'filter state must begin at original clip start');
    const long={...fixture({}),media:{sound:{...fixture({}).media.sound,frames:18000}},audio:[{...fixture({}).audio[0],len:18000}]};
    await mixAudio(long,inputs(new Float32Array(501*SAMPLE_RATE).fill(.1)),SAMPLE_RATE,signal(),{startFrame:15000,endFrame:15030,BufferSink:Sink});assert.equal(Context.all.at(-1).length,SAMPLE_RATE);
}));
test('full foundation mixing remains compatible, cancellation and invalid windows refuse',()=>withContext(async()=>{
    const tl=fixture({}),samples=new Float32Array(3*SAMPLE_RATE).fill(.1),legacy={schemaVersion:2,fps:30,seq:tl.seq,aspect:tl.aspect,media:tl.media,video:[],audio:tl.audio.map(({trackId,...clip})=>clip),text:[]};
    const full=await mixAudio(legacy,inputs(samples),2*SAMPLE_RATE,signal(),{BufferSink:Sink});assert.ok(full.getChannelData(0)[SAMPLE_RATE]>.09);
    const aborted=new AbortController();aborted.abort();await assert.rejects(mixAudio(tl,inputs(samples),SAMPLE_RATE,aborted.signal,{startFrame:0,endFrame:30,BufferSink:Sink}),{name:'AbortError'});
    await assert.rejects(mixAudio(tl,inputs(samples),SAMPLE_RATE,signal(),{startFrame:.5,endFrame:30,BufferSink:Sink}),/sample-aligned/);
    await assert.rejects(mixAudio(tl,inputs(samples),SAMPLE_RATE,signal(),{startFrame:0,endFrame:31,BufferSink:Sink}),/sample-aligned/);
}));
const transitionFixture=(frames,rate=1)=>{
    let tl=emptySequence();for(const [id,count] of [['outgoing',frames],['incoming',60]])tl=addSequenceMedia(tl,{id,kind:'video',frames:count,width:640,height:360,name:id,hasAudio:true});
    tl=addSequenceClip(tl,'video','outgoing',{len:30,rate});return addSequenceClip(tl,'video','incoming',{start:30,len:30,transition:30});
};
test('actual recognition mixing skips an exhausted outgoing source without its blob or a zero-length decode',()=>withContext(async()=>{
    const tl=transitionFixture(30),samples=new Float32Array(2*SAMPLE_RATE).fill(.2),created=[],disposed=[];
    class Input {constructor({source}){this.id=source.blob.id;created.push(this.id);}async getPrimaryAudioTrack(){return {id:this.id,samples};}dispose(){disposed.push(this.id);}}
    const blob=new Blob(['original incoming source']);blob.id='incoming';Sink.requests=[];
    const pcm=await timelineSpeechPCM(tl,new Map([['incoming',blob]]),{startFrame:45,endFrame:60,audioRuntime:{Input,BlobSource:class {constructor(blob){this.blob=blob;}},ALL_FORMATS:[],mixAudio:(...args)=>mixAudio(...args.slice(0,4),{...args[4],BufferSink:Sink})}});
    assert.deepEqual(created,['incoming']);assert.deepEqual(disposed,['incoming']);assert.deepEqual(Sink.requests,[['incoming',.5,1]]);assert.equal(pcm.length,8000);
    assert.ok(Math.abs(pcm[100]-.10125)<.001,'the incoming fade must continue from its original midpoint');assert.ok(pcm.at(-100)>.198);
}));
test('available source tails keep crossfades, and rate-limited tails stop before decoding a later range',()=>withContext(async()=>{
    const samples=new Float32Array(3*SAMPLE_RATE).fill(.2),tl=transitionFixture(60),both=new Map(['outgoing','incoming'].map(id=>[id,{async getPrimaryAudioTrack(){return {id,samples};}}]));
    const full=await mixAudio(tl,both,2*SAMPLE_RATE,signal(),{BufferSink:Sink});Sink.requests=[];
    const selected=await mixAudio(tl,both,SAMPLE_RATE/2,signal(),{startFrame:45,endFrame:60,BufferSink:Sink});
    compare(selected.getChannelData(0),full.getChannelData(0).subarray(SAMPLE_RATE*1.5,2*SAMPLE_RATE));assert.deepEqual(Sink.requests,[['outgoing',1.5,2],['incoming',.5,1]]);
    const faster=transitionFixture(90,2),ids=speechSelection(faster,{startFrame:45,endFrame:60}).mediaIds;Sink.requests=[];
    await mixAudio(faster,new Map(ids.map(id=>[id,both.get(id)])),SAMPLE_RATE/2,signal(),{startFrame:45,endFrame:60,BufferSink:Sink});assert.deepEqual(Sink.requests,[['incoming',.5,1]]);
}));
