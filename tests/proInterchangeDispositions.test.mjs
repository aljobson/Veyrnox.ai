import test from 'node:test';
import assert from 'node:assert/strict';
import {CLIP_KEYS,TEXT_KEYS,MEDIA_KEYS,TRACK_KEYS,MARKER_KEYS,validateSequence,TEXT_DEFAULTS,TRANSFORM_DEFAULTS,FILTER_DEFAULTS} from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import {DISPOSITIONS,disposition,reportDispositions} from '../app/veyrnox/_lib/proInterchangeDispositions.mjs';
import {exportProInterchange} from '../app/veyrnox/_lib/proInterchangeExport.mjs';
import {SMART_PICTURE} from '../app/veyrnox/_lib/editorSmartPicture.mjs';
import {MASK_DEFAULTS,maskKeyframe} from '../app/veyrnox/_lib/editorMask.mjs';
import {AUDIO_DEFAULTS} from '../app/veyrnox/_lib/editorAudioSettings.mjs';
import {AUDIO_EFFECT_DEFAULTS} from '../app/veyrnox/_lib/editorAudioEffects.mjs';
import {colourDefaults} from '../app/veyrnox/_lib/editorColour.mjs';
import {TEXT_EXTRAS} from '../app/veyrnox/_lib/editorTextStyle.mjs';
import {fixture} from './helpers/proInterchange.mjs';

test('every validator allowlisted key has an explicit disposition independent of the table',()=>{
    for(const [kind,keys] of Object.entries({clip:CLIP_KEYS,text:TEXT_KEYS,media:MEDIA_KEYS,track:TRACK_KEYS,marker:MARKER_KEYS})) {
        assert.deepEqual(Object.keys(DISPOSITIONS[kind]).sort(),[...keys].sort());
        for(const key of keys)assert.ok(['convert','approximate','drop'].includes(disposition(kind,key)),`${kind}.${key}`);
    }
});
test('valid nondefault corpus reports every dropped/approximated key, including descendants',()=>{
    const tl=fixture(),c=tl.video[0];
    Object.assign(c,{animation:{in:'fade',out:'zoom',duration:10,combo:'pulse',period:30,amount:.4,offset:2,span:90},keyframes:[{frame:0,x:.3,y:.4,scale:1.2,rotation:10,opacity:.8,easing:'ease-in'}],groupId:'g1',transition:12,fadeIn:5,fadeOut:6,pan:.3,eq:{low:2,mid:1,high:-2},transform:{...TRANSFORM_DEFAULTS,x:.3,flipX:true},filter:{...FILTER_DEFAULTS,blur:2},crop:{x:.1,y:.1,width:.8,height:.8},mask:'circle',maskSettings:{...MASK_DEFAULTS,feather:.2},maskKeyframes:[maskKeyframe({mask:'circle'},0)],colourAdjustment:{...colourDefaults(),exposure:.4},blend:'screen',fit:'cover',effect:{type:'mono',intensity:.5},transitionType:'dip-black',speedCurve:[{frame:0,rate:1},{frame:90,rate:1.5}],background:{type:'solid',color:'#123456',blur:18,mediaId:''},parameterKeyframes:[{frame:0,easing:'linear',brightness:1.5,contrast:1,saturate:1,hue:0,blur:0,exposure:0,temperature:0,tint:0}],preservePitch:true,audioProcessing:{...AUDIO_DEFAULTS,pitch:2},audioEffects:{...AUDIO_EFFECT_DEFAULTS,echoMix:.5},smartPicture:{...SMART_PICTURE,denoise:.5}});
    tl.media.source.folder='Shots';tl.media.source.attribution={credit:'Creator',usage:'Permission',url:'https://example.com'};
    tl.media.sound={id:'sound',kind:'audio',frames:30,name:'Soft impact',sourceName:'impact.wav',width:0,height:0,hasAudio:true,originalAudio:{version:1,presetId:'soft-impact'}};
    tl.folders=['Shots'];tl.background='#123456';
    tl.fonts=[{family:`VXFont_${'a'.repeat(64)}`,name:'Custom',sourceName:'Custom.ttf',sha256:'a'.repeat(64),bytes:100,format:'ttf',rights:{credit:'Author',usage:'Allowed',url:''}}];
    tl.text=[{id:'t3',start:0,len:60,trackId:'text-0',text:'Hello',x:.3,y:.4,size:10,style:{...TEXT_DEFAULTS,...TEXT_EXTRAS,italic:true},caption:true,words:[{text:'Hello',start:0,len:50}],wordStyle:{mode:'karaoke',color:'#123456'},wordsEstimated:true,groupId:'g1',animation:c.animation,keyframes:c.keyframes}];
    assert.equal(validateSequence(tl),null);
    const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e));
    const check=(v,kind,path,key='')=>{
        if(key && disposition(kind,key)!=='convert')assert.ok(e.report.some(r=>r.path===`${path}.${key}`),`${path}.${key}`);
        if(v&&typeof v==='object')for(const [k,child] of Object.entries(v))check(child,kind,path,key?`${key}.${k}`:k);
    };
    check(c,'clip','video.v1');check(tl.text[0],'text','text.t3');
    check(tl.media.source,'media','media.source');check(tl.media.sound,'media','media.sound');
    for(const field of ['folders','fonts','background'])assert.ok(e.report.some(r=>r.path===`sequence.${field}`));
    // Implicit dissolve must report even without a transitionType.
    delete c.transitionType;assert.ok(exportProInterchange(tl).report.some(r=>r.path==='video.v1.transition'));
});
test('nested graphic disposition remains explicit even though export refuses unmaterialised graphics',()=>{
    const report=[];reportDispositions({graphic:{shape:'circle',color:'#ffffff'}},'media','media.g',report);
    assert.deepEqual(report.map(r=>r.path),['media.g.graphic','media.g.graphic.shape','media.g.graphic.color']);
});
