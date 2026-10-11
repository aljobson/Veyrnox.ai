import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { editorFeatureEnabled } from '../lib/editorRuntimeFlags.mjs';
import { parseJsonc } from '../scripts/check-migration-ledger.mjs';
import { readPublicCatalog } from '../lib/publicCatalog.js';
const names = ['EDITOR_LIBRARY_EXPORTS_ENABLED','EDITOR_ORGANIZATION_ENABLED','EDITOR_LOCAL_INFERENCE_ENABLED','EDITOR_AUDIO_STEMS_ENABLED'];
const group = {libraryExports:'true',organization:'true',localInference:'true',audioStems:'false'};
const env = flags => ({EDITOR_RUNTIME_FLAGS:JSON.stringify(flags)});
test('group preserves existing editor controls and leaves paid separation independently closed',()=>{
    for(let i=0;i<names.length;i++)assert.equal(editorFeatureEnabled(names[i],env(group)),i<3);
    assert.equal(editorFeatureEnabled(names[3],env({...group,audioStems:'true'})),true);
    assert.equal(editorFeatureEnabled(names[0],env({...group,organization:'false'})),true);
    assert.equal(editorFeatureEnabled(names[1],env({...group,organization:'false'})),false);
    assert.equal(editorFeatureEnabled('CINEMA_UNLOCKS_ENABLED',env(group)),false);
});
test('malformed/missing/unknown grouped values fail closed; explicit legacy false overrides grouped true',()=>{
    for(const value of [undefined,'broken','null','[]','true',JSON.stringify({...group,other:'true'}),JSON.stringify({...group,localInference:true}),JSON.stringify({...group,audioStems:'TRUE'}),' '.repeat(1025)]){
        for(const name of names)assert.equal(editorFeatureEnabled(name,{EDITOR_RUNTIME_FLAGS:value}),false);
    }
    assert.equal(editorFeatureEnabled(names[0],env({})),false);
    for(const value of ['false','TRUE',true,undefined])assert.equal(editorFeatureEnabled(names[0],{...env(group),[names[0]]:value}),false);
    assert.equal(editorFeatureEnabled(names[3],{...env(group),[names[3]]:'true'}),true);
    assert.equal(editorFeatureEnabled(names[0],null),false);
});
test('committed production group retains existing behavior without widening any paid or unrelated gate',()=>{
    const config=parseJsonc(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
    for(const name of names.slice(0,3))assert.equal(editorFeatureEnabled(name,config.vars),true);
    assert.equal(editorFeatureEnabled(names[3],config.vars),false);
    for(const name of names)assert.equal(editorFeatureEnabled(name,config.env.staging.vars),true);
    for(const name of ['PROJECT_MEDIA_UPLOADS_ENABLED','PUBLISH_VIDEO_DESTINATIONS_ENABLED','CINEMA_SUBSCRIPTIONS_ENABLED','CINEMA_UNLOCKS_ENABLED'])assert.equal(config.vars[name],'false');
    assert.equal(Object.keys(config.vars).filter(k=>names.includes(k)).length,0);
});
test('public catalog cache partitions the resolved paid gate so stale entries cannot hide activation or defeat rollback',async()=>{
    const old={caches:globalThis.caches,group:process.env.EDITOR_RUNTIME_FLAGS,legacy:process.env.EDITOR_AUDIO_STEMS_ENABLED};
    const rows=[{id:'demucs-stems',name:'Demucs',modality:'audio-to-audio',credits_5s:6,provider_endpoint:'fal-ai/demucs',gated_flag:false}];
    const cache=new Map();let reads=0;
    globalThis.caches={default:{match:async key=>cache.get(key)?.clone(),put:async(key,response)=>cache.set(key,response.clone())}};
    const args={cfg:{supabaseUrl:'https://test.invalid',serviceRoleKey:'test-only'},selectRows:async()=>{reads++;return rows;}};
    try{
        delete process.env.EDITOR_AUDIO_STEMS_ENABLED;
        process.env.EDITOR_RUNTIME_FLAGS=JSON.stringify(group);
        assert.equal((await readPublicCatalog(args))[0].gated,true);
        process.env.EDITOR_RUNTIME_FLAGS=JSON.stringify({...group,audioStems:'true'});
        assert.equal((await readPublicCatalog(args))[0].gated,false);
        process.env.EDITOR_AUDIO_STEMS_ENABLED='false';
        assert.equal((await readPublicCatalog(args))[0].gated,true);
        assert.equal(reads,2);assert.equal(cache.size,2);
    }finally{
        if(old.caches===undefined)delete globalThis.caches;else globalThis.caches=old.caches;
        for(const [key,value] of [['EDITOR_RUNTIME_FLAGS',old.group],['EDITOR_AUDIO_STEMS_ENABLED',old.legacy]])if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
});
