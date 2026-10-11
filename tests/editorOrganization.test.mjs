import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {emptySequence,addSequenceMedia,addSequenceText} from '../app/veyrnox/_lib/editorSequence.mjs';
import {validateSequence,TEXT_DEFAULTS} from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import {createFolder,moveFolder,deleteEmptyFolder,folderPaths,addCustomFont,removeCustomFont,customFontFamily} from '../app/veyrnox/_lib/editorOrganization.mjs';
import {createFontRegistry,missingCustomFont,fontFormat} from '../app/veyrnox/_lib/editorCustomFonts.mjs';
import {copySelection,pasteSelection} from '../app/veyrnox/_lib/editorSelection.mjs';
import {createHistory,commitHistory,undoHistory} from '../app/veyrnox/_lib/editorHistory.mjs';
import {emptyProjectDocument,withTimeline,validProjectDocument} from '../lib/projectDocument.js';
const bytes=new Uint8Array([0,1,0,0,0,0,0,0,0,0,0,0]).buffer,sha256=createHash('sha256').update(Buffer.from(bytes)).digest('hex');
const font={family:customFontFamily(sha256),name:'Owned font',sourceName:'owned.ttf',sha256,bytes:12,format:'ttf',rights:{credit:'Font creator',usage:'Licensed for this video',url:'https://example.invalid/licence'}};
const ok=tl=>{assert.equal(tl.error,undefined);assert.equal(validateSequence(tl),null);return tl;};
test('empty folder paths round-trip and subtree moves retain source identity with undo',()=>{
    let tl=ok(createFolder(emptySequence(),'Campaign/Empty'));assert.deepEqual(folderPaths(tl),['Campaign','Campaign/Empty']);
    tl=ok(addSequenceMedia(tl,{id:'m',kind:'image',frames:90,name:'scene.png',sourceName:'original.png',folder:'Campaign/Scenes',width:10,height:10,hasAudio:false}));
    const before=tl;tl=ok(moveFolder(tl,'Campaign','Launch'));
    assert.equal(tl.media.m.folder,'Launch/Scenes');assert.equal(tl.media.m.sourceName,'original.png');assert.ok(folderPaths(tl).includes('Launch/Empty'));
    assert.match(deleteEmptyFolder(tl,'Launch').error,/Move the media/);tl=ok(deleteEmptyFolder(tl,'Launch/Empty'));assert.ok(!folderPaths(tl).includes('Launch/Empty'));
    assert.deepEqual(undoHistory(commitHistory(createHistory(before),tl)).now,before);
    const id='11111111-1111-4111-8111-111111111111',doc=withTimeline(emptyProjectDocument(id),tl);assert.equal(validProjectDocument(JSON.parse(JSON.stringify(doc)),id),true);
});
test('folder bounds reject collisions, self moves, traversal and malformed document values',()=>{
    const tl=ok(createFolder(emptySequence(),'Campaign'));
    assert.match(moveFolder(tl,'Campaign','Campaign/Child').error,/children/);assert.match(createFolder(tl,'Campaign').error,/exists/);
    for(const p of ['', '/root','root/','../bad','a//b','a/b/c/d/e','a\\b','a\u0000b','a/ b'])assert.ok(createFolder(tl,p).error,p);
    for(const folders of [null,'a',{},[null],['same','same'],Array.from({length:41},(_,i)=>`f${i}`)])assert.ok(validateSequence({...tl,folders}));
    for(const text of [null,'bad',{}])assert.ok(validateSequence({...tl,text}));
});
test('valid legacy media folder labels do not invalidate unrelated organization edits',()=>{
    for(const folder of ['a//b','/a','a/','a/ b']){
        const original=ok(addSequenceMedia(emptySequence(),{id:'legacy',kind:'image',frames:90,name:'scene.png',folder,width:10,height:10,hasAudio:false}));
        const created=ok(createFolder(original,'Campaign'));assert.deepEqual(created.folders,['Campaign']);assert.equal(created.media.legacy.folder,folder);
        const moved=ok(moveFolder(created,'Campaign','Release/Scenes'));assert.equal(moved.media.legacy.folder,folder);assert.deepEqual(moved.folders,['Release','Release/Scenes']);
        const renamed=ok(moveFolder(created,folder,'Canonical'));assert.equal(renamed.media.legacy.folder,'Canonical');assert.ok(renamed.folders.includes('Canonical'));
        const removed=ok(deleteEmptyFolder(created,'Campaign'));assert.deepEqual(removed.folders,[]);assert.equal(removed.media.legacy.folder,folder);
    }
});
test('folder moves count all destination parents before accepting the forty-path bound',()=>{
    const tl=ok({...emptySequence(),folders:Array.from({length:40},(_,i)=>`f${i}`)});
    assert.match(moveFolder(tl,'f0','new/parent/child').error,/path limits/);assert.equal(tl.folders.length,40);
    const moved=ok(moveFolder({...tl,folders:tl.folders.slice(0,38)},'f0','new/parent/child'));assert.equal(folderPaths(moved).length,40);assert.equal(moved.folders.length,40);
});
test('custom fonts require exact bounded rights/hash declarations, survive copy, and cannot be removed while used',()=>{
    let tl=ok(addCustomFont(emptySequence(),font));tl=ok(addSequenceText(tl,{text:'Custom title',style:{...TEXT_DEFAULTS,font:font.family}}));
    assert.match(removeCustomFont(tl,font.family).error,/another font/);
    const clip=copySelection(tl,[{track:'text',id:tl.text[0].id}]);const pasted=ok(pasteSelection(emptySequence(),clip,0));assert.deepEqual(pasted.fonts,[font]);
    assert.ok(validateSequence({...tl,fonts:[]}));assert.ok(validateSequence({...tl,fonts:[{...font,rights:{...font.rights,usage:''}}]}));
    assert.ok(validateSequence({...tl,fonts:[{...font,family:'font;script'}]}));assert.ok(validateSequence({...tl,fonts:[{...font,bytes:2097153}]}));
    const id='11111111-1111-4111-8111-111111111111';assert.equal(validProjectDocument(withTimeline(emptyProjectDocument(id),tl),id),true);
});
test('custom fonts load only matching bytes and export refuses missing font instead of changing appearance',async()=>{
    let loads=0;const set=new Set();class Face{constructor(f,b){this.family=f;this.bytes=b;}async load(){loads++;return this;}}
    const registry=createFontRegistry({FontFaceCtor:Face,fontSet:set});const tl=ok(addSequenceText(ok(addCustomFont(emptySequence(),font)),{style:{...TEXT_DEFAULTS,font:font.family}}));
    assert.match(missingCustomFont(tl,registry),/Relink/);await assert.rejects(registry.install(font,new Uint8Array(12).buffer),/SHA-256/);assert.equal(loads,0);
    await registry.install(font,bytes);assert.equal(missingCustomFont(tl,registry),null);assert.equal(set.size,1);registry.clear();assert.equal(set.size,0);
    assert.equal(fontFormat(new Uint8Array(bytes)),'ttf');assert.equal(fontFormat(new Uint8Array(12)),null);
});
