import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence, addSequenceMedia, addSequenceClip, splitSequenceClip, updateSequenceTrack } from '../app/veyrnox/_lib/editorSequence.mjs';
import { insertCaptions } from '../app/veyrnox/_lib/editorCaptions.mjs';
import { parseWordJson, distributeWords } from '../app/veyrnox/_lib/editorWords.mjs';
import { sourceFrame } from '../app/veyrnox/_lib/editorSpeed.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { transcriptEntries, transcriptRange, cutTranscriptRange, correctTranscriptWord, transcriptText } from '../app/veyrnox/_lib/editorTranscript.mjs';
const fixture = () => {
    let tl = addSequenceMedia(emptySequence(), { id:'source', kind:'video', frames:600, width:640, height:360, name:'Original', hasAudio:true });
    tl = addSequenceClip(tl,'video','source',{len:240,rate:2}); tl = addSequenceClip(tl,'audio','source',{len:240});
    return insertCaptions(tl,parseWordJson(JSON.stringify({words:['A','B','C','D'].map((word,index)=>({word,start:index+1,end:index+2}))})).cues);
};
test('word-selected cuts remove actual caption words and preserve retimed source continuity across every track', () => {
    const tl=fixture(), words=transcriptEntries(tl), selection={first:words[1].key,last:words[1].key}, before=JSON.stringify(tl);
    const cut=cutTranscriptRange(tl,selection); assert.equal(validateSequence(cut),null);
    assert.deepEqual(cut.video.map(c=>[c.start,c.len,c.in]),[[0,60,0],[60,150,180]]);
    assert.deepEqual(cut.audio.map(c=>[c.start,c.len,c.in]),[[0,60,0],[60,150,90]]);
    assert.equal(sourceFrame(cut.video[1],10),sourceFrame(tl.video[0],100));
    assert.deepEqual(transcriptEntries(cut).map(w=>[w.text,w.start,w.len]),[['A',30,30],['C',60,30],['D',90,30]]);
    assert.equal(transcriptText(cut),'A\nC D');assert.equal(JSON.stringify(tl),before,'history input must remain unchanged');
    assert.deepEqual(JSON.parse(JSON.stringify(cut)),cut,'existing caption schema round-trips');
});
test('locked affected tracks, stale selections, overlapping and estimated words refuse the entire transcript edit', () => {
    const tl=fixture(), words=transcriptEntries(tl), selection={first:words[0].key,last:words[1].key};
    assert.match(cutTranscriptRange(updateSequenceTrack(tl,'audio-0',{locked:true}),selection).error,/Unlock/);
    assert.match(cutTranscriptRange(tl,{first:'missing',last:words[1].key}).error,/current/);
    const estimated={...tl,text:tl.text.map(c=>({...c,...distributeWords(c)}))};assert.match(transcriptRange(estimated,selection).error,/Estimated/);
    const overlapping=insertCaptions(tl,[{text:'Other',start:45,len:60}]); assert.match(transcriptRange(overlapping,{first:words[0].key,last:words[1].key}).error,/overlap/);
});
test('correction preserves actual intervals, obeys track locks and does not silently clear word alignment', () => {
    const tl=fixture(), entry=transcriptEntries(tl)[1], next=correctTranscriptWord(tl,entry.key,'Better');
    assert.equal(validateSequence(next),null);assert.equal(transcriptEntries(next)[1].text,'Better');
    assert.deepEqual(next.text[0].words.map(w=>[w.start,w.len]),tl.text[0].words.map(w=>[w.start,w.len]));
    assert.equal(next.text[0].wordsEstimated,false);
    assert.match(correctTranscriptWord(updateSequenceTrack(tl,'text-0',{locked:true}),entry.key,'Better').error,/Unlock/);
    for(const bad of ['', 'two words', 'x'.repeat(101), 'Bad\u0000'])assert.ok(correctTranscriptWord(tl,entry.key,bad).error);
});
test('manual captions expose whole-cue selection without manufacturing word timestamps', () => {
    const tl=insertCaptions(emptySequence(),[{text:'Whole cue',start:0,len:60}]), entries=transcriptEntries(tl);
    assert.equal(entries[0].wordIndex,null);assert.equal(entries[0].key,'t1:cue');
    const cut=cutTranscriptRange(tl,{first:entries[0].key,last:entries[0].key});assert.equal(validateSequence(cut),null);assert.equal(cut.text.length,0);
    assert.ok(correctTranscriptWord(tl,entries[0].key,'New').error);
});

test('ripple shifts leave the contents of unrelated previously split captions unchanged', () => {
    let tl=insertCaptions(emptySequence(),[
        {text:'Cut',start:0,len:30},
        {text:'Keep both',start:90,len:60,words:[{text:'Keep',start:0,len:30},{text:'both',start:30,len:30}],wordsEstimated:false},
    ]);
    tl=splitSequenceClip(tl,'text',tl.text[1].id,120);
    assert.equal(validateSequence(tl),null);
    const before=tl.text.slice(1), cut=cutTranscriptRange(tl,{first:'t1:cue',last:'t1:cue'});
    assert.equal(validateSequence(cut),null);
    assert.deepEqual(cut.text,before.map(cue=>({...cue,start:cue.start-30})));
    assert.deepEqual(cut.text.map(cue=>cue.text),['Keep both','Keep both']);
});
