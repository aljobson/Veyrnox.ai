import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {exportProInterchange,stackingLanes} from '../app/veyrnox/_lib/proInterchangeExport.mjs';
import {importProInterchange} from '../app/veyrnox/_lib/proInterchangeImport.mjs';
import {scanProProject} from '../lib/proProjectScan.mjs';
import {sequenceLayers} from '../app/veyrnox/_lib/editorSequenceRender.mjs';
import {fixture,sequence} from './helpers/proInterchange.mjs';

test('golden bytes, scanner, unique identities, integer ticks and offline manifest paths',async()=>{
    const e=exportProInterchange(fixture());assert.equal(e.ok,true,JSON.stringify(e));
    assert.deepEqual(e.bytes,exportProInterchange(fixture()).bytes);
    assert.equal(new TextDecoder().decode(e.bytes),await readFile(new URL('./fixtures/proInterchange/export-golden.fcproj',import.meta.url),'utf8'));
    assert.equal(scanProProject(e.bytes,{duplicateKeys:'all'}).ok,true);
    const doc=JSON.parse(new TextDecoder().decode(e.bytes)),ids=new Set();
    const walk=v=>{if(!v||typeof v!=='object')return;if(Object.hasOwn(v,'id')){assert.ok(!ids.has(v.id));assert.ok(v.id<doc.project.next_id);ids.add(v.id);}for(const [k,c]of Object.entries(v)){if(['start','duration','source_in'].includes(k)){assert.ok(Number.isSafeInteger(c));assert.ok(c>=0);}walk(c);}};walk(doc.project);
    const media=Object.values(doc.project.items).find(i=>i.kind.Media).kind.Media;
    assert.equal(media.offline,true);assert.equal(media.media.File.path,e.manifest.entries[0].virtualPath);
    const seq=sequence(doc);assert.equal(seq.video_tracks.flatMap(t=>t.items).length,1);assert.equal(seq.audio_tracks.flatMap(t=>t.items).length,1);
});
test('overlap lanes preserve array stacking, reuse gaps and sort only inside lanes',()=>{
    const clips=[{id:'A',start:0,len:10},{id:'B',start:5,len:25},{id:'C',start:10,len:10}];
    assert.deepEqual(stackingLanes(clips).map(l=>l.map(c=>c.id)),[['A'],['B'],['C']]);
    assert.equal(stackingLanes([{start:20,len:5},{start:0,len:5}]).length,1);
    const tl=fixture();tl.video=clips.map((c,i)=>({...tl.video[0],...c,id:`v${i+1}`}));
    const exported=exportProInterchange(tl);assert.equal(exported.ok,true,JSON.stringify(exported));
    const seq=sequence(JSON.parse(new TextDecoder().decode(exported.bytes)));
    for(const frame of [0,5,9,10,15,20,29]) {
        const our=sequenceLayers(tl,frame).visuals.map(v=>v.clip.start);
        const theirs=seq.video_tracks.flatMap(t=>t.items.filter(c=>c.start<=frame*8467200000&&c.start+c.duration>frame*8467200000).map(c=>c.start/8467200000));
        assert.deepEqual(theirs,our);
    }
    tl.video.reverse();assert.equal(exportProInterchange(tl).ok,true);
});
test('muted companions and silent solo markers survive a round trip',()=>{
    for(const muted of [false,true])for(const solo of [false,true])for(const volume of [0,.5]) {
        const tl=fixture();Object.assign(tl.tracks[0],{muted,solo,locked:true});tl.video[0].volume=volume;
        const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e));
        const i=importProInterchange(e.bytes,{manifest:e.manifest});assert.equal(i.ok,true,JSON.stringify(i));
        const videoTrack=i.draft.tracks.find(t=>t.kind==='video');
        assert.equal(videoTrack.muted,muted);assert.equal(videoTrack.solo,solo);assert.equal(videoTrack.locked,true);assert.equal(i.draft.video[0].volume,volume);assert.equal(i.draft.audio.length,0);
    }
});
test('generated audio clips and stacking lanes refuse re-import limit overflow',()=>{
    const tl=fixture();tl.audio=Array.from({length:40},(_,i)=>({...tl.video[0],id:`a${i}`,trackId:'audio-0',start:i*100,transition:undefined}));
    delete tl.audio[0].transition;
    const e=exportProInterchange(tl);assert.equal(e.ok,false);assert.equal(e.error.code,'limit_exceeded');
    const lanes=fixture();lanes.video=Array.from({length:17},(_,i)=>({...lanes.video[0],id:`v${i}`,volume:0}));
    const fail=exportProInterchange(lanes);assert.equal(fail.ok,false);assert.equal(fail.error.details.dimension,'tracks');
});
test('cross-kind track order, lock/mute/solo and hidden video sound survive via native metadata',()=>{
    const tl=fixture();tl.tracks=[tl.tracks[2],tl.tracks[0],tl.tracks[1]];tl.tracks[1].hidden=true;
    const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e));
    const r=importProInterchange(e.bytes,{manifest:e.manifest});assert.equal(r.ok,true,JSON.stringify(r));
    assert.deepEqual(r.draft.tracks.map(t=>t.name),tl.tracks.map(t=>t.name));
    assert.equal(r.draft.tracks.find(t=>t.kind==='video').hidden,true);assert.equal(r.draft.video[0].volume,.7);assert.equal(r.draft.audio.length,0);
});
test('uniform pan is converted between v3 unit interval and FilmCraft percent',()=>{
    const tl=fixture();tl.video[0].pan=.4;const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e));
    const q=sequence(JSON.parse(new TextDecoder().decode(e.bytes)));
    assert.equal(q.audio_tracks.find(t=>t.items.length).pan,40);
    const r=importProInterchange(e.bytes,{manifest:e.manifest});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.draft.audio[0].pan,.4);assert.equal(r.draft.video[0].volume,0);
});
test('freeze frames use the held source time and stay silent',()=>{
    const tl=fixture();tl.video[0].freezeFrame=75;tl.video[0].volume=0;
    const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e));const r=importProInterchange(e.bytes,{manifest:e.manifest});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.draft.video[0].freezeFrame,75);assert.equal(r.draft.video[0].volume,0);
});

test('unused graphic media is skipped with a report; a manifest with extra or renamed media is refused',()=>{
    const tl=fixture();tl.media.g1={id:'g1',kind:'graphic',frames:30,width:100,height:100,hasAudio:false,name:'card.png',sourceName:'card.png',graphic:{shape:'circle',color:'#ff0000'}};
    const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e.error));
    assert.ok(e.report.some(x=>x.feature==='unused_graphic_media'));
    const base=exportProInterchange(fixture());
    const extra=structuredClone(e.manifest);
    assert.equal(exportProInterchange(fixture(),{manifest:extra}).error.code,'manifest_media_mismatch');
    const renamed=structuredClone(base.manifest);renamed.entries[0].name='other.mp4';renamed.entries[0].sourceName='other.mp4';renamed.entries[0].virtualPath=renamed.entries[0].virtualPath;
    assert.equal(exportProInterchange(fixture(),{manifest:renamed}).ok,false);
});
test('track pan ignores silent clips',()=>{
    const tl=fixture();tl.video[0].pan=0.5;tl.video.push({...tl.video[0],id:'v9',start:100,volume:0,pan:0});
    const e=exportProInterchange(tl);assert.equal(e.ok,true,JSON.stringify(e.error));
    assert.ok(!e.report.some(x=>x.feature==='pan'&&x.severity==='dropped'));
});
