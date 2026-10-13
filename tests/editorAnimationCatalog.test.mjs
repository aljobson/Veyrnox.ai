import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence,addSequenceMedia,addSequenceClip,addSequenceText,updateSequenceClip,updateSequenceTrack,splitSequenceClip,trimSequence } from '../app/veyrnox/_lib/editorSequence.mjs';
import { cutSequenceRange } from '../app/veyrnox/_lib/editorCaptions.mjs';
import { ANIMATIONS,COMBOS,evaluatedTransform,motionPreset } from '../app/veyrnox/_lib/editorAnimation.mjs';
import { ANIMATION_CATALOG,LOOP_CATALOG,searchAnimations,animationSelectionProblem,applyAnimationCatalog,resetAnimationCatalog } from '../app/veyrnox/_lib/editorAnimationCatalog.mjs';
import { paintSequence,paintStyledText } from '../app/veyrnox/_lib/editorSequenceRender.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const fixture=()=>addSequenceText(addSequenceClip(addSequenceMedia(emptySequence(),{id:'source',kind:'video',frames:300,name:'Original',width:640,height:360,hasAudio:true}),'video','source',{len:120}),{text:'Original title',start:0,len:120});
const selection={track:'video',id:'v1'}, title={track:'text',id:'t2'};
const ok=tl=>{assert.equal(tl.error,undefined);assert.equal(validateSequence(tl),null);return tl;};
const near=(actual,expected)=>{for(const key of Object.keys(actual))assert.ok(typeof actual[key]!=='number'?actual[key]===expected[key]:Math.abs(actual[key]-expected[key])<1e-10,`${key}: ${actual[key]} != ${expected[key]}`);};
test('every catalog item maps to a real supported recipe; searches require all terms',()=>{
    assert.deepEqual(ANIMATION_CATALOG.map(item=>item.id),ANIMATIONS);assert.deepEqual(LOOP_CATALOG.map(item=>item.id),COMBOS);
    assert.deepEqual(searchAnimations('in','half turn').map(item=>item.id),['spin']);assert.deepEqual(searchAnimations('loop','GENTLY SIDE').map(item=>item.id),['sway']);assert.equal(searchAnimations('out','missing movement').length,0);
    assert.equal(Object.isFrozen(ANIMATION_CATALOG),true);assert.equal(Object.isFrozen(ANIMATION_CATALOG[0]),true);
});
test('new entrance and exit transforms reach declared endpoints and remain finite throughout',()=>{
    const clip=fixture().video[0], base=evaluatedTransform(clip,0,false);
    for(const name of ['slide-right','slide-down','spin','bounce']) {
        const incoming={...clip,animation:{in:name,out:'none',duration:30}},outgoing={...clip,animation:{in:'none',out:name,duration:30}};
        near(evaluatedTransform(incoming,30),base);near(evaluatedTransform(outgoing,89),base);
        const first=evaluatedTransform(incoming,0),last=evaluatedTransform(outgoing,119);
        if(name==='slide-right'){assert.equal(first.x,base.x+1);assert.equal(last.x,base.x-1);}
        if(name==='slide-down'){assert.equal(first.y,base.y+1);assert.equal(last.y,base.y+1);}
        if(name==='spin'){assert.equal(first.rotation,base.rotation-180);assert.equal(last.rotation,base.rotation+180);assert.equal(first.opacity,0);assert.equal(last.opacity,0);}
        if(name==='bounce'){assert.equal(first.y,base.y+.35);assert.equal(last.y,base.y-.35);assert.ok(evaluatedTransform(incoming,10).y<base.y,'bounce must overshoot before settling');}
        for(let frame=0;frame<120;frame++)for(const value of Object.values(evaluatedTransform(incoming,frame)))if(typeof value==='number')assert.ok(Number.isFinite(value));
    }
});
test('new loops are frame-deterministic, periodic and leave exact original transform at zero strength',()=>{
    const clip=fixture().video[0],base=evaluatedTransform(clip,0,false);
    for(const combo of ['sway','wobble','bounce']) {
        const active={...clip,animation:{in:'none',out:'none',duration:15,combo,period:60,amount:.8}},zero={...active,animation:{...active.animation,amount:0}};
        for(const frame of [0,7,15,31,54]){near(evaluatedTransform(active,frame+60),evaluatedTransform(active,frame));assert.deepEqual(evaluatedTransform(active,frame),evaluatedTransform(active,frame));assert.deepEqual(evaluatedTransform(zero,frame),base);}
        assert.notDeepEqual(evaluatedTransform(active,15),base);
    }
});
test('split, trim and ripple retain every new animation and loop at all surviving frames',()=>{
    for(const name of ['slide-right','slide-down','spin','bounce'])for(const combo of ['sway','wobble','bounce']) {
        let tl=fixture();tl=ok(updateSequenceClip(tl,'video','v1',{keyframes:motionPreset(tl.video[0],'arc'),animation:{in:name,out:name,duration:30,combo,period:45,amount:.7}}));
        const original=tl.video[0],split=ok(splitSequenceClip(tl,'video','v1',47)),trim=ok(trimSequence(tl,'video','v1','in',19)),cut=ok(cutSequenceRange(tl,35,65));
        for(const clip of split.video)for(let frame=0;frame<clip.len;frame++)near(evaluatedTransform(clip,frame),evaluatedTransform(original,clip.start+frame));
        for(let frame=0;frame<trim.video[0].len;frame++)near(evaluatedTransform(trim.video[0],frame),evaluatedTransform(original,frame+19));
        for(const clip of cut.video)for(let frame=0;frame<clip.len;frame++)near(evaluatedTransform(clip,frame),evaluatedTransform(original,clip.start+frame+(clip.start>=35?30:0)));
    }
});
test('catalog apply preserves other channels, keyframes and existing trim phase; restart is explicit',()=>{
    let tl=fixture();tl=ok(updateSequenceClip(tl,'video','v1',{keyframes:motionPreset(tl.video[0],'arc'),animation:{in:'slide-right',out:'spin',duration:15,combo:'wobble',period:45,amount:.7}}));
    tl=ok(trimSequence(tl,'video','v1','in',20));const before=JSON.stringify(tl),original=tl.video[0];
    const next=ok(applyAnimationCatalog(tl,selection,'in','bounce',{duration:30})),a=next.video[0].animation;
    assert.equal(a.out,'spin');assert.equal(a.combo,'wobble');assert.equal(a.period,45);assert.equal(a.offset,20);assert.equal(a.span,120);assert.equal(next.video[0].keyframes,original.keyframes);assert.equal(JSON.stringify(tl),before);
    const restarted=ok(applyAnimationCatalog(tl,selection,'loop','sway',{period:90,amount:.2,restart:true})).video[0].animation;
    assert.equal(restarted.in,'slide-right');assert.equal(restarted.out,'spin');assert.equal(restarted.duration,15);assert.equal(restarted.offset,0);assert.equal(restarted.span,100);assert.equal(restarted.period,90);assert.equal(restarted.amount,.2);
    const reset=ok(resetAnimationCatalog(tl,selection));assert.equal(reset.video[0].keyframes,original.keyframes);near(evaluatedTransform(reset.video[0],11),evaluatedTransform(original,11,false));
});
test('titles share recipes, and expanded values survive the canonical saved document',()=>{
    let tl=ok(applyAnimationCatalog(fixture(),title,'in','spin',{duration:20}));tl=ok(applyAnimationCatalog(tl,title,'loop','bounce',{period:45,amount:.8}));
    const id='11111111-1111-4111-8111-111111111111',doc=JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),tl)));
    assert.equal(validProjectDocument(doc,id),true);assert.deepEqual(doc.timeline.text[0].animation,tl.text[0].animation);assert.notEqual(evaluatedTransform(tl.text[0],10).rotation,0);
});
test('locked and stale selection, unknown recipe and malformed resource settings refuse atomically',()=>{
    const tl=fixture(),before=JSON.stringify(tl);assert.match(animationSelectionProblem(tl,{track:'audio',id:'a1'}),/Select/);
    assert.match(applyAnimationCatalog(updateSequenceTrack(tl,'video-0',{locked:true}),selection,'in','spin').error,/Unlock/);
    for(const [selected,mode,id,options] of [[{track:'video',id:'v99'},'in','spin',{}],[selection,'other','spin',{}],[selection,'loop','unknown',{}],[selection,'in','spin',{duration:121}],[selection,'loop','sway',{period:0}],[selection,'loop','wobble',{amount:NaN}],[selection,'in','bounce',{restart:'yes'}]])assert.ok(applyAnimationCatalog(tl,selected,mode,id,options).error);
    assert.equal(JSON.stringify(tl),before);
});
// Probe the real shared compositor calls; browser verification and decoded export remain the parent flow.
const context=()=>{const calls=[];return {calls,save(){},restore(){},fillRect(){},translate(...args){calls.push(['translate',...args]);},rotate(value){calls.push(['rotate',value]);},scale(...args){calls.push(['scale',...args]);},drawImage(){calls.push(['picture',this.globalAlpha]);},measureText(text){return {width:text.length*8};},strokeText(){},fillText(){calls.push(['text',this.globalAlpha]);}};};
test('picture and title compositor paths use the same expanded frame transform',()=>{
    const tl=fixture(),animation={in:'spin',out:'slide-down',duration:30,combo:'wobble',period:60,amount:.8},picture={...tl.video[0],animation},text={...tl.text[0],x:.5,y:.5,animation,offset:15},expected=evaluatedTransform(picture,15);
    const videoContext=context();paintSequence(videoContext,640,360,{background:'#000000',visuals:[{clip:picture,offset:15}],texts:[]},{visuals:[{width:640,height:360}]});
    const textContext=context();paintStyledText(textContext,640,360,text);
    for(const calls of [videoContext.calls,textContext.calls]) {assert.deepEqual(calls.find(call=>call[0]==='translate'),['translate',640*expected.x,360*expected.y]);assert.deepEqual(calls.find(call=>call[0]==='rotate'),['rotate',expected.rotation*Math.PI/180]);}
    assert.equal(videoContext.calls.find(call=>call[0]==='picture')[1],expected.opacity);assert.equal(textContext.calls.find(call=>call[0]==='text')[1],expected.opacity);
});
