import test from 'node:test';
import assert from 'node:assert/strict';
import { colourDefaults,colourProblem,adjustColourPixels,curveValue,neutralColour } from '../app/veyrnox/_lib/editorColour.mjs';
import { emptySequence,addSequenceMedia,addSequenceClip,updateSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const pixels=(values,c)=>Array.from(adjustColourPixels(new Uint8ClampedArray(values),c));
test('neutral grading preserves all source bytes including transparent pixels; exposure doubles midtones',()=>{
    const c=colourDefaults(),source=[0,127,255,255,80,90,100,64,0,0,0,0];
    assert.deepEqual(pixels(source,c),source);assert.equal(neutralColour(c),true);
    assert.deepEqual(pixels([40,50,60,64],{...c,exposure:1}),[80,100,120,64]);
});
test('channel curves, HSL and white balance produce independent measurable colour changes',()=>{
    const c=colourDefaults();c.curves.red=[{x:0,y:0},{x:.5,y:.25},{x:1,y:1}];
    assert.equal(curveValue(c.curves.red,.5),.25);assert.deepEqual(pixels([128,128,128,200],c),[65,128,128,200]);
    const warm=pixels([100,100,100,255],{...colourDefaults(),temperature:1});assert.ok(warm[0]>warm[2]);
    const h=colourDefaults();h.hsl.red.hue=120;assert.deepEqual(pixels([255,0,0,180],h),[0,255,0,180]);
    assert.deepEqual(pixels([128,128,128,180],h),[128,128,128,180]);
});
test('advanced grading round-trips through the canonical project document',()=>{
    let tl=addSequenceMedia(emptySequence(),{id:'source',kind:'video',frames:120,name:'clip',width:640,height:360,hasAudio:false});tl=addSequenceClip(tl,'video','source',{len:120});
    const c=colourDefaults();c.exposure=.5;c.curves.master=[{x:0,y:.1},{x:.4,y:.5},{x:1,y:1}];
    tl=updateSequenceClip(tl,'video','v1',{colourAdjustment:c});assert.equal(tl.error,undefined);
    const id='11111111-1111-4111-8111-111111111111',doc=JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),tl)));
    assert.equal(validProjectDocument(doc,id),true);assert.deepEqual(doc.timeline.video[0].colourAdjustment,c);
});
test('malformed, unsorted, excessive and nonfinite colour inputs are refused',()=>{
    const c=colourDefaults();for(const v of [{...c,exposure:Infinity},{...c,extra:true},{...c,hsl:{...c.hsl,red:{hue:181,saturation:0,luminance:0}}},{...c,curves:{...c.curves,master:[{x:0,y:0},{x:.5,y:.5},{x:.4,y:.4},{x:1,y:1}]}},{...c,curves:{...c.curves,blue:[{x:.1,y:0},{x:1,y:1}]}}])assert.notEqual(colourProblem(v),null);
    assert.equal(colourProblem(c),null);
});
