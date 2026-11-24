import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { ownerProofEligible, OWNER_PROOF_OFFERS } from '../lib/ownerProof.js';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env,{SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',PUBLIC_HOST:'https://veyrnox.test',CRUN_ENABLED:'true',CRUN_API_KEY:'test',R2_ACCOUNT_ID:'test',R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test',R2_BUCKET:'test'});
const { developerApi }=await import('../lib/developerApi.js');
const { POST:MCP }=await import('../app/api/v1/mcp/route.js');
const { POST }=await import('../app/api/v1/generations/route.js');
const { POST:QUOTE }=await import('../app/api/v1/generations/quote/route.js');
const AUTH='11111111-1111-4111-8111-111111111111',ASSET='22222222-2222-4222-8222-222222222222';
const seedance=id=>id.startsWith('seedance');
const row=id=>({id,provider:'crun',provider_endpoint:seedance(id)?`crun:bytedance/seedance2-5-r2v:${id.endsWith('edit')?'edit':'extend'}`:`crun:google/veo3-1-${id.includes('lite')?'lite-':id.includes('fast')?'fast-':''}t2v`,active:!seedance(id),gated_flag:seedance(id),modality:seedance(id)?'video-to-video':'text-to-video',credits_5s:76});
const body=id=>({model_id:id,idempotency_key:'proof-access-test',confirmed_credits:76,consent:true,references:[{slot:seedance(id)?'video':'image',origin:'asset',asset_id:ASSET}],inputs:{prompt:'Move slowly',...(id.endsWith('extend')?{duration_seconds:5}:{})}});
const request=(path,data,oauth=false)=>new Request(`https://veyrnox.test${path}`,{method:'POST',headers:{'content-type':'application/json',accept:'application/json, text/event-stream','x-veyrnox-auth-id':AUTH,'x-veyrnox-auth-aal':'aal2',...(oauth?{'x-veyrnox-auth-client-id':'consented-app'}:{})},body:JSON.stringify(data)});
for(const id of OWNER_PROOF_OFFERS) {
    test(`${id}: admin aal2 OAuth never reads the role`,async()=>{
        assert.equal(await ownerProofEligible(request('/api/v1/generations',body(id),true),{}, {modelId:id,env:{APP_RUNTIME_FLAGS:'{"ownerProof":true}'},read:()=>assert.fail('OAuth must be excluded before role read')}),false);
    });
    for(const surface of ['Developer API','MCP']) test(`${surface}: admin aal2 OAuth ${id} matches switch-off and cannot debit`,async t=>{
        const paths=[];
        t.mock.method(globalThis,'fetch',async url=>{
            const path=new URL(String(url)).pathname;paths.push(path);
            if(path.endsWith('/model_catalog'))return Response.json([row(id)]);
            if(path.endsWith('/rpc/check_generation_rate_limit'))return Response.json({ok:true});
            if(path.endsWith('/jobs'))return Response.json([]);
            if(path.endsWith('/users')) { assert.doesNotMatch(new URL(String(url)).searchParams.get('select') || '', /is_admin/); return Response.json([{id:AUTH,auth_id:AUTH,is_admin:true}]); }
            assert.fail(`Unexpected call ${path}`);
        });
        const previous=process.env.APP_RUNTIME_FLAGS;t.after(()=>{if(previous===undefined)delete process.env.APP_RUNTIME_FLAGS;else process.env.APP_RUNTIME_FLAGS=previous;});
        const results=[];
        for(const enabled of [false,true]) {
            process.env.APP_RUNTIME_FLAGS=JSON.stringify({ownerProof:enabled});
            if(surface==='Developer API') {
                const response=await developerApi(request('/api/v1/developer/generations',body(id),true),['generations']);
                results.push({status:response.status,body:await response.json()});
                assert.ok(response.status>=400);
            } else {
                const response=await MCP(request('/api/v1/mcp',{jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'generate_video',arguments:{model_id:id,prompt:'Move slowly',confirmed_credits:76,user_approved:true,idempotency_key:'proof-access-test',consent:true,source_assets:[{slot:seedance(id)?'video':'image',asset_id:ASSET}]}}},true));
                const raw=await response.text(), result=JSON.parse(raw.includes('data:')?raw.split('data:').pop().trim():raw).result;
                assert.equal(result.isError,true,raw);results.push(result);
            }
        }
        assert.deepEqual(results[1],results[0]);
        assert.ok(!paths.some(path=>/ledger_debit/.test(path)),JSON.stringify(paths));
    });
}

