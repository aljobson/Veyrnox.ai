import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence,addSequenceMedia,addSequenceClip,addSequenceText,updateSequenceClip,updateSequenceTrack,splitSequenceClip,trimSequence } from '../app/veyrnox/_lib/editorSequence.mjs';
import { cutSequenceRange } from '../app/veyrnox/_lib/editorCaptions.mjs';
import { ANIMATIONS,evaluatedReveal,evaluatedTransform,motionPreset } from '../app/veyrnox/_lib/editorAnimation.mjs';
import { ANIMATION_CATALOG,searchAnimations,applyAnimationCatalog } from '../app/veyrnox/_lib/editorAnimationCatalog.mjs';
import { paintSequence,paintStyledText } from '../app/veyrnox/_lib/editorSequenceRender.mjs';
import { validateSequence,TEXT_DEFAULTS } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { TEXT_EXTRAS } from '../app/veyrnox/_lib/editorTextStyle.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const directions=['wipe-left','wipe-right','wipe-up','wipe-down'],full={x:0,y:0,width:1,height:1};
const fixture=()=>addSequenceText(addSequenceClip(addSequenceMedia(emptySequence(),{id:'source',kind:'video',frames:300,name:'Original',width:640,height:360,hasAudio:true}),'video','source',{len:120}),{text:'Original title',start:0,len:120});
const selected={track:'video',id:'v1'},title={track:'text',id:'t2'};
const ok=tl=>{assert.equal(tl.error,undefined);assert.equal(validateSequence(tl),null);return tl;};
const animation=(name,mode='in')=>({in:'none',out:'none',duration:30,[mode]:name});
const near=(a,b)=>{for(const key of Object.keys(a))assert.ok(Math.abs(a[key]-b[key])<1e-10,`${key}: ${a[key]} != ${b[key]}`);};
test('four searchable wipe directions are actual supported In/Out recipes, never loop labels',()=>{
    assert.deepEqual(searchAnimations('in','wipe').map(item=>item.id),directions);assert.deepEqual(searchAnimations('out','wipe').map(item=>item.id),directions);assert.equal(searchAnimations('loop','wipe').length,0);
    for(const id of directions){assert.ok(ANIMATIONS.includes(id));assert.ok(ANIMATION_CATALOG.find(item=>item.id===id));}
});
test('analytic wipes have exact local bounds at endpoints and half-duration, independent of render order',()=>{
    const base=fixture().video[0];
    for(const name of directions) {
        const incoming={...base,animation:animation(name)},outgoing={...base,animation:animation(name,'out')};
        assert.deepEqual(evaluatedReveal(incoming,30),full);assert.deepEqual(evaluatedReveal(outgoing,89),full);
        assert.equal(name==='wipe-left'||name==='wipe-right'?evaluatedReveal(incoming,0).width:evaluatedReveal(incoming,0).height,0);
        const half=evaluatedReveal(incoming,15);assert.deepEqual(evaluatedReveal(outgoing,104),half);
        assert.deepEqual(half,name==='wipe-left'?{x:0,y:0,width:.5,height:1}:name==='wipe-right'?{x:.5,y:0,width:.5,height:1}:name==='wipe-up'?{x:0,y:0,width:1,height:.5}:{x:0,y:.5,width:1,height:.5});
        for(const frame of [15,3,29,0,17,15]){assert.deepEqual(evaluatedReveal(incoming,frame),evaluatedReveal(incoming,frame));const r=evaluatedReveal(incoming,frame);assert.ok(r.x>=0&&r.y>=0&&r.width>=0&&r.height>=0&&r.x+r.width<=1&&r.y+r.height<=1);}
        assert.deepEqual(evaluatedReveal(incoming,0,false),full);assert.deepEqual(evaluatedTransform(incoming,15),evaluatedTransform(base,15));
    }
});
test('overlapping In/Out reveals intersect instead of overriding each other',()=>{
    const clip={len:31,animation:{in:'wipe-left',out:'wipe-right',duration:30}};
    assert.deepEqual(evaluatedReveal(clip,15),{x:.5,y:0,width:0,height:1});
    const perpendicular={...clip,animation:{...clip.animation,out:'wipe-down'}};assert.deepEqual(evaluatedReveal(perpendicular,15),{x:0,y:.5,width:.5,height:.5});
});
test('all video and title wipes retain original phase across split, trim and ripple cuts',()=>{
    for(const name of directions)for(const kind of ['video','text']) {
        let tl=fixture(),id=kind==='video'?'v1':'t2';tl=ok(updateSequenceClip(tl,kind,id,{keyframes:motionPreset(tl[kind][0],'arc'),animation:{in:name,out:name,duration:30,combo:'wobble',period:45,amount:.7}}));
        const original=tl[kind][0],split=ok(splitSequenceClip(tl,kind,id,17)),trim=ok(trimSequence(tl,kind,id,'in',13)),cut=ok(cutSequenceRange(tl,15,28));
        for(const clip of split[kind])for(let frame=0;frame<clip.len;frame++)near(evaluatedReveal(clip,frame),evaluatedReveal(original,clip.start+frame));
        for(let frame=0;frame<trim[kind][0].len;frame++)near(evaluatedReveal(trim[kind][0],frame),evaluatedReveal(original,frame+13));
        for(const clip of cut[kind])for(let frame=0;frame<clip.len;frame++)near(evaluatedReveal(clip,frame),evaluatedReveal(original,clip.start+frame+(clip.start>=15?13:0)));
    }
});
test('catalog apply keeps the other animation channels and source input; locks and invalid names refuse atomically',()=>{
    let tl=fixture();tl=ok(updateSequenceClip(tl,'video','v1',{animation:{in:'fade',out:'spin',duration:30,combo:'wobble',period:45,amount:.7},keyframes:motionPreset(tl.video[0],'arc')}));
    const before=JSON.stringify(tl),next=ok(applyAnimationCatalog(tl,selected,'in','wipe-right',{duration:30}));assert.equal(next.video[0].animation.out,'spin');assert.equal(next.video[0].animation.combo,'wobble');assert.equal(next.video[0].keyframes,tl.video[0].keyframes);assert.equal(JSON.stringify(tl),before);
    assert.match(applyAnimationCatalog(updateSequenceTrack(tl,'video-0',{locked:true}),selected,'in','wipe-left').error,/Unlock/);
    for(const [mode,id,options] of [['loop','wipe-left',{}],['in','wipe-diagonal',{}],['out','wipe-up',{duration:0}]])assert.ok(applyAnimationCatalog(tl,selected,mode,id,options).error);
    const id='11111111-1111-4111-8111-111111111111',saved=JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),ok(applyAnimationCatalog(next,title,'out','wipe-down',{duration:30})))));
    assert.equal(validProjectDocument(saved,id),true);assert.equal(saved.timeline.video[0].animation.in,'wipe-right');assert.equal(saved.timeline.text[0].animation.out,'wipe-down');assert.equal(Object.hasOwn(saved.timeline.video[0],'reveal'),false);
});
// A scoped canvas scheduling probe records real compositor clipping and state restoration, without pretending to be a browser rasterizer.
function context() {const calls=[],stack=[];let path=null,clipping=null;return {calls,save(){stack.push(clipping&&[...clipping]);},restore(){clipping=stack.pop();},beginPath(){path=null;},rect(...args){path=args;calls.push(['rect',...args]);},clip(){if(clipping){const left=Math.max(path[0],clipping[0]),top=Math.max(path[1],clipping[1]),right=Math.min(path[0]+path[2],clipping[0]+clipping[2]),bottom=Math.min(path[1]+path[3],clipping[1]+clipping[3]);clipping=[left,top,Math.max(0,right-left),Math.max(0,bottom-top)];}else clipping=[...path];calls.push(['clip']);},fillRect(...args){calls.push(['fillRect',clipping&&[...clipping],...args]);},translate(...args){calls.push(['translate',...args]);},rotate(){},scale(){},drawImage(){calls.push(['picture',clipping&&[...clipping]]);},measureText(text){return {width:text.length*8,actualBoundingBoxAscent:10,actualBoundingBoxDescent:3};},strokeText(){calls.push(['stroke',clipping&&[...clipping]]);},fillText(){calls.push(['text',clipping&&[...clipping]]);}};}
test('video wipe clips the transformed picture and backdrop, with no clipping leaked to the next clip',()=>{
    const tl=fixture(),wipe={...tl.video[0],animation:animation('wipe-right'),background:{type:'solid',color:'#ff0000',blur:0,mediaId:''}},plain=tl.video[0],g=context();
    paintSequence(g,640,360,{background:'#000000',visuals:[{clip:wipe,offset:15},{clip:plain,offset:15}],texts:[]},{visuals:[{width:640,height:360},{width:640,height:360}]});
    assert.deepEqual(g.calls.filter(c=>c[0]==='rect'),[['rect',320,0,320,360],['rect',0,-180,320,360]]);
    assert.deepEqual(g.calls.find(c=>c[0]==='fillRect'&&c[1]),['fillRect',[320,0,320,360],0,0,640,360]);
    assert.deepEqual(g.calls.filter(c=>c[0]==='picture'),[['picture',[0,-180,320,360]],['picture',null]]);
});
test('wipe clipping intersects an existing transition wipe and does not replace it',()=>{
    const tl=fixture(),g=context();paintSequence(g,640,360,{background:'#000000',visuals:[{clip:{...tl.video[0],animation:animation('wipe-right')},offset:15,wipe:.75}],texts:[]},{visuals:[{width:640,height:360}]});
    assert.deepEqual(g.calls.find(c=>c[0]==='picture'),['picture',[0,-180,160,360]]);
});
test('styled multiline titles and timed word highlights share the same reveal clip',()=>{
    const tl=fixture(),g=context(),item={...tl.text[0],text:'Original\ntitle',style:{...TEXT_DEFAULTS,...TEXT_EXTRAS,backgroundOpacity:.8,shadowOpacity:.5,shadowBlur:4,shadowX:2,shadowY:2},animation:animation('wipe-left'),offset:15};
    paintStyledText(g,640,360,item);const reveal=g.calls.find(c=>c[0]==='rect');assert.ok(reveal[3]>0&&reveal[4]>0);assert.equal(reveal[1],-40);assert.equal(reveal[3],40.5);
    const rendered=g.calls.filter(c=>['text','stroke'].includes(c[0]));assert.equal(rendered.length,4);for(const call of rendered)assert.deepEqual(call[1],reveal.slice(1));
    const cue=context(),wordItem={...tl.text[0],text:'Original title',caption:true,words:[{text:'Original',start:0,len:30},{text:'title',start:30,len:30}],wordsEstimated:false,animation:animation('wipe-right'),offset:15};paintStyledText(cue,640,360,wordItem);
    assert.ok(cue.calls.filter(c=>c[0]==='clip').length>=2,'timed word highlights must intersect the wipe clip');assert.ok(cue.calls.filter(c=>c[0]==='text').every(c=>c[1]));
});
test('unchanged recipes use the old un-clipped picture/title path',()=>{
    const tl=fixture(),picture=context(),text=context();paintSequence(picture,640,360,{background:'#000000',visuals:[{clip:tl.video[0],offset:15}],texts:[]},{visuals:[{width:640,height:360}]});paintStyledText(text,640,360,{...tl.text[0],offset:15});
    assert.equal(picture.calls.some(c=>c[0]==='clip'),false);assert.equal(text.calls.some(c=>c[0]==='clip'),false);
});
