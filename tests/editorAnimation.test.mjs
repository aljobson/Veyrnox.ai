import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence,addSequenceMedia,addSequenceClip,updateSequenceClip,splitSequenceClip,trimSequence } from '../app/veyrnox/_lib/editorSequence.mjs';
import { cutSequenceRange } from '../app/veyrnox/_lib/editorCaptions.mjs';
import { evaluatedTransform,evaluatedParameters,parameterKeyframe,motionPreset } from '../app/veyrnox/_lib/editorAnimation.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const fixture=()=>addSequenceClip(addSequenceMedia(emptySequence(),{id:'source',kind:'video',frames:300,name:'Source',hasAudio:true,width:640,height:360}),'video','source',{len:120});
const ok=t=>{assert.equal(t.error,undefined);return t;};
const near=(a,b)=>{for(const k of Object.keys(a))assert.ok(typeof a[k]!=='number'?a[k]===b[k]:Math.abs(a[k]-b[k])<1e-10,`${k}: ${a[k]} != ${b[k]}`);};
const animated=()=>{const t=fixture(),c=t.video[0],keys=motionPreset(c,'arc'),p0=parameterKeyframe(c,0),p1={...p0,frame:119,brightness:.4,exposure:-1,blur:8,easing:'ease-in-out'};return ok(updateSequenceClip(t,'video','v1',{keyframes:keys,parameterKeyframes:[p0,p1],animation:{in:'fade',out:'zoom',duration:15,combo:'drift',period:45,amount:.8}}));};
test('split and trim retain nonlinear motion, combo phase, animated colour and blur at every surviving frame',()=>{
    const tl=animated(),original=tl.video[0],split=ok(splitSequenceClip(tl,'video','v1',53)),trim=ok(trimSequence(tl,'video','v1','in',37));
    for(const c of split.video)for(let i=0;i<c.len;i++){near(evaluatedTransform(c,i),evaluatedTransform(original,c.start+i));near(evaluatedParameters(c,i).filter,evaluatedParameters(original,c.start+i).filter);assert.equal(evaluatedParameters(c,i).colour.exposure,evaluatedParameters(original,c.start+i).colour.exposure);}
    for(let i=0;i<trim.video[0].len;i++)near(evaluatedTransform(trim.video[0],i),evaluatedTransform(original,37+i));
    assert.ok(split.video[1].keyframes[0].frame<0);
});
test('transcript cut retains animation source time across both surviving pieces',()=>{
    const tl=animated(),cut=ok(cutSequenceRange(tl,35,65));
    for(const c of cut.video)for(let i=0;i<c.len;i++){const source=c.start+i+(c.start>=35?30:0);near(evaluatedTransform(c,i),evaluatedTransform(tl.video[0],source));near(evaluatedParameters(c,i).filter,evaluatedParameters(tl.video[0],source).filter);}
});
test('motion, combo and animated parameters round-trip; oversized or malformed animation fails',()=>{
    const tl=animated(),id='11111111-1111-4111-8111-111111111111';assert.equal(validProjectDocument(JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),tl))),id),true);
    for(const patch of [{animation:{in:'none',out:'none',duration:15,combo:'unknown'}},{animation:{in:'none',out:'none',duration:15,period:0}},{parameterKeyframes:[{...parameterKeyframe(tl.video[0],0),exposure:4}]},{parameterKeyframes:Array.from({length:41},(_,frame)=>parameterKeyframe(tl.video[0],frame))},{keyframes:[{...tl.video[0].keyframes[0],frame:-18001}]}])assert.ok(updateSequenceClip(tl,'video','v1',patch).error);
    assert.equal(motionPreset(tl.video[0],'push-in').length,2);
});
