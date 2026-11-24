import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as overlay from '../lib/ownerProofOverlay.mjs';
import { mediaGenerationSources } from '../app/veyrnox/_lib/chatMedia.js';

const token = aal => `e30.${Buffer.from(JSON.stringify({aal,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')}.signature`;
const privateModel={id:'veo-3.1-lite-kie',media:{image:{maxFiles:1}}};
const settle=async()=>{for(let n=0;n<12;n++)await Promise.resolve();};
// Execute the actual hooks with controlled effects, sessions and network timing.
function harness(client, aal='aal2') {
    let instance, cursor=0, pending=[];
    let owner='owner', generation=1, status='signedIn', canReloadSession=()=>true;
    let accessToken=token(aal);
    const listeners=new Set(), requests=[], instances=new Map();
    const react={
        useEffect(fn,deps){const i=cursor++;if(!instance.effects[i] || deps.some((v,j)=>v!==instance.effects[i].deps[j])){const target=instance;pending.push(()=>{target.effects[i]?.cleanup?.();target.effects[i]={deps,cleanup:fn()};});}},
        useMemo(fn,deps){const i=cursor++;if(!instance.memos[i] || deps.some((v,j)=>v!==instance.memos[i].deps[j]))instance.memos[i]={deps,value:fn()};return instance.memos[i].value;},
        useSyncExternalStore(_subscribe,snapshot){cursor++;return snapshot();},
    };
    const load=(path,options)=>{assert.ok(path.endsWith('/owner-proof'));assert.equal(options.cache,'no-store');assert.match(options.headers.Authorization,/^Bearer /);return new Promise((resolve,reject)=>requests.push({resolve:data=>resolve(Response.json(data)),reject,refuse:status=>resolve(Response.json({error:'refused'},{status}))}));};
    const sessionGeneration=()=>generation, getDiscoveryToken=()=>accessToken;
    const shared={...overlay,readOwnerProof:(path,value)=>overlay.readOwnerProof(path,value,load)};
    const dependencies={react,
        '../../lib/authClient.js':{getStoredSession:()=>owner?{user:{id:owner}}:null,getAccessToken:()=>accessToken,onSessionChange:fn=>{listeners.add(fn);return ()=>listeners.delete(fn);}},
        './useCatalog.js':{fromApi:models=>models},
        '../auth/AuthProvider':{useAuth:()=>({status,generation,sessionGeneration,canReloadSession,getDiscoveryToken})},
        'react-native':{AppState:{addEventListener:(_name,fn)=>{listeners.add(fn);return {remove:()=>listeners.delete(fn)};}}},
        './publicModelIds':{internalModelId:id=>id}, './media':{isSupported:()=>true}, './api':{API_BASE:'https://veyrnox.test'},
        '../../../lib/ownerProofOverlay.mjs':shared, '../../../../lib/ownerProofOverlay.mjs':shared,
    };
    const path=client==='web'?'app/veyrnox/_lib/useOwnerProofModels.js':'apps/mobile/src/lib/useOwnerProofModels.ts';
    const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    const module={exports:{}};
    new Function('require','module','exports','window',code)(id=>{assert.ok(dependencies[id],id);return dependencies[id];},module,module.exports,{addEventListener(_event,fn){listeners.add(fn);},removeEventListener(_event,fn){listeners.delete(fn);}});
    return {requests,
        render(key=0){if(!instances.has(key))instances.set(key,{effects:[],memos:[]});instance=instances.get(key);cursor=0;return module.exports.useOwnerProofModels();},
        flush(){for(const run of pending.splice(0))run();},
        change(next){owner=next;generation++;status=next?'signedIn':'signedOut';if(client==='web')for(const fn of listeners)fn();},
        reviseSession(aal='aal2'){accessToken=token(aal);canReloadSession=()=>true;if(client==='web')for(const fn of listeners)fn();},
        focus(state='active'){for(const fn of listeners)fn(state);},
    };
}
for(const client of ['web','phone']) {
    test(`${client}: same-session focus and token revalidation retain the image slot and pending pick`,async()=>{
        const h=harness(client);h.render();h.flush();await settle();assert.equal(h.requests.length,1);
        h.requests[0].resolve({models:[privateModel]});await settle();
        let finishPick;
        const picking = new Promise(resolve => { finishPick = resolve; });
        if(client==='phone'){h.focus('inactive');h.focus('background');await settle();assert.equal(h.requests.length,1);assert.deepEqual(h.render()[0],privateModel);}
        h.focus();await settle();assert.equal(h.requests.length,2);assert.deepEqual(h.render(),[privateModel]);
        // Repeated focus / two surfaces share the in-flight request.
        h.focus();h.render(1);h.flush();await settle();assert.equal(h.requests.length,2);
        // The native/browser picker returns while discovery is still pending.
        finishPick({file:{name:'proof.png'}});
        const attached={image:await picking};
        const sources=await mediaGenerationSources(h.render()[0],attached,async file=>{assert.equal(file.name,'proof.png');return 'uploads/proof.png';});
        assert.deepEqual(sources.references,[{slot:'image',origin:'upload',key:'uploads/proof.png'}]);
        h.requests[1].reject(Error('network interrupted'));await settle();assert.deepEqual(h.render(),[privateModel]);
        h.reviseSession();h.render();h.flush();await settle();assert.deepEqual(h.render(),[privateModel]);
        h.requests.at(-1).resolve({models:[privateModel]});await settle();
        h.focus();await settle();h.requests.at(-1).refuse(404);await settle();assert.deepEqual(h.render(),[]);
    });
    test(`${client}: delayed responses cannot cross identities or session loss`,async()=>{
        const h=harness(client);h.render();h.flush();await settle();const old=h.requests[0];
        h.change('customer');assert.deepEqual(h.render(),[]);h.flush();await settle();old.resolve({models:[privateModel]});await settle();assert.deepEqual(h.render(),[]);
        h.requests.at(-1).refuse(403);await settle();assert.deepEqual(h.render(),[]);
        h.change('owner');h.render();h.flush();await settle();h.requests.at(-1).resolve({models:[privateModel]});await settle();assert.deepEqual(h.render(),[privateModel]);
        h.focus();await settle();const late=h.requests.at(-1);h.change(null);assert.deepEqual(h.render(),[]);h.flush();late.resolve({models:[privateModel]});await settle();assert.deepEqual(h.render(),[]);
    });
    test(`${client}: aal1 customers make no discovery request; step-up shares one request`,async()=>{
        const h=harness(client,'aal1');h.render();h.render(1);h.flush();h.focus();await settle();assert.equal(h.requests.length,0);
        h.reviseSession();h.render();h.render(1);h.flush();await settle();assert.equal(h.requests.length,1);
        h.requests[0].refuse(401);await settle();assert.deepEqual(h.render(),[]);
    });
}
test('ordinary web catalog page never mounts private discovery; private fetch has no auth side effects',async()=>{
    const catalog=readFileSync('app/veyrnox/_lib/useCatalog.js','utf8');
    assert.doesNotMatch(catalog,/ownerProof|owner-proof/);
    for(const status of [401,403,404]) await assert.rejects(overlay.readOwnerProof('/api/v1/owner-proof','token',async()=>Response.json({}, {status})),error=>error.status===status);
    const source=readFileSync('lib/ownerProofOverlay.mjs','utf8');
    assert.doesNotMatch(source,/gatewayFetch|clearSession|signOut|stepUp|localStorage|AsyncStorage/);
});
test('explicit strict serialization refuses an attached source before any upload or generation',async()=>{
    for(const slot of ['image','endImage','video','audio']) {
        let sent=0,uploaded=0;
        const submit=async()=>{await mediaGenerationSources({id:'veo-3.1-lite-kie',media:{}},{[slot]:{file:{name:'source'}}},()=>{uploaded++;},{strict:true});sent++;};
        await assert.rejects(submit(),error=>error.code==='source_type_unsupported');assert.equal(sent,0);assert.equal(uploaded,0);
    }
    const create=readFileSync('app/veyrnox/app/create/page.js','utf8');
    assert.match(create,/if \(unsupportedSource\) \{ setError\(LOCAL_ERRORS.source_type_unsupported\); return; \}/);
    assert.match(create,/role="alert"[^\n]+source_type_unsupported/);
});
test('phone overlay never enters public catalog promise or persistent cache',()=>{
    const source=readFileSync('apps/mobile/src/lib/media.ts','utf8');
    assert.doesNotMatch(source,/ownerProof|owner-proof/);
    assert.match(source,/policy: POLICIES.catalog, fetcher: \(\) => observe\(fetchCatalog\(\)\)/);
    const hook=readFileSync('apps/mobile/src/lib/useOwnerProofModels.ts','utf8');
    assert.doesNotMatch(hook,/appCache|AsyncStorage|localStorage/);
});

