import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTimecode, parseTimecode, fitTimelineZoom, stepTimelineZoom, autoFitZoom } from '../app/veyrnox/_lib/editorTransport.mjs';

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

test('adding a clip that runs past the visible timeline zooms out to fit it',()=>{
    // 3:10 of video at 2 px/frame is 11,400 px; an 800 px timeline cannot show it
    assert.equal(autoFitZoom({prevClips:0,nextClips:1,total:5700,ppf:2,viewport:800}),0.25);
    assert.equal(autoFitZoom({prevClips:1,nextClips:2,total:5700,ppf:2,viewport:800}),0.25);
    assert.equal(autoFitZoom({prevClips:0,nextClips:1,total:900,ppf:4,viewport:1000}),fitTimelineZoom(900,1000));
});

test('auto-fit never zooms in, never moves a clip that already fits, and ignores edits that add nothing',()=>{
    assert.equal(autoFitZoom({prevClips:0,nextClips:1,total:150,ppf:2,viewport:1024}),null);
    assert.equal(autoFitZoom({prevClips:1,nextClips:1,total:5700,ppf:2,viewport:800}),null);
    assert.equal(autoFitZoom({prevClips:3,nextClips:2,total:5700,ppf:2,viewport:800}),null);
    assert.equal(autoFitZoom({prevClips:1,nextClips:2,total:5700,ppf:0.25,viewport:800}),null);
});

test('auto-fit leaves a manual zoom alone when the new clip still fits that zoom',()=>{
    assert.equal(autoFitZoom({prevClips:1,nextClips:2,total:600,ppf:1,viewport:1200}),null);
});

test('auto-fit tolerates a missing viewport or an empty timeline',()=>{
    assert.equal(autoFitZoom({prevClips:0,nextClips:1,total:0,ppf:2,viewport:0}),null);
    assert.equal(autoFitZoom({prevClips:0,nextClips:1,total:5700,ppf:2,viewport:undefined}),0.25);
});
