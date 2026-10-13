import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimecode, parseTimecode, fitTimelineZoom, stepTimelineZoom } from '../app/veyrnox/_lib/editorTransport.mjs';

test('editor timecode round-trips whole frames without drift',()=>{
    for(const frame of [0,1,29,30,1799,1800,108012]) assert.equal(parseTimecode(formatTimecode(frame)),frame);
    assert.equal(formatTimecode(-4),'00:00:00:00');
});

test('timecode rejects ambiguous or out-of-range fields',()=>{
    for(const value of ['1:02:03','00:60:00:00','00:00:60:00','00:00:00:30','00:00:00:-1','words']) assert.equal(parseTimecode(value),null);
    assert.equal(parseTimecode('01:02:03:04'),111694);
});

test('fit and stepped timeline zoom stay on quarter steps within bounds',()=>{
    assert.equal(fitTimelineZoom(300,1024),2);
    assert.equal(fitTimelineZoom(18000,320),0.25);
    assert.equal(fitTimelineZoom(0,4000),8);
    assert.equal(stepTimelineZoom(2,1),2.25);
    assert.equal(stepTimelineZoom(0.25,-1),0.25);
    assert.equal(stepTimelineZoom(8,1),8);
});
