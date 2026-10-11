import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence,addSequenceMedia,addSequenceClip,addSequenceText,updateSequenceTrack,sourceFrame } from '../app/veyrnox/_lib/editorSequence.mjs';
import { deleteSelection } from '../app/veyrnox/_lib/editorSelection.mjs';
import { createHistory,commitHistory,undoHistory } from '../app/veyrnox/_lib/editorHistory.mjs';
const ok=t=>{assert.equal(t.error,undefined);return t;};
function fixture(){let t=addSequenceMedia(emptySequence(),{id:'source',kind:'video',frames:300,name:'Source',hasAudio:true,width:640,height:360});t=ok(addSequenceClip(t,'video','source',{len:30}));t=ok(addSequenceClip(t,'video','source',{in:30,len:90}));t=ok(addSequenceClip(t,'audio','source',{start:0,len:120}));return ok(addSequenceText(t,{start:60,len:60,text:'Caption'}));}
test('global ripple closes every track, trims crossing sound and retains source alignment and undo',()=>{
    const t=fixture(),next=ok(deleteSelection(t,[{track:'video',id:'v1'}],'all'));assert.equal(next.video[0].start,0);assert.equal(next.audio[0].len,90);assert.equal(next.audio[0].in,30);assert.equal(next.text[0].start,30);
    for(let i=0;i<90;i++)assert.equal(sourceFrame(next.audio[0],i),sourceFrame(t.audio[0],i+30));
    assert.deepEqual(undoHistory(commitHistory(createHistory(t),next)).now,t);
});
test('overlapping selected ranges collapse once; locked downstream tracks reject the whole operation',()=>{
    let t=fixture();t=ok(addSequenceText(t,{start:10,len:30,text:'Remove'}));const next=ok(deleteSelection(t,[{track:'video',id:'v1'},{track:'text',id:t.text.at(-1).id}],'all'));assert.equal(next.video[0].len,80);assert.equal(next.video[0].in,40);assert.equal(next.text[0].start,20);
    const locked=ok(updateSequenceTrack(t,'audio-0',{locked:true})),before=JSON.stringify(locked);assert.match(deleteSelection(locked,[{track:'video',id:'v1'}],'all').error,/Unlock/);assert.equal(JSON.stringify(locked),before);
});
