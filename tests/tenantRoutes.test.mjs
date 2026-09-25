import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('data:text/javascript,'+encodeURIComponent(`export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}`));
const { middleware } = await import('../middleware.js');
const { GET, POST } = await import('../app/api/v1/projects/route.js');
const { GET: getProject, PATCH } = await import('../app/api/v1/projects/[id]/route.js');
const { _resetJwksCache } = await import('../lib/supabaseJwt.js');
const userId=crypto.randomUUID(), workspaceId=crypto.randomUUID(), projectId=crypto.randomUUID();
Object.assign(process.env,{ APP_ENV:'development', PUBLIC_HOST:'http://localhost:3000', SUPABASE_URL:'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_local_test', TENANT_PROJECTS_ENABLED:'true', SUPABASE_SERVICE_ROLE_KEY:'must-never-be-used' });
const originalFetch=globalThis.fetch;
test.after(()=>{globalThis.fetch=originalFetch;});
function request(path='',body,headers={}) {
    return new Request(`http://localhost:3000/api/v1/projects${path}`,{method:body===undefined?'GET':'POST',headers:{'x-veyrnox-auth-id':userId,'x-request-id':crypto.randomUUID(),authorization:'Bearer user-token','content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
test('middleware refuses spoofed identity without a real bearer token',async()=>{
    const response=await middleware(new Request('http://localhost:3000/api/v1/projects',{headers:{'x-veyrnox-auth-id':userId,'x-veyrnox-auth-aal':'aal2'}}));
    assert.equal(response.status,401);
    assert.match(response.headers.get('x-request-id'),/^[a-f0-9-]{36}$/);
});
test('middleware overwrites forged headers, retains recent MFA handling and never trusts tenant headers',async()=>{
    _resetJwksCache();
    const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
    const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);
    const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
    const h=encode({alg:'ES256',kid:'test'}), p=encode({sub:userId,iss:process.env.SUPABASE_URL+'/auth/v1',aud:'authenticated',exp:Date.now()/1000+300,aal:'aal1'});
    const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,new TextEncoder().encode(`${h}.${p}`));
    globalThis.fetch=async()=>Response.json({keys:[{...jwk,kid:'test'}]});
    const response=await middleware(new Request('http://localhost:3000/api/v1/projects',{headers:{authorization:`Bearer ${h}.${p}.${Buffer.from(signature).toString('base64url')}`,'x-veyrnox-auth-id':crypto.randomUUID(),'x-veyrnox-auth-aal':'aal2','x-veyrnox-organisation-id':workspaceId,'x-request-id':'forged'}}));
    assert.equal(response.headers.get('x-middleware-request-x-veyrnox-auth-id'),userId);
    assert.equal(response.headers.get('x-middleware-request-x-veyrnox-auth-aal'),'aal1');
    assert.equal(response.headers.get('x-middleware-request-x-veyrnox-organisation-id'),null);
    assert.notEqual(response.headers.get('x-request-id'),'forged');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('project API uses the user JWT and public key, leaving authorization to RLS',async()=>{
    globalThis.fetch=async(url,init)=>{
        assert.equal(init.headers.authorization,'Bearer user-token');
        assert.equal(init.headers.apikey,'sb_publishable_local_test');
        assert.ok(!JSON.stringify(init).includes('must-never-be-used'));
        assert.match(url.toString(),new RegExp(`workspace_id=eq.${workspaceId}`));
        return Response.json([]);
    };
    const response=await GET(request(`?workspace_id=${workspaceId}`));
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{projects:[]});
    assert.equal(response.headers.get('cache-control'),'private, no-store');
});
test('not-found response is identical when RLS hides a cross-tenant object',async()=>{
    globalThis.fetch=async()=>Response.json([]);
    const response=await getProject(request(`/${projectId}`),{params:Promise.resolve({id:projectId})});
    assert.equal(response.status,404);
    assert.equal((await response.json()).error.code,'NOT_FOUND');
});
test('project inputs reject ownership injection before any database call',async()=>{
    globalThis.fetch=async()=>{throw new Error('database must not be called');};
    const response=await POST(request('',{workspace_id:workspaceId,name:'Hello',owner_id:userId},{'idempotency-key':'project-key-123'}));
    assert.equal(response.status,400);
    const update=await PATCH(request(`/${projectId}`,{name:'Hi',version:1,workspace_id:workspaceId}),{params:{id:projectId}});
    assert.equal(update.status,400);
});
test('database conflicts and failures map to safe responses without upstream detail',async()=>{
    globalThis.fetch=async()=>Response.json({message:'secret SQL database host'},{status:409});
    const response=await POST(request('',{workspace_id:workspaceId,name:'Hello'},{'idempotency-key':'project-key-123'}));
    assert.equal(response.status,409);
    assert.ok(!(await response.text()).includes('database host'));
});
test('feature is unavailable before controlled migration activation',async()=>{
    delete process.env.TENANT_PROJECTS_ENABLED;
    try { assert.equal((await GET(request(`?workspace_id=${workspaceId}`))).status,404); }
    finally {process.env.TENANT_PROJECTS_ENABLED='true';}
});
