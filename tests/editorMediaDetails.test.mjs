import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence,addSequenceMedia,updateMediaDetails } from '../app/veyrnox/_lib/editorSequence.mjs';
import { mediaFolders,matchingMedia } from '../app/veyrnox/_lib/editorMediaDetails.mjs';
import { matchLocalFile } from '../app/veyrnox/_lib/editorProject.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const fixture=()=>addSequenceMedia(emptySequence(),{id:'local',kind:'video',frames:120,width:640,height:360,hasAudio:true,name:'Original.mp4'});
test('renamed and organized media round-trip and still relink by original source identity',()=>{
    let tl=updateMediaDetails(fixture(),'local',{name:'Opening scene',folder:'Story/Intro',attribution:{credit:'Owner',usage:'Project footage',url:'https://example.com/rights'}});assert.equal(tl.error,undefined);
    tl=updateMediaDetails(tl,'local',{name:'Revised opening'});assert.equal(tl.media.local.sourceName,'Original.mp4');assert.deepEqual(mediaFolders(tl),['Story/Intro']);
    assert.equal(matchingMedia(tl,{folder:'Story/Intro',search:'Owner'}).length,1);assert.equal(matchingMedia(tl,{folder:''}).length,0);
    const match=matchLocalFile(tl,{name:'Original.mp4'},{seconds:4,kind:'video'});assert.equal(match.id,'local');
    const id='11111111-1111-4111-8111-111111111111';assert.equal(validProjectDocument(JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),tl))),id),true);
});
test('unsafe attribution links and unbounded folder/name changes fail atomically',()=>{
    const tl=fixture(),before=JSON.stringify(tl);for(const patch of [{folder:'../Intro'},{folder:'a/b/c/d/e'},{name:'x'.repeat(121)},{frames:1},{attribution:{credit:'Owner',usage:'Note',url:'javascript:alert(1)'}}])assert.ok(updateMediaDetails(tl,'local',patch).error);assert.equal(JSON.stringify(tl),before);
});
