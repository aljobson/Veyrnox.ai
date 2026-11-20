import test from 'node:test';
import assert from 'node:assert/strict';
import { framesToTicks, ticksToFrames, rationalRate, TICKS_PER_FRAME as F, sourceInTicks, sourceFirstTick } from '../app/veyrnox/_lib/proInterchangeTime.mjs';
import {sourceFrame} from '../app/veyrnox/_lib/editorSpeed.mjs';
test('rational time arithmetic and every nonzero quantisation remainder',()=>{
    assert.deepEqual(rationalRate({num:48000,den:2002}),{num:24000,den:1001});
    assert.equal(framesToTicks(1,{num:24000,den:1001}),10594584000);
    assert.equal(ticksToFrames(F+1).frames,1);assert.equal(ticksToFrames(F+1).errorTicks,1);
    assert.equal(ticksToFrames(F/2).frames,1);assert.equal(ticksToFrames(F/2).errorFrames,-.5);
    assert.throws(()=>framesToTicks(1e7),{code:'ticks_precision'});
    for(const v of [NaN,Infinity,-1,null])assert.throws(()=>ticksToFrames(v));
});
test('trimmed fractional forward and reverse preserve first/last displayed source frame',()=>{
    for(const rate of [.5,1,1.5,7/3])for(const reverse of [false,true]) {
        const c={id:'v1',in:200,len:37,rate,reverse},fc={source_in:sourceInTicks(c),duration:framesToTicks(c.len),speed:rate,reverse};
        for(const k of [0,c.len-1]) {
            const filmcraft=reverse?fc.source_in+Math.round(fc.duration*rate)-Math.round(k*F*rate)-1:fc.source_in+Math.round(k*F*rate);
            assert.ok(Math.abs(filmcraft/F-sourceFrame(c,k))<=1/F,'tick rounding only');
        }
        assert.equal(sourceFirstTick(fc),200*F);
    }
    assert.throws(()=>sourceInTicks({id:'v1',in:29,len:30,reverse:true}),{code:'reverse_window_negative'});
});
