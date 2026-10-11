import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence,addSequenceMedia,addSequenceClip,updateSequenceClip,removeSequenceMedia } from '../app/veyrnox/_lib/editorSequence.mjs';
import { copySelection,pasteSelection } from '../app/veyrnox/_lib/editorSelection.mjs';
import { BACKGROUND_DEFAULTS } from '../app/veyrnox/_lib/editorBackground.mjs';
import { frameLayers,resolvePictures } from '../app/veyrnox/_lib/editorRender.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const fixture=()=>addSequenceClip(addSequenceMedia(addSequenceMedia(emptySequence(),{id:'source',kind:'video',frames:120,name:'Source',hasAudio:false,width:640,height:360}),{id:'backdrop',kind:'image',frames:90,name:'Backdrop',hasAudio:false,width:640,height:360}),'video','source');
test('background image resolves and survives document/copy without source loss',async()=>{
    const tl=updateSequenceClip(fixture(),'video','v1',{background:{...BACKGROUND_DEFAULTS,type:'image',mediaId:'backdrop'}}),id='11111111-1111-4111-8111-111111111111';
    assert.equal(validProjectDocument(JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),tl))),id),true);
    const calls=[],pictures=await resolvePictures(frameLayers(tl,30),(k,time,mediaId)=>{calls.push([k,time,mediaId]);return mediaId || 'source';});
    assert.deepEqual(pictures,{visuals:['source'],backgrounds:['backdrop']});assert.deepEqual(calls,[[0,1,undefined],[0,0,'backdrop']]);
    const clipboard=copySelection(tl,[{track:'video',id:'v1'}]);assert.ok(clipboard.media.backdrop);
    const pasted=pasteSelection(emptySequence(),clipboard,0);assert.equal(pasted.error,undefined);assert.equal(pasted.video[0].background.mediaId,'backdrop');
    assert.match(removeSequenceMedia(tl,'backdrop').error,/backgrounds/);
});
test('missing, wrong-kind and malformed background sources are rejected atomically',()=>{
    const tl=fixture(),before=JSON.stringify(tl);
    for(const background of [{...BACKGROUND_DEFAULTS,type:'image',mediaId:'missing'},{...BACKGROUND_DEFAULTS,type:'image',mediaId:'source'},{...BACKGROUND_DEFAULTS,type:'blur',blur:61},{...BACKGROUND_DEFAULTS,type:'solid',extra:true},{...BACKGROUND_DEFAULTS,type:'solid',mediaId:'backdrop'}])assert.ok(updateSequenceClip(tl,'video','v1',{background}).error);
    assert.equal(JSON.stringify(tl),before);
    for(const type of ['none','solid','blur'])assert.equal(updateSequenceClip(tl,'video','v1',{background:{...BACKGROUND_DEFAULTS,type}}).error,undefined);
});
