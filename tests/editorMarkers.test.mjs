import test from 'node:test';
import assert from 'node:assert/strict';
import { addSequenceMarker, emptySequence, removeSequenceMarker, updateSequenceMarker } from '../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';

const ok=value=>{assert.equal(value.error,undefined);return value;};

test('timeline markers persist as validated ordered project data',()=>{
    let timeline=ok(addSequenceMarker(emptySequence(),90,'Ending'));
    timeline=ok(addSequenceMarker(timeline,30,'Opening'));
    assert.deepEqual(timeline.markers.map(marker=>[marker.frame,marker.label]),[[30,'Opening'],[90,'Ending']]);
    assert.equal(validateSequence(JSON.parse(JSON.stringify(timeline))),null);
    timeline=ok(updateSequenceMarker(timeline,timeline.markers[0].id,{frame:120,label:'New ending'}));
    assert.deepEqual(timeline.markers.map(marker=>marker.frame),[90,120]);
    timeline=ok(removeSequenceMarker(timeline,timeline.markers[0].id));
    assert.deepEqual(timeline.markers.map(marker=>marker.label),['New ending']);
});

test('marker input is bounded and strict',()=>{
    assert.match(updateSequenceMarker(emptySequence(),'missing',{label:'No'}).error,/existing marker/);
    assert.match(addSequenceMarker({...emptySequence(),markers:Array.from({length:100},(_,i)=>({id:`m${i+1}`,frame:i,label:`M ${i}`,color:'#3ee6c4'}))},0).error,/100 markers/);
    assert.match(validateSequence({...emptySequence(),markers:[{id:'m1',frame:0,label:'',color:'#3ee6c4'}]}),/marker/);
});
