import test from 'node:test';
import assert from 'node:assert/strict';
import { alignLyricCaptions } from '../app/veyrnox/_lib/editorLyrics.mjs';
import { emptySequence, addSequenceText } from '../app/veyrnox/_lib/editorSequence.mjs';
import { parseCaptions, insertCaptions, exportCaptions } from '../app/veyrnox/_lib/editorCaptions.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { captionPresentation } from '../app/veyrnox/_lib/editorWords.mjs';
import { emptyProjectDocument, withTimeline, validProjectDocument } from '../lib/projectDocument.js';
const source = text => insertCaptions(emptySequence(), parseCaptions(JSON.stringify({words:text.split(' ').map((word,i)=>({word,start:1+i*.5,end:1+i*.5+.4}))}),'json').cues);
test('lyric display lines reuse source timestamps, preserve other text, export words and round-trip a project',()=>{
    const tl=addSequenceText(source('Hello moon carry our song home'),{text:'Original title'}), before=JSON.stringify(tl);
    const next=alignLyricCaptions(tl,'HELLO, moon!\nCarry our song home.');
    assert.equal(next.error,undefined); assert.equal(JSON.stringify(tl),before);
    assert.equal(next.text[0].text,'Original title');
    const cues=next.text.filter(c=>c.caption);
    assert.deepEqual(cues.map(c=>[c.text,c.start,c.len]),[['HELLO, moon!',30,27],['Carry our song home.',60,57]]);
    assert.deepEqual(cues[1].words.map(w=>[w.text,w.start,w.len]),[['Carry',0,12],['our',15,12],['song',30,12],['home.',45,12]]);
    assert.deepEqual(captionPresentation(cues[1],31).ranges,[{from:0,to:5},{from:6,to:9},{from:10,to:14}]);
    const replay=parseCaptions(exportCaptions({...next,text:cues},'vtt'),'vtt');
    assert.equal(replay.error,undefined); assert.deepEqual(replay.cues[1].words.map(w=>w.start),[0,15,30,45]);
    const id='11111111-1111-4111-8111-111111111111';
    assert.equal(validProjectDocument(JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),next))),id),true);
});
test('missing words and repeated ambiguous anchors refuse insertion without changing source',()=>{
    const tl=source('go home go home'), before=JSON.stringify(tl);
    assert.match(alignLyricCaptions(tl,'go home').error,/more than one possible alignment/);
    assert.match(alignLyricCaptions(tl,'go away').error,/No ordered word timestamp/);
    assert.equal(alignLyricCaptions(tl,'go home\ngo home').error,undefined);
    assert.equal(JSON.stringify(tl),before);
});
test('selected source preserves other captions; estimates, locked tracks and overlapping or trimmed words refuse',()=>{
    const tl=insertCaptions(source('hello world'),parseCaptions(JSON.stringify({words:[{word:'hello',start:4,end:4.5},{word:'world',start:4.5,end:5}]}),'json').cues);
    const one=alignLyricCaptions(tl,'Hello world!','t1');assert.equal(one.error,undefined);
    assert.deepEqual(one.text.find(c=>c.id==='t2'),tl.text.find(c=>c.id==='t2'));
    assert.match(alignLyricCaptions({...tl,text:tl.text.map(c=>({...c,wordsEstimated:true}))},'hello').error,/Evenly distributed/);
    assert.match(alignLyricCaptions({...tl,tracks:tl.tracks.map(t=>({...t,locked:t.kind==='text'}))},'hello world!','t1').error,/Unlock/);
    assert.match(alignLyricCaptions({...tl,text:[tl.text[0],{...tl.text[1],start:tl.text[0].start}]},'hello world hello world').error,/overlap/);
    assert.match(alignLyricCaptions({...tl,text:[{...tl.text[0],words:tl.text[0].words.map(w=>({...w,start:w.start-1}))}]},'hello world').error,/one complete timestamp/);
});
test('input, cue and document limits fail atomically; multiword segments never fabricate word timing',()=>{
    const tl=source('hello world');
    for(const value of [null,'', '\u0000hello', 'a'.repeat(17000), Array(151).fill('hello').join('\n'), Array(101).fill('hello').join(' ')])assert.ok(alignLyricCaptions(tl,value).error);
    const segment={...tl.text[0],words:[{text:'hello world',start:0,len:27}]};
    assert.match(alignLyricCaptions({...tl,text:[segment]},'hello world').error,/one complete timestamp/);
    const full=Array.from({length:149},(_,i)=>({id:`t${i+1}`,start:0,len:90,trackId:'text-0',text:'Original title',x:.5,y:.5,size:6}));
    const large={...tl,seq:150,text:[...full,{...tl.text[0],id:'t150'}]};
    assert.equal(validateSequence(large),null);
    // Replacement stays governed by the same project validator as every edit.
    assert.match(alignLyricCaptions(large,'hello\nworld').error,/Too many text clips/);
});