for(const id of ['seedance-2.5-edit','seedance-2.5-extend','veo-3.1-lite-kie']) for(const kind of (seedance(id)?['missing-key','invalid-key','template','valid']:['template'])) {
    test(`non-admin ${id} ${kind}: switch does not change limiter count`,async t=>{
        let calls=[];
        t.mock.method(globalThis,'fetch',async url=>{
            const path=new URL(String(url)).pathname;calls.push(path);
            if(path.endsWith('/rpc/check_generation_rate_limit'))return Response.json({ok:true});
            if(path.endsWith('/users'))return Response.json([{id:AUTH,is_admin:false}]);
            if(path.endsWith('/jobs'))return Response.json([]);
            assert.fail(path);
        });
        const b=body(id);
        if(kind==='missing-key')delete b.idempotency_key;
        if(kind==='invalid-key')b.idempotency_key='';
        if(kind==='template')b.template_id='unavailable-template';
        const previous=process.env.APP_RUNTIME_FLAGS;t.after(()=>{if(previous===undefined)delete process.env.APP_RUNTIME_FLAGS;else process.env.APP_RUNTIME_FLAGS=previous;});
        const results=[];
        for(const enabled of [false,true]) {
            calls=[];process.env.APP_RUNTIME_FLAGS=JSON.stringify({ownerProof:enabled});
            const response=await POST(request('/api/v1/generations',b));
            results.push({status:response.status,body:await response.text(),limiter:calls.filter(path=>path.includes('/rpc/')).length});
        }
        assert.deepEqual(results[1],results[0]);
        assert.equal(results[1].limiter,kind==='valid'||!seedance(id)?1:0);
    });
}

