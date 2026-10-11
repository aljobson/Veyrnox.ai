import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFrame,sourceAdvance,remapAudio,speedProblem,SPEED_PRESETS } from '../app/veyrnox/_lib/editorSpeed.mjs';
import { emptySequence,addSequenceMedia,addSequenceClip,setSequenceSpeedCurve,reverseSequenceClip,insertSequenceFreeze,splitSequenceClip,trimSequence,setSequenceRate,extractSequenceAudio } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const ok=v=>{assert.equal(v.error,undefined);assert.equal(validateSequence(v),null);return v;};
const fixture=()=>ok(addSequenceClip(ok(addSequenceMedia(emptySequence(),{id:'source',kind:'video',frames:300,name:'speed.mp4',width:640,height:360,hasAudio:true})),'video','source',{len:120}));
test('rate ramps integrate exactly and split/trim keep every surviving source frame aligned',()=>{
    let tl=ok(setSequenceSpeedCurve(fixture(),'video','v1',SPEED_PRESETS.accelerate)),c=tl.video[0];
    assert.equal(c.len,96);assert.ok(Math.abs(sourceAdvance(c,96)-120)<1e-9);
    const split=ok(splitSequenceClip(tl,'video','v1',37));for(let f=0;f<split.video[1].len;f++)assert.ok(Math.abs(sourceFrame(split.video[1],f)-sourceFrame(c,f+37))<1e-8);
    const trim=ok(trimSequence(tl,'video','v1','in',17));for(let f=0;f<trim.video[0].len;f++)assert.ok(Math.abs(sourceFrame(trim.video[0],f)-sourceFrame(c,f+17))<1e-8);
});
test('reverse is an exact temporal reflection including a ramp; extraction and rate reset preserve it',()=>{
    const ramp=ok(setSequenceSpeedCurve(fixture(),'video','v1',SPEED_PRESETS.smooth)),c=ramp.video[0],reversed=ok(reverseSequenceClip(ramp,'video','v1'));
    for(let f=0;f<c.len;f++)assert.ok(Math.abs(sourceFrame(reversed.video[0],f)-sourceFrame(c,c.len-1-f))<1e-8);
    const twice=ok(reverseSequenceClip(reversed,'video','v1'));for(let f=0;f<c.len;f++)assert.ok(Math.abs(sourceFrame(twice.video[0],f)-sourceFrame(c,f))<1e-8);
    const extracted=ok(extractSequenceAudio(reversed,'v1'));assert.equal(extracted.audio[0].reverse,true);assert.deepEqual(extracted.audio[0].speedCurve,reversed.video[0].speedCurve);
    const constant=ok(setSequenceRate(reversed,'video','v1',.5));assert.equal(constant.video[0].speedCurve.length,0);
});
test('a freeze inserts a silent hold and shifts the remainder without changing its source',()=>{
    const tl=ok(insertSequenceFreeze(fixture(),'v1',30)),hold=tl.video.find(c=>c.freezeFrame!==undefined),tail=tl.video.find(c=>c.start===90);
    assert.equal(hold.len,60);assert.equal(hold.volume,0);assert.equal(sourceFrame(hold,0),30);assert.equal(sourceFrame(hold,59),30);assert.equal(tail.in,30);assert.equal(tl.video.length,3);
});
test('ramp and reverse PCM samples use the picture time mapping across decoded chunks',()=>{
    const chunks=[{timestamp:0,sampleRate:30,channels:[Float32Array.from({length:5},(_,i)=>i)]},{timestamp:5/30,sampleRate:30,channels:[Float32Array.from({length:5},(_,i)=>i+5)]}];
    const clip={in:0,len:5,speedCurve:[{frame:0,rate:1},{frame:4,rate:2}]};
    const mapped=remapAudio(chunks,clip,5,30)[0];for(let n=0;n<5;n++)assert.ok(Math.abs(mapped[n]-sourceFrame(clip,n))<1e-6);
    assert.deepEqual(Array.from(remapAudio(chunks,{in:9,len:10,reverse:true},10,30)[0]),[9,8,7,6,5,4,3,2,1,0]);
});
test('speed state persists; unbounded or malformed source mapping is rejected',()=>{
    const tl=ok(reverseSequenceClip(ok(setSequenceSpeedCurve(fixture(),'video','v1',SPEED_PRESETS.pulse)),'video','v1')),id='11111111-1111-4111-8111-111111111111';
    assert.equal(validProjectDocument(JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),tl))),id),true);
    for(const c of [{reverse:1},{speedCurve:[{frame:0,rate:0},{frame:30,rate:1}]},{speedCurve:[{frame:0,rate:1},{frame:0,rate:2}]},{freezeFrame:Infinity}])assert.notEqual(speedProblem(c),null);
    assert.match(setSequenceSpeedCurve(fixture(),'video','v1',[{position:0,rate:1},{position:0,rate:2}]).error,/ordered/);
});