test('actual Create submit handler refuses a stranded attachment before any request',async()=>{
    const source=readFileSync('app/veyrnox/app/create/page.js','utf8');
    const ast=ts.createSourceFile('page.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX);
    let handler;
    function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='onSubmit')handler=node.getText(ast);ts.forEachChild(node,visit);}
    visit(ast);assert.ok(handler);
    let error, requests=0;
    const context={draftRecovery:{},attachConverting:false,sourcesConverting:false,inFlight:{current:false},sending:false,generating:false,model:{id:'veo-3.1-lite-kie',media:{}},balance:100,payable:1,unsupportedSource:true,LOCAL_ERRORS:{source_type_unsupported:{code:'source_type_unsupported'}},setError:value=>{error=value;},gatewayFetch:()=>{requests++;}};
    const submit=new Function(...Object.keys(context),`${handler}; return onSubmit;`)(...Object.values(context));
    await submit();assert.deepEqual(error,{code:'source_type_unsupported'});assert.equal(requests,0);assert.equal(context.inFlight.current,false);
});
test('actual public catalog hook on a signed-in page only loads the public catalog',async()=>{
    const source=readFileSync('app/veyrnox/_lib/useCatalog.js','utf8');
    const requests=[],effects=[];
    const dependencies={
        react:{useState:value=>[value,()=>{}],useEffect:fn=>effects.push(fn)},
        './tokens.js':{MODELS:[],kindOf:()=> 'video'},
        '../../../lib/fallbackModelCapabilities.js':{fallbackCapabilitiesFor:()=>({})},
        '../../../lib/generationPromptLimits.js':{GENERATION_PROMPT_MAX:30000},
        '../../../lib/publicModelIds.js':{internalModelId:id=>id},
    };
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
    const module={exports:{}};
    new Function('require','module','exports','fetch',code)(id=>{assert.ok(dependencies[id],id);return dependencies[id];},module,module.exports,async path=>{requests.push(path);return Response.json({models:[{id:'public',modality:'text-to-video'}]});});
    module.exports.useCatalog();for(const effect of effects)effect();await settle();
    assert.deepEqual(requests,['/api/catalog']);
});
