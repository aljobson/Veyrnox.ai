import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaManifest,validateMediaManifest,safeSourceName} from '../app/veyrnox/_lib/proMediaManifest.mjs';
import {exportProInterchange} from '../app/veyrnox/_lib/proInterchangeExport.mjs';
import {importProInterchange} from '../app/veyrnox/_lib/proInterchangeImport.mjs';
import {fixture} from './helpers/proInterchange.mjs';
test('manifest schema rejects path/id collisions, traversal, polluted ids and invalid source refs',()=>{
    const good=createMediaManifest(fixture().media);assert.equal(validateMediaManifest(good).ok,true);
    for(const mutate of [m=>m.entries.push({...m.entries[0]}),m=>m.entries[0].virtualPath='/private/file.mp4',m=>m.entries[0].mediaId='__proto__',m=>m.entries[0].sourceRef='../../secret',m=>m.entries[0].sourceName='../camera.mp4',m=>m.entries[0].width=NaN,m=>m.entries[0].unexpected=true]) {
        const m=structuredClone(good);mutate(m);assert.equal(validateMediaManifest(m).ok,false);
    }
});
test('safe original basename is distinct from display name; unsafe filenames are flagged',()=>{
    const long='a'.repeat(230)+'.mp4',m=fixture().media;m.source.sourceName=long;
    const manifest=createMediaManifest(m);assert.equal(manifest.entries[0].sourceName,long);assert.equal(manifest.entries[0].name,'camera.mp4');
    for(const value of ['../x.mp4','C:\\x.mp4','a\u0001.mp4','x'.repeat(256),'.','..']) {const s=safeSourceName(value);assert.equal(s.needsManualRelink,true);assert.ok(!/[\\/\u0000-\u001f]/.test(s.sourceName));assert.ok(s.sourceName.length<=255);}
});
test('asset source references are restored only through the manifest',()=>{
    const tl=fixture();tl.media.source.assetSource={projectId:'12345678-1234-1234-1234-123456789abc',assetId:'abcdefab-1234-1234-1234-123456789abc'};
    const e=exportProInterchange(tl),r=importProInterchange(e.bytes,{manifest:e.manifest});assert.equal(r.ok,true,JSON.stringify(r));assert.deepEqual(r.draft.media.source.assetSource,tl.media.source.assetSource);
    const unknown=importProInterchange(e.bytes);assert.equal(unknown.ok,true,JSON.stringify(unknown));assert.equal(Object.values(unknown.draft.media)[0].assetSource,undefined);
});
