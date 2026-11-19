import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {exportProInterchange} from '../app/veyrnox/_lib/proInterchangeExport.mjs';
import {importProInterchange} from '../app/veyrnox/_lib/proInterchangeImport.mjs';
import {validateSequence} from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import {TICKS_PER_FRAME as F} from '../app/veyrnox/_lib/proInterchangeTime.mjs';
import {safeText} from '../app/veyrnox/_lib/proMediaManifest.mjs';
import {fixture,sequence,bytes} from './helpers/proInterchange.mjs';
const exported=()=>{const e=exportProInterchange(fixture());return {...e,doc:JSON.parse(new TextDecoder().decode(e.bytes))};};
const read=e=>importProInterchange(bytes(e.doc),{manifest:e.manifest});
test('verbatim upstream fixtures have precise, golden refusals',async()=>{
    for(const [name,code] of [['v1-edit','invalid_format'],['v11-minimal','invalid_format']]) {
        const r=importProInterchange(await readFile(new URL(`./fixtures/proInterchange/${name}.fcproj`,import.meta.url)));
        assert.equal(r.ok,false);assert.equal(r.error.code,code,name);
    }
    // Marker ids are not compared with next_id: the unmodified upstream v8 fixture (marker id 800000, next_id 49) must import.
    const v8=importProInterchange(await readFile(new URL('./fixtures/proInterchange/v8-subclip.fcproj',import.meta.url)));
    assert.equal(v8.ok,true,JSON.stringify(v8.error));
});
test('generated supported documents round trip timing, volume, marker and track states',()=>{
    for(let n=0;n<35;n++) {
        const tl=fixture(),rate=[.5,1,1.5,7/3][n%4];Object.assign(tl.video[0],{start:n*2,len:10+n,in:300,rate,reverse:!!(n%2),volume:(n+1)/20});
        Object.assign(tl.tracks[0],{locked:!!(n%2),muted:!!(n%3),solo:!!(n%4)});
        const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e));const r=importProInterchange(e.bytes,{manifest:e.manifest});
        assert.equal(r.ok,true,JSON.stringify(r));assert.equal(validateSequence(r.draft),null);
        const c=r.draft.video[0];for(const key of ['start','len','in'])assert.ok(Math.abs(c[key]-tl.video[0][key])<=1);
        assert.ok(Math.abs(20*Math.log10(c.volume/tl.video[0].volume))<.1);
        assert.equal(r.draft.markers[0].frame,tl.markers[0].frame);
        const again=exportProInterchange(r.draft);assert.equal(again.ok,true,JSON.stringify(again));
    }
});
test('recombination refuses changed mute, solo, lock, pan, gain and ambiguous links',()=>{
    for(const field of ['muted','solo','locked','pan','volume_db','channels']) {
        const e=exported(),q=sequence(e.doc),a=q.audio_tracks.find(t=>t.items.length);
        a[field]=field==='channels'?'Mono':['pan','volume_db'].includes(field)?.5:!a[field];
        const r=read(e);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.draft.video[0].volume,0);assert.equal(r.draft.audio.length,1);assert.ok(r.report.some(x=>x.feature==='link_state'));
    }
    const e=exported(),q=sequence(e.doc),a=q.audio_tracks.find(t=>t.items.length);
    a.items.push({...a.items[0],id:e.doc.project.next_id++,start:100*F});
    const r=read(e);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.draft.video[0].volume,0);assert.equal(r.draft.audio.length,2);
});
test('overlap selects later starts and discards shadowed tails, including after later clip ends',()=>{
    const e=exported(),q=sequence(e.doc),v=q.video_tracks[0];v.items[0].duration=90*F;
    v.items.push({...v.items[0],id:e.doc.project.next_id++,start:20*F,duration:10*F,link:null});
    const r=read(e);assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(r.draft.video.map(c=>[c.start,c.len]),[[0,20],[20,10]]);assert.ok(r.report.some(x=>x.feature==='dropped:overlap'));
});
test('every nonzero quantisation is reported; rounded zero clips drop',()=>{
    const e=exported(),q=sequence(e.doc);q.video_tracks[0].items[0].start=1;
    let r=read(e);assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.report.some(x=>x.feature==='approximated:quantized'&&x.maxErrorTicks===1));
    q.video_tracks[0].items[0].duration=1;r=read(e);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.draft.video.length,0);assert.ok(r.report.some(x=>x.feature==='dropped:zero_length'));
});
test('source windows clamp and excessive volume reports clamping',()=>{
    const e=exported(),q=sequence(e.doc);q.video_tracks[0].items[0].source_in=899*F;
    q.audio_tracks.find(t=>t.items.length).items[0].gain_db=30;
    const r=read(e);assert.equal(r.ok,true,JSON.stringify(r));assert.ok(r.report.some(x=>x.feature==='approximated:clamped_source'));assert.ok(r.report.some(x=>x.feature==='clamped'));
});
test('text graphic, colour and title track import into a valid v3 draft',()=>{
    const tl=fixture();tl.text.push({id:'t3',start:3,len:80,trackId:'text-0',text:'Hello',x:.25,y:.4,size:9});
    const e=exportProInterchange(tl),r=importProInterchange(e.bytes,{manifest:e.manifest});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.draft.text[0].text,'Hello');assert.equal(r.draft.text[0].size,9);assert.equal(validateSequence(r.draft),null);
});
test('unknown paths never become known IDs; safe original names survive display truncation',()=>{
    const e=exported(),media=Object.values(e.doc.project.items).find(i=>i.kind.Media).kind.Media;
    const long='x'.repeat(180)+'.mp4';media.media.File.path=`/private/secret/../../${long}`;
    const r=read(e);assert.equal(r.ok,true,JSON.stringify(r));const m=Object.values(r.draft.media)[0];
    assert.notEqual(m.id,'source');assert.equal(m.sourceName,long);assert.equal(m.name.length,120);assert.equal(r.manifest.entries[0].needsManualRelink,false);assert.ok(!JSON.stringify(r).includes('/private/secret'));assert.equal(r.manifest.entries[0].offline,true);
});
test('import refuses 41 media, a 601 second sequence and a draft above 30000 bytes',()=>{
    let e=exported(),media=Object.values(e.doc.project.items).find(i=>i.kind.Media);
    for(let n=0;n<40;n++){const id=e.doc.project.next_id++,copy=structuredClone(media);copy.id=id;copy.kind.Media.media.File.path=`/unknown/${n}.mp4`;e.doc.project.items[id]=copy;}
    let r=read(e);assert.equal(r.ok,false);assert.equal(r.error.code,'limit_exceeded');assert.equal(r.error.details.dimension,'media');assert.equal(r.error.details.count,41);
    e=exported();sequence(e.doc).video_tracks[0].items[0].duration=18030*F;r=read(e);assert.equal(r.ok,false);assert.equal(r.error.code,'limit_exceeded');assert.equal(r.error.details.count,18030);
    const tl=fixture();tl.text=[{id:'t3',start:0,len:1,trackId:'text-0',text:'Title',x:.5,y:.5,size:10}];
    const ex=exportProInterchange(tl);e={...ex,doc:JSON.parse(new TextDecoder().decode(ex.bytes))};
    const track=sequence(e.doc).video_tracks.find(t=>t.items[0]?.effects.some(f=>f.effect==='graphic_text')),template=track.items[0];
    track.items=Array.from({length:40},(_,n)=>{const c=structuredClone(template);c.id=e.doc.project.next_id++;c.start=n*F;c.effects[0].params.text.value.Text='x'.repeat(1000);return c;});
    r=read(e);assert.equal(r.ok,false);assert.equal(r.error.code,'limit_exceeded');assert.equal(r.error.details.dimension,'bytes');assert.ok(r.error.details.count>30000);
});
test('disabled audio stays silent and overlap trimming does not swallow its linked tail',()=>{
    const e=exported(),q=sequence(e.doc),a=q.audio_tracks.find(t=>t.items.length);a.enabled=false;
    let r=read(e);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.draft.video[0].volume,0);assert.equal(r.draft.tracks.find(t=>t.id===r.draft.audio[0].trackId).muted,true);
    a.enabled=true;const v=q.video_tracks[0];v.items.push({...v.items[0],id:e.doc.project.next_id++,start:20*F,duration:10*F,link:null});
    r=read(e);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.draft.audio.length,1);assert.equal(r.draft.audio[0].len,90);
});
test('upstream sequence parses with an explicitly repaired counter; enveloped empty project refuses',async()=>{
    // A separate in-memory variation, not a silent importer repair or a changed upstream fixture.
    const d=JSON.parse(await readFile(new URL('./fixtures/proInterchange/v8-subclip.fcproj',import.meta.url),'utf8'));
    d.project.next_id=800001;
    const r=importProInterchange(bytes(d));assert.equal(r.ok,true,JSON.stringify(r));assert.equal(validateSequence(r.draft),null);
    assert.equal(r.draft.video.length,1);assert.equal(r.draft.audio.length,1);assert.ok(Math.abs(r.draft.audio[0].volume-10**(-8/20))<1e-12);assert.ok(r.report.some(x=>x.feature==='generator'));assert.ok(r.report.some(x=>x.feature==='item_kind'));
    const empty=JSON.parse(await readFile(new URL('./fixtures/proInterchange/v11-minimal.fcproj',import.meta.url),'utf8'));empty.format='filmcraft.project';
    assert.equal(importProInterchange(bytes(empty)).error.code,'no_sequence');
});

