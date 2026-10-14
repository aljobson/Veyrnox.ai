import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyMediaPreferences,noteRecentMedia,readMediaPreferences,toggleMediaFavorite,writeMediaPreferences } from '../app/veyrnox/_lib/editorMediaPreferences.mjs';

class Storage{values=new Map();getItem(key){return this.values.get(key)??null;}setItem(key,value){this.values.set(key,value);}}
test('media favorites and recents are account scoped, unique and bounded',()=>{
    const storage=new Storage();let value=emptyMediaPreferences();value=toggleMediaFavorite(value,'source-1');value=noteRecentMedia(value,'source-1');value=noteRecentMedia(value,'source-1');
    writeMediaPreferences(storage,'guest',value);assert.deepEqual(readMediaPreferences(storage,'guest'),{favorites:['source-1'],recent:['source-1']});assert.deepEqual(readMediaPreferences(storage,'another'),emptyMediaPreferences());
    for(let i=0;i<30;i++)value=noteRecentMedia(value,`m-${i}`);assert.equal(value.recent.length,20);assert.equal(value.recent[0],'m-29');
});
