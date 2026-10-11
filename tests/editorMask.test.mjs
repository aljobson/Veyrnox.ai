import test from 'node:test';
import assert from 'node:assert/strict';
import { maskDefaults, maskProblem, evaluatedMask, maskKeyframe } from '../app/veyrnox/_lib/editorMask.mjs';
import { emptySequence, addSequenceMedia, addSequenceClip, updateSequenceClip, splitSequenceClip, trimSequence } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptyProjectDocument, withTimeline, validProjectDocument } from '../lib/projectDocument.js';
const fixture = () => {
    let tl = addSequenceMedia(emptySequence(), {id:'source',kind:'video',frames:900,width:640,height:360,hasAudio:false,name:'mask.mp4'});
    tl = addSequenceClip(tl, 'video', 'source', {len:180});
    return updateSequenceClip(tl, 'video', 'v1', {mask:'circle', maskSettings:{...maskDefaults('circle'),inverted:true,feather:0.1}});
};
test('mask geometry and animated keys survive canonical project save/reopen validation', () => {
    let tl = fixture();
    const clip = tl.video[0], first = maskKeyframe(clip,0), last = {...maskKeyframe(clip,179),x:0.8,rotation:90,feather:0.2,easing:'ease-in-out'};
    tl = updateSequenceClip(tl,'video','v1',{maskKeyframes:[first,last]});
    const id = '11111111-1111-4111-8111-111111111111', doc = withTimeline(emptyProjectDocument(id),tl);
    const reopened = JSON.parse(JSON.stringify(doc));
    assert.equal(validProjectDocument(reopened,id),true);
    assert.equal(reopened.timeline.video[0].maskSettings.inverted,true);
    assert.deepEqual(evaluatedMask(reopened.timeline.video[0],89),evaluatedMask(tl.video[0],89));
});
test('splits and trims preserve nonlinear mask animation at every remaining frame', () => {
    let tl = fixture();
    const initial = tl.video[0], keys=[maskKeyframe(initial,0),{...maskKeyframe(initial,90),x:0.2,easing:'ease-in'},{...maskKeyframe(initial,179),x:0.9,easing:'ease-out'}];
    tl = updateSequenceClip(tl,'video','v1',{maskKeyframes:keys});
    const original = tl.video[0], split = splitSequenceClip(tl,'video','v1',47);
    assert.equal(split.error,undefined);
    for(let f=0; f<split.video[1].len; f++) assert.deepEqual(evaluatedMask(split.video[1],f),evaluatedMask(original,f+47));
    const trimmed = trimSequence(tl,'video','v1','in',25);
    assert.equal(trimmed.error,undefined);
    for(let f=0; f<trimmed.video[0].len; f++) assert.deepEqual(evaluatedMask(trimmed.video[0],f),evaluatedMask(original,f+25));
});
test('malformed and oversized mask input cannot pass the shared client/Worker boundary', () => {
    const tl=fixture(), c=tl.video[0];
    for(const patch of [{maskSettings:{...c.maskSettings,feather:0.3}}, {maskSettings:{...c.maskSettings,inverted:1}}, {maskSettings:{...c.maskSettings,width:Infinity}}, {maskKeyframes:Array.from({length:41},(_,frame)=>maskKeyframe(c,frame))}, {maskKeyframes:[maskKeyframe(c,10),maskKeyframe(c,0)]}]) {
        assert.notEqual(maskProblem({...c,...patch}),null);
        assert.notEqual(validateSequence({...tl,video:[{...c,...patch}]}),null);
    }
    assert.equal(maskProblem(c),null);
});
test('legacy directional masks retain their original upper or left half', () => {
    assert.equal(maskDefaults('horizontal').height,0.5);
    assert.equal(maskDefaults('horizontal').y,0.25);
    assert.equal(maskDefaults('vertical').width,0.5);
    assert.equal(maskDefaults('vertical').x,0.25);
});