test('a whole-clip reverse exports with a clamped source and a report; reverse import floors to the first displayed frame',()=>{
    const tl=fixture();Object.assign(tl.video[0],{in:89,len:90,reverse:true});
    const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e.error));
    assert.ok(e.report.some(x=>x.feature==='approximated:clamped_source'));
    const doc={...JSON.parse(new TextDecoder().decode(e.bytes))};
    const v=Object.values(doc.project.items).find(i=>i.kind.Sequence).kind.Sequence.video_tracks[0].items[0];
    Object.assign(v,{source_in:0,duration:10*8467200000,speed:1,reverse:true});
    const r=importProInterchange(new TextEncoder().encode(JSON.stringify(doc)),{manifest:e.manifest});
    assert.equal(r.ok,true,JSON.stringify(r.error));assert.equal(r.draft.video[0].in,9);
});
test('a clip longer than its media is shortened with a report; bidi controls are stripped from names',()=>{
    const tl=fixture();const e=exportProInterchange(tl);assert.equal(e.ok,true);
    const doc=JSON.parse(new TextDecoder().decode(e.bytes));
    const v=Object.values(doc.project.items).find(i=>i.kind.Sequence).kind.Sequence.video_tracks[0].items[0];
    v.source_in=0;v.duration=1200*8467200000;v.speed=1;v.reverse=false;
    const r=importProInterchange(new TextEncoder().encode(JSON.stringify(doc)),{manifest:e.manifest});
    assert.equal(r.ok,true,JSON.stringify(r.error));
    assert.ok(r.report.some(x=>x.feature==='approximated:clamped_length'));
    assert.ok(r.draft.video[0].len<=900);
    assert.equal(safeText('a‮b c',20),'abc');
});
