import test from 'node:test';
import assert from 'node:assert/strict';
import {generationFileProblem,uploadGenerationSources} from '../app/veyrnox/_lib/editorGenerationUploads.mjs';
import {generationSources} from '../app/veyrnox/_lib/editorGeneration.mjs';
const photo=new File(['image bytes'],'frame.png',{type:'image/png'}),audio=new File(['wav bytes'],'speech.wav',{type:'audio/wav'});
const model={media:{image:{required:true},endImage:{required:false}}};
const source=(file,localId)=>({file,localId,mimeType:file.type,label:file.name});
test('device sources retain role/identity, mixed Library references and strict consent',()=>{
    const id='11111111-1111-4111-8111-111111111111';
    const prepared=generationSources(model,{image:source(photo,'a'),endImage:{assetId:id,mimeType:'image/png'}},true);
    assert.deepEqual(prepared.assets,[{asset_id:id,slot:'endImage'}]);
    assert.equal(prepared.uploads[0].file,photo);assert.equal(prepared.uploads[0].slot,'image');
    assert.ok(generationSources(model,{image:source(photo,'a')},false).error);
    assert.ok(generationSources(model,{image:source(audio,'a')},true).error);
    assert.ok(generationFileProblem('image',new File([],'empty.png',{type:'image/png'})));
    assert.ok(generationFileProblem('image',new File([new Uint8Array(20*1024*1024+1)],'large.png',{type:'image/png'})));
    assert.equal(generationFileProblem('audio',new File(['wav'],'speech.wav',{type:'audio/x-wav'})),null);
});
test('partial source upload retry reuses the completed owned key and produces explicit frame roles',async()=>{
    const uploads=[{slot:'image',...source(photo,'a')},{slot:'endImage',...source(photo,'b')}],keys=new Map(),calls=[];
    let requestCount=0,failed=false;
    const request=async(path,init)=>{calls.push([path,JSON.parse(init.body)]);const n=++requestCount;return{key:`owned-${n}`,upload_url:`https://uploads.test/${n}`,content_type:'image/png'};};
    const put=async(url,init)=>{calls.push([url,init.body]);if(url.endsWith('/2')&&!failed){failed=true;return new Response(null,{status:503});}return new Response(null,{status:200});};
    await assert.rejects(uploadGenerationSources(uploads,{request,put,keys,current:()=>true}),/upload failed/);
    assert.equal(keys.get('image:a'),'owned-1');
    const result=await uploadGenerationSources(uploads,{request,put,keys,current:()=>true});
    assert.deepEqual(result,[{key:'owned-1',slot:'image'},{key:'owned-3',slot:'endImage'}]);
    assert.equal(requestCount,3);assert.equal(calls.filter(([url])=>url==='https://uploads.test/1').length,1);
    assert.deepEqual(calls[0][1],{content_type:'image/png',size_bytes:photo.size});
});
test('account change and cancellation stop before upload dispatch and return no source plan',async()=>{
    const uploads=[{slot:'image',...source(photo,'a')}];let puts=0,current=true;
    const request=async()=>{current=false;return{upload_url:'https://uploads.test/1',key:'owned'};};
    await assert.rejects(uploadGenerationSources(uploads,{request,put:async()=>{puts++;},current:()=>current}),/Account changed/);
    assert.equal(puts,0);
    const controller=new AbortController();controller.abort();
    await assert.rejects(uploadGenerationSources(uploads,{signal:controller.signal,current:()=>true,request:async()=>{throw new Error('should not request');}}),e=>e.name==='AbortError');
});
