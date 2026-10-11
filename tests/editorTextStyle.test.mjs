import test from 'node:test';
import assert from 'node:assert/strict';
import { emptySequence,addSequenceText,updateSequenceClip } from '../app/veyrnox/_lib/editorSequence.mjs';
import { TEXT_DEFAULTS } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { TEXT_EXTRAS } from '../app/veyrnox/_lib/editorTextStyle.mjs';
import { emptyProjectDocument,withTimeline,validProjectDocument } from '../lib/projectDocument.js';
test('legacy styles remain valid and richer typography survives a canonical document round-trip',()=>{
    const tl=addSequenceText(emptySequence(),{text:'Multiline\nTitle',style:{...TEXT_DEFAULTS}});assert.equal(tl.error,undefined);
    const styled=updateSequenceClip(tl,'text','t1',{style:{...TEXT_DEFAULTS,...TEXT_EXTRAS,font:'Georgia',italic:true,underline:true,letterSpacing:2,lineHeight:1.5,shadowOpacity:.8,shadowX:12,shadowY:8}}),id='11111111-1111-4111-8111-111111111111';
    assert.equal(styled.error,undefined);assert.equal(validProjectDocument(JSON.parse(JSON.stringify(withTimeline(emptyProjectDocument(id),styled))),id),true);
});
test('unknown fonts, unbounded shadows and unexpected fields cannot pass document validation',()=>{
    const tl=addSequenceText(emptySequence());
    for(const extra of [{font:'url(https://untrusted)'},{shadowBlur:31},{letterSpacing:Infinity},{shadowOpacity:2},{italic:'yes'},{unknown:true}])assert.ok(updateSequenceClip(tl,'text','t1',{style:{...TEXT_DEFAULTS,...extra}}).error);
});
