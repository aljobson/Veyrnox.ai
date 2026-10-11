import test from 'node:test';
import assert from 'node:assert/strict';
import { recognizeSpeechPCM, localSpeechAvailable } from '../app/veyrnox/_lib/editorSpeechRecognition.mjs';
import { LOCAL_SPEECH_WORKER_URL, LOCAL_SPEECH_ASSET_PATH, localSpeechWorkerPolicy } from '../app/veyrnox/_lib/localSpeechAssets.mjs';
class WorkerProbe {
    static all = [];
    constructor(url,options) { this.url=url;this.options=options;this.terminated=0;WorkerProbe.all.push(this); }
    postMessage(message,transfer) { this.message=message;this.transfer=transfer; }
    terminate() { this.terminated++; }
    emit(data) { this.onmessage({data}); }
}
const audio = () => Float32Array.from({length:16000},(_,i)=>Math.sin(i/8)*.2);
test('local recognition transfers bounded PCM and imports actual word timestamps only after complete result',async()=>{
    const progress=[],pcm=audio(), promise=recognizeSpeechPCM(pcm,{WorkerClass:WorkerProbe,onProgress:p=>progress.push(p)}),worker=WorkerProbe.all.at(-1);
    assert.equal(worker.url,LOCAL_SPEECH_WORKER_URL);assert.equal(worker.options.type,'module');
    assert.deepEqual(Object.keys(worker.message).sort(),['audio','language']);assert.equal(worker.message.audio.byteLength,64000);assert.equal(worker.transfer[0],worker.message.audio);
    worker.emit({stage:'recognition'});assert.equal(progress.at(-1).stage,'recognition');
    worker.emit({stage:'result',result:{text:'Hello world.',chunks:[{text:' Hello',timestamp:[.1,.4]},{text:' world.',timestamp:[.4,.9]}]}});
    const cues=await promise;assert.equal(cues[0].start,3);assert.equal(cues[0].wordsEstimated,false);assert.equal(cues[0].words[0].len,9);assert.equal(worker.terminated,1);
});
test('cancellation terminates the isolated runtime and cannot return late captions',async()=>{
    const abort=new AbortController(),promise=recognizeSpeechPCM(audio(),{WorkerClass:WorkerProbe,signal:abort.signal}),worker=WorkerProbe.all.at(-1);
    abort.abort();worker.emit({stage:'result',result:{text:'late',chunks:[{text:'late',timestamp:[0,.5]}]}});
    await assert.rejects(promise,{name:'AbortError'});assert.equal(worker.terminated,1);
});
test('silence and invalid audio never start inference; missing real timings reject without partial cues',async()=>{
    const before=WorkerProbe.all.length;
    await assert.rejects(recognizeSpeechPCM(new Float32Array(16000),{WorkerClass:WorkerProbe}),/silent/);
    await assert.rejects(recognizeSpeechPCM(new Float32Array([NaN]),{WorkerClass:WorkerProbe}),/valid decoded/);
    assert.equal(WorkerProbe.all.length,before);
    const promise=recognizeSpeechPCM(audio(),{WorkerClass:WorkerProbe}),worker=WorkerProbe.all.at(-1);
    worker.emit({stage:'result',result:{text:'no timings',chunks:[{text:'no timings',timestamp:[0,null]}]}});
    await assert.rejects(promise,/word timings/);assert.equal(worker.terminated,1);
});
test('runtime failures release the Worker and its policy permits WASM only inside the fixed same-origin prefix',async()=>{
    const promise=recognizeSpeechPCM(audio(),{WorkerClass:WorkerProbe}),worker=WorkerProbe.all.at(-1);worker.onerror();await assert.rejects(promise,/could not run/);assert.equal(worker.terminated,1);
    assert.equal(localSpeechAvailable({Worker:WorkerProbe,WebAssembly:{validate(){}},crypto:{subtle:{digest(){}}}}),true);assert.equal(localSpeechAvailable({}),false);
    const policy=localSpeechWorkerPolicy('https://veyrnox.ai');
    assert.equal(policy,`default-src 'none'; script-src https://veyrnox.ai${LOCAL_SPEECH_ASSET_PATH}/ 'wasm-unsafe-eval'; connect-src https://veyrnox.ai${LOCAL_SPEECH_ASSET_PATH}/; worker-src 'none'; base-uri 'none'; object-src 'none'`);
    assert.ok(!policy.includes("'unsafe-eval'"));assert.ok(!policy.includes('blob:'));assert.ok(!policy.includes('https://huggingface.co'));
});
