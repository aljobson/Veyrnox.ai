import test from 'node:test';
import assert from 'node:assert/strict';
import { addSequenceClip, addSequenceMedia, emptySequence, replaceSequenceClipMedia, updateSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';

const media=(id,frames=300,kind='video')=>({id,kind,frames,name:id,width:kind==='audio'?0:640,height:kind==='audio'?0:360,hasAudio:true});
const ok=value=>{assert.equal(value.error,undefined);return value;};

test('replacing a clip preserves placement, duration and creative edits',()=>{
    let timeline=ok(addSequenceMedia(emptySequence(),media('original')));timeline=ok(addSequenceMedia(timeline,media('replacement')));
    timeline=ok(addSequenceClip(timeline,'video','original',{start:45,in:30,len:120}));
    timeline=ok(updateSequenceClip(timeline,'video',timeline.video[0].id,{transform:{x:.2,y:.1,scale:1.2,rotation:5,opacity:.8,flipX:false,flipY:false},filter:{brightness:1.1,contrast:1.2,saturate:.9,hue:4,blur:0}}));
    const before=timeline.video[0],next=ok(replaceSequenceClipMedia(timeline,'video',before.id,'replacement')),after=next.video[0];
    assert.equal(after.mediaId,'replacement');assert.equal(after.start,before.start);assert.equal(after.len,before.len);assert.deepEqual(after.transform,before.transform);assert.deepEqual(after.filter,before.filter);assert.equal(after.in,0);
});

test('replacement refuses a different type or a source shorter than the edited clip',()=>{
    let timeline=ok(addSequenceMedia(emptySequence(),media('original')));timeline=ok(addSequenceMedia(timeline,media('short',30)));timeline=ok(addSequenceMedia(timeline,media('sound',300,'audio')));timeline=ok(addSequenceClip(timeline,'video','original',{len:120}));
    assert.match(replaceSequenceClipMedia(timeline,'video',timeline.video[0].id,'short').error,/too short/);
    assert.match(replaceSequenceClipMedia(timeline,'video',timeline.video[0].id,'sound').error,/same media type/);
});
