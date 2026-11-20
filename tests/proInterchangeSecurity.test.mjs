import test from 'node:test';
import assert from 'node:assert/strict';
import {scanProProject} from '../lib/proProjectScan.mjs';
import {importProInterchange} from '../app/veyrnox/_lib/proInterchangeImport.mjs';
import {exportProInterchange} from '../app/veyrnox/_lib/proInterchangeExport.mjs';
import {fixture,sequence,bytes} from './helpers/proInterchange.mjs';
const raw = project => new TextEncoder().encode(`{"format":"filmcraft.project","schema_version":17,"project":${project}}`);
test('conversion detects duplicates at every depth, unescaped, with bounded keys',()=>{
    for(const pair of ['"video_tracks":[],"video_tracks":[]','"audio_tracks":[],"audio_tracks":[]','"items":[],"items":[]','"id":1,"id":2','"item":1,"item":2','"start":0,"start":1','"duration":1,"duration":2','"a":1,"\\u0061":2']) {
        const input=raw(`{"items":{"1":{"kind":{"Sequence":{"tracks":[{${pair}}]}}}}}`);
        assert.equal(scanProProject(input).ok,true,'storage defaults unchanged');assert.equal(scanProProject(input,{duplicateKeys:'all'}).ok,false);assert.equal(importProInterchange(input).ok,false);
    }
    assert.equal(scanProProject(raw('{"a":1}'),{duplicateKeys:'all',keyBudget:3}).reason,'too_complex');
    assert.equal(scanProProject(raw(`{"${'x'.repeat(1025)}":0}`),{duplicateKeys:'all'}).reason,'too_complex');
});
test('bounded lexical refusals happen before object-graph construction',()=>{
    assert.equal(importProInterchange(new Uint8Array(8*1024*1024+1)).error.code,'too_large');
    assert.equal(importProInterchange(raw('{"deep":'+'['.repeat(65)+'0'+']'.repeat(65)+'}')).error.code,'too_deep');
    assert.equal(importProInterchange(raw('{"huge":['+'0,'.repeat(750001)+'0]}')).error.code,'too_complex');
    assert.equal(importProInterchange(raw('{"n":NaN}')).ok,false);
});
test('hostile identity, references, numeric fields and null points produce typed refusals',()=>{
    const mutations=[
        d=>{sequence(d).video_tracks[0].items[0].id=0;},
        d=>{sequence(d).video_tracks[0].items[0].item=99999;},
        d=>{sequence(d).video_tracks[0].items[0].start=-1;},
        d=>{sequence(d).video_tracks[0].items[0].source_in=1e30;},
        d=>{sequence(d).video_tracks[0].items[0].speed=null;},
        d=>{sequence(d).video_tracks[0].items[0].effects[0].params.position.value.Vec2.x=null;},
    ];
    for(const mutate of mutations){const e=exportProInterchange(fixture()),d=JSON.parse(new TextDecoder().decode(e.bytes));mutate(d);const r=importProInterchange(bytes(d),{manifest:e.manifest});assert.equal(r.ok,false);assert.equal(typeof r.error.code,'string');}
});
test('prototype keys are not copied into draft objects',()=>{
    const e=exportProInterchange(fixture()),d=JSON.parse(new TextDecoder().decode(e.bytes));
    Object.defineProperty(sequence(d).video_tracks[0].items[0],'__proto__',{value:{polluted:true},enumerable:true});
    const r=importProInterchange(bytes(d),{manifest:e.manifest});assert.equal(r.ok,true,JSON.stringify(r));assert.equal({}.polluted,undefined);assert.equal(Object.hasOwn(r.draft.video[0],'__proto__'),false);
});
test('media, timeline and byte limits never truncate',()=>{
    const tl=fixture();for(let n=0;n<40;n++)tl.media[`m${n}`]={...tl.media.source,id:`m${n}`};
    let r=exportProInterchange(tl);assert.equal(r.error.code,'limit_exceeded');assert.equal(r.error.details.count,41);
    const long=fixture();long.video[0].len=18030;r=exportProInterchange(long);assert.equal(r.error.details.dimension,'frames');assert.equal(r.error.details.count,18030);
    const big=fixture();big.text=Array.from({length:40},(_,n)=>({id:`t${n}`,start:n*2,len:1,trackId:'text-0',text:'x'.repeat(1000),x:.5,y:.5,size:10}));
    r=exportProInterchange(big);assert.equal(r.error.details.dimension,'bytes');assert.ok(r.error.details.count>30000);
});
