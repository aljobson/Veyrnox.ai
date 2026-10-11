import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCaptions,insertCaptions,exportCaptions,cutSequenceRange } from '../app/veyrnox/_lib/editorCaptions.mjs';
import { emptySequence,addSequenceText,updateSequenceClip,splitSequenceClip,trimSequence } from '../app/veyrnox/_lib/editorSequence.mjs';
import { captionPresentation,distributeWords } from '../app/veyrnox/_lib/editorWords.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
const fixture=()=>insertCaptions(emptySequence(),parseCaptions('WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nOne <00:00:01.000>two <00:00:02.000>three','vtt').cues);
test('timestamped VTT and enhanced LRC retain source timing and export a replayable VTT',()=>{
    const tl=fixture();assert.equal(tl.error,undefined);assert.deepEqual(tl.text[0].words.map(w=>[w.text,w.start,w.len]),[['One',0,30],['two',30,30],['three',60,30]]);
    const reread=parseCaptions(exportCaptions(tl,'vtt'),'vtt');assert.deepEqual(reread.cues[0].words,tl.text[0].words);
    const lrc=parseCaptions('[00:00.00]One <00:01.00>two <00:02.00>three\n[00:03.00]Next','lrc');assert.deepEqual(lrc.cues[0].words,tl.text[0].words);
    assert.equal(parseCaptions('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne <00:00:02.000>two','vtt').error!==undefined,true);
});
test('word highlight, karaoke and single-word presentation follow the playhead and retain whitespace ranges',()=>{
    const clip=fixture().text[0];assert.deepEqual(captionPresentation(clip,40),{text:'One two three',ranges:[{from:4,to:7}]});
    assert.deepEqual(captionPresentation({...clip,wordStyle:{mode:'karaoke',color:'#ffffff'}},40).ranges,[{from:0,to:3},{from:4,to:7}]);
    assert.deepEqual(captionPresentation({...clip,wordStyle:{mode:'word',color:'#ffffff'}},75),{text:'three',ranges:[{from:0,to:5}]});
    assert.deepEqual(captionPresentation({...clip,text:'One\n two  three'},40).ranges,[{from:5,to:8}]);
});
test('timing stays aligned after split, trim and transcript cuts; editing words clears stale timings',()=>{
    const tl=fixture(),parts=splitSequenceClip(tl,'text','t1',40),trim=trimSequence(tl,'text','t1','in',35),cut=cutSequenceRange(tl,25,55);
    assert.equal(parts.error,undefined);assert.equal(trim.error,undefined);assert.equal(cut.error,undefined);
    for(const c of parts.text)for(let i=0;i<c.len;i++)assert.deepEqual(captionPresentation(c,i),captionPresentation(tl.text[0],c.start+i));
    for(let i=0;i<trim.text[0].len;i++)assert.deepEqual(captionPresentation(trim.text[0],i),captionPresentation(tl.text[0],35+i));
    assert.equal(cut.text[1].words[0].start,-55);
    assert.deepEqual(updateSequenceClip(tl,'text','t1',{text:'New words'}).text[0].words,[]);
    const id='11111111-1111-4111-8111-111111111111';assert.equal(validProjectDocument(JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),parts))),id),true);
});
test('bounded word JSON groups source words; manual estimates are explicit; invalid timings fail',()=>{
    const json=JSON.stringify({words:[{word:'Hello',start:0,end:.5},{word:'world',start:.5,end:1},{word:'Next',start:2,end:3}]}),cues=parseCaptions(json,'json').cues;
    assert.equal(cues.length,2);assert.equal(cues[0].wordsEstimated,false);assert.equal(insertCaptions(emptySequence(),cues).error,undefined);
    const clip=addSequenceText(emptySequence(),{caption:true,text:'One two three',len:7}).text[0],estimate=distributeWords(clip);assert.equal(estimate.wordsEstimated,true);assert.deepEqual(estimate.words.map(w=>w.len),[2,2,3]);
    assert.ok(distributeWords({...clip,len:2}).error);
    const tl=fixture();for(const patch of [{words:[{text:'bad',start:0,len:30}]},{words:[{text:'One two three',start:0,len:0}]},{wordStyle:{mode:'html',color:'#ffffff'}}])assert.ok(updateSequenceClip(tl,'text','t1',patch).error);
    for(const word of [{word:'Hello',start:0,end:0},{word:'Hello',start:-1,end:1},{word:'Hello',start:0,end:601}])assert.ok(parseCaptions(JSON.stringify({words:[word]}),'json').error);
});