const verdicts={RATE_LIMITED:{ok:false,code:'RATE_LIMITED',limit:20,count:20,retry_after_seconds:17},AI_DISABLED:{ok:false,code:'AI_DISABLED'},USER_NOT_FOUND:{ok:false,code:'USER_NOT_FOUND'}};
for(const id of OWNER_PROOF_OFFERS) for(const opened of (seedance(id)?[false,true]:[true])) for(const kind of ['RATE_LIMITED','AI_DISABLED','USER_NOT_FOUND','RPC_FAILURE','missing-key','invalid-inputs']) {
    test(`${id} opened=${opened} ${kind}: non-admin switch-on/off bytes and rate counts match`,async t=>{
        let calls=[];
        t.mock.method(globalThis,'fetch',async url=>{
            const path=new URL(String(url)).pathname;calls.push(path);
            if(path.endsWith('/users'))return Response.json([{id:AUTH,is_admin:false}]);
            if(path.endsWith('/jobs'))return Response.json([]);
            assert.ok(path.endsWith('/rpc/check_generation_rate_limit'),path);
            if(kind==='RPC_FAILURE')throw Error('offline');
            return Response.json(verdicts[kind]??{ok:true});
        });
        const previous=process.env.APP_RUNTIME_FLAGS;t.after(()=>{if(previous===undefined)delete process.env.APP_RUNTIME_FLAGS;else process.env.APP_RUNTIME_FLAGS=previous;});
        const b=body(id);if(kind==='missing-key')delete b.idempotency_key;if(kind==='invalid-inputs')b.inputs=null;
        const results=[];
        for(const enabled of [false,true]) {
            calls=[];process.env.APP_RUNTIME_FLAGS=JSON.stringify({ownerProof:enabled,seedance25:opened});
            const response=await POST(request('/api/v1/generations',b));
            results.push({status:response.status,text:await response.text(),retry:response.headers.get('retry-after'),rate:calls.filter(path=>path.includes('/rpc/')).length});
        }
        assert.deepEqual(results[1],results[0]);
        const early=kind==='missing-key'||(kind==='invalid-inputs'&&opened);
        assert.equal(results[1].rate,early?0:1);
        if(kind==='missing-key')assert.equal(results[1].status,opened?400:404);
        else if(!opened)assert.equal(results[1].status,404);
        else assert.equal(results[1].status,{RATE_LIMITED:429,AI_DISABLED:403,USER_NOT_FOUND:409,RPC_FAILURE:503,'invalid-inputs':400}[kind]);
    });
}
for(const id of ['seedance-2.5-edit','seedance-2.5-extend']) for(const kind of ['RATE_LIMITED','AI_DISABLED','USER_NOT_FOUND','RPC_FAILURE']) for(const quote of [false,true]) {
    test(`verified admin ${id} ${quote?'quote':'submit'} ${kind}: existing opened-offer mapping`,async t=>{
        let admin=false,calls=[];
        t.mock.method(globalThis,'fetch',async url=>{
            const path=new URL(String(url)).pathname;calls.push(path);
            if(path.endsWith('/users'))return Response.json([{is_admin:admin}]);
            assert.ok(path.includes('/rpc/'),path);
            if(kind==='RPC_FAILURE')throw Error('offline');
            return Response.json(verdicts[kind]);
        });
        const previous=process.env.APP_RUNTIME_FLAGS;t.after(()=>{if(previous===undefined)delete process.env.APP_RUNTIME_FLAGS;else process.env.APP_RUNTIME_FLAGS=previous;});
        const results=[];
        for(const proof of [false,true]) {
            admin=proof;calls=[];process.env.APP_RUNTIME_FLAGS=JSON.stringify({ownerProof:proof,seedance25:!proof});
            const response=await (quote?QUOTE:POST)(request('/api/v1/generations',body(id)));
            results.push({status:response.status,text:await response.text(),retry:response.headers.get('retry-after')});
            assert.equal(calls.filter(path=>path.includes('/rpc/')).length,1);
        }
        assert.deepEqual(results[1],results[0]);
        assert.equal(results[1].status,quote?(kind==='RATE_LIMITED'?429:503):{RATE_LIMITED:429,AI_DISABLED:403,USER_NOT_FOUND:409,RPC_FAILURE:503}[kind]);
    });
}
for(const opened of [false,true]) for(const malformed of [false,true]) for(const kind of ['RATE_LIMITED','AI_DISABLED','USER_NOT_FOUND','RPC_FAILURE']) test(`non-admin quote opened=${opened} malformed=${malformed} ${kind}: unchanged response and attempts`,async t=>{
    let calls=[];
    t.mock.method(globalThis,'fetch',async url=>{
        const path=new URL(String(url)).pathname;calls.push(path);
        if(path.endsWith('/users'))return Response.json([{is_admin:false}]);
        assert.ok(path.endsWith('/rpc/consume_seedance25_quote_request'),path);
        if(kind==='RPC_FAILURE')throw Error('offline');return Response.json(verdicts[kind]);
    });
    const previous=process.env.APP_RUNTIME_FLAGS;t.after(()=>{if(previous===undefined)delete process.env.APP_RUNTIME_FLAGS;else process.env.APP_RUNTIME_FLAGS=previous;});
    const b=body('seedance-2.5-edit');if(malformed)b.inputs=null;
    const results=[];
    for(const enabled of [false,true]){
        calls=[];process.env.APP_RUNTIME_FLAGS=JSON.stringify({ownerProof:enabled,seedance25:opened});
        const response=await QUOTE(request('/api/v1/generations/quote',b));
        results.push({status:response.status,text:await response.text(),rate:calls.filter(path=>path.includes('/rpc/')).length});
    }
    assert.deepEqual(results[1],results[0]);assert.equal(results[1].rate,opened&&!malformed?1:0);
});
