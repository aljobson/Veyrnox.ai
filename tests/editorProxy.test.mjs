import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyTimeline,proxyCacheProblem,PROXY_CACHE_BYTES } from '../app/veyrnox/_lib/editorProxy.mjs';
import { validateSequence } from '../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { sourceFrame } from '../app/veyrnox/_lib/editorSequence.mjs';
test('proxy document preserves source timing/aspect and excludes sound and edits',()=>{
    const m={id:'source',kind:'video',frames:120,name:'Source',hasAudio:true,width:1920,height:1080},tl=proxyTimeline(m);assert.equal(validateSequence(tl),null);assert.equal(tl.aspect,'source');assert.equal(tl.video[0].volume,0);assert.equal(tl.video[0].len,120);
    for(let i=0;i<120;i++)assert.equal(sourceFrame(tl.video[0],i),i);assert.equal(tl.video[0].filter,undefined);assert.equal(proxyTimeline({...m,kind:'image'}).error!==undefined,true);
});
test('proxy replacements count only current retained bytes and never evict other sources',()=>{
    const proxies=new Map([['one',{size:PROXY_CACHE_BYTES-10}],['two',{size:10}]]);assert.equal(proxyCacheProblem(proxies,'two',{size:10}),null);assert.ok(proxyCacheProblem(proxies,'three',{size:1}));assert.equal(proxies.size,2);
});
