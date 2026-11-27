import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { ownerProofEligible, ownerProofCapability, OWNER_PROOF_OFFERS } from '../lib/ownerProof.js';
import { capabilityFor } from '../lib/modelCapabilities.js';
import { createOwnerProofOverlay, mergeOwnerProofModels } from '../lib/ownerProofOverlay.mjs';
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
const req = (aal = 'aal2') => new Request('https://veyrnox.test/api/v1/owner-proof', { headers: { 'x-veyrnox-auth-id': 'owner', 'x-veyrnox-auth-aal': aal, 'x-owner-proof': 'true' } });
const on = { APP_RUNTIME_FLAGS: '{"ownerProof":true}' };
test('eligibility is exact, freshly read, scoped to five offers and fail-closed', async () => {
    let calls = 0, admin = true;
    const read = async (table, options) => { calls++; assert.equal(table, 'users'); assert.equal(options.filter, 'auth_id=eq.owner'); return [{ is_admin: admin }]; };
    for (const modelId of OWNER_PROOF_OFFERS) assert.equal(await ownerProofEligible(req(), {}, { modelId, read, env: on }), true);
    assert.equal(calls, 5);
    admin = false;
    assert.equal(await ownerProofEligible(req(), {}, { read, env: on }), false);
    for (const value of [[], null, [{ is_admin: 'true' }], [{ is_admin: true }, { is_admin: true }]])
        assert.equal(await ownerProofEligible(req(), {}, { read: async () => value, env: on }), false);
    assert.equal(await ownerProofEligible(req(), {}, { read: async () => { throw Error('offline'); }, env: on }), false);
    const noRead = async () => assert.fail('must not read');
    for (const env of [{}, { APP_RUNTIME_FLAGS: '{' }, { APP_RUNTIME_FLAGS: '{"ownerProof":"true"}' }])
        assert.equal(await ownerProofEligible(req(), {}, { read: noRead, env }), false);
    assert.equal(await ownerProofEligible(req('aal1'), {}, { read: noRead, env: on }), false);
    assert.equal(await ownerProofEligible(req(), {}, { modelId: 'other', read: noRead, env: on }), false);
});
test('Veo projection is request local and one-image only', () => {
    const row = { id: 'veo-3.1-lite-kie', provider: 'crun', provider_endpoint: 'crun:google/veo3-1-lite-t2v' };
    const record = capabilityFor(row.provider_endpoint), before = JSON.stringify(record);
    const projected = ownerProofCapability(row, true);
    assert.equal(projected.media.image.max, 1);
    projected.media.image.max = 9;
    assert.equal(JSON.stringify(record), before);
    assert.equal(ownerProofCapability(row, false), record);
    assert.equal(ownerProofCapability({ ...row, id: 'unrelated' }, true), record);
});
for (const client of ['web', 'phone']) test(`${client}: delayed private responses cannot cross session changes or survive refusal`, async () => {
    let resolve, reject, active = true, state = [];
    const publicModels = [{ id: 'public' }], snapshot = JSON.stringify(publicModels);
    const overlay = createOwnerProofOverlay({ load: () => new Promise((r, j) => { resolve = r; reject = j; }), current: () => active, publish: rows => { state = rows; } });
    const old = overlay.refresh();
    active = false; overlay.clear(); active = true; // Includes signing back into the same account.
    resolve({ models: [{ id: 'private' }] }); await old;
    assert.deepEqual(state, []);
    const fresh = overlay.refresh(); resolve({ models: [{ id: 'private' }] }); await fresh;
    assert.deepEqual(mergeOwnerProofModels(publicModels, state).map(m => m.id), ['public', 'private']);
    assert.equal(JSON.stringify(publicModels), snapshot);
    const refused = overlay.refresh(); reject(Object.assign(new Error('model_not_found'), { status: 404 })); await refused;
    assert.deepEqual(state, []);
    overlay.clear(); assert.deepEqual(state, []);
});
test('discovery refusal is no-store and exposes no model data', async t => {
    const { GET } = await import('../app/api/v1/owner-proof/route.js');
    t.mock.method(globalThis, 'fetch', async () => Response.json([{ is_admin: false }]));
    const previous = process.env.APP_RUNTIME_FLAGS; process.env.APP_RUNTIME_FLAGS = on.APP_RUNTIME_FLAGS;
    try {
        const response = await GET(req());
        assert.equal(response.status, 404); assert.match(response.headers.get('cache-control'), /no-store/);
        assert.deepEqual(await response.json(), { error: 'model_not_found' });
    } finally { if (previous === undefined) delete process.env.APP_RUNTIME_FLAGS; else process.env.APP_RUNTIME_FLAGS = previous; }
});

test('private discovery returns only five public projections and leaves public catalog bytes unchanged', async t => {
    const { GET } = await import('../app/api/v1/owner-proof/route.js');
    const { GET: publicGET } = await import('../app/api/catalog/route.js');
    const previous = { ...process.env };
    Object.assign(process.env, { SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test', CRUN_ENABLED: 'true', SUPPLIER_ROUTES_ENABLED: 'true', APP_RUNTIME_FLAGS: '{"ownerProof":true}' });
    t.after(() => { for (const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','CRUN_ENABLED','SUPPLIER_ROUTES_ENABLED','APP_RUNTIME_FLAGS']) {
        if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];
    } });
    const rows = OWNER_PROOF_OFFERS.map(id => ({ id, name: id, provider: 'crun', provider_endpoint: id.startsWith('seedance')
        ? `crun:bytedance/seedance2-5-r2v:${id.endsWith('edit')?'edit':'extend'}`
        : `crun:google/veo3-1-${id.includes('lite')?'lite-':id.includes('fast')?'fast-':''}t2v`,
        active: !id.startsWith('seedance'), gated_flag: id.startsWith('seedance'), modality: 'text-to-video', credits_5s: 76 }));
    t.mock.method(globalThis,'fetch',async url=>{
        const u=new URL(String(url));
        if(u.pathname.endsWith('/users'))return Response.json([{is_admin:true}]);
        if(u.pathname.endsWith('/model_catalog'))return Response.json(rows);
        if(u.pathname.endsWith('/provider_spend_provider_policy'))return Response.json([{admission_open:true}]);
        if(u.pathname.endsWith('/model_routes')){
            const row=rows.find(r=>`eq.${r.id}`===u.searchParams.get('model_id'));
            return Response.json([{id:'route',model_id:row.id,supplier:'crun',endpoint:row.provider_endpoint,state:'active',priority:0,provenance:'licensed_reseller',parity_record:'existing text proof',breaker_opened_at:null}]);
        }
        assert.fail(u.pathname);
    });
    const privateResponse=await GET(req());assert.equal(privateResponse.status,200);assert.match(privateResponse.headers.get('cache-control'),/no-store/);
    const body=await privateResponse.json();assert.equal(body.models.length,5);
    assert.doesNotMatch(JSON.stringify(body),/provider_endpoint|provider_cost|is_admin|img_urls|parity_record|signed-source/);
    assert.equal(body.models.filter(m=>m.capabilities.media.image?.maxFiles===1).length,3);
    assert.ok(body.models.every(m=>m.gated===false));
    const publicRequest=new Request('https://veyrnox.test/api/catalog');
    const on=await publicGET(publicRequest), onBytes=await on.text();
    process.env.APP_RUNTIME_FLAGS='{}';const off=await publicGET(publicRequest);
    assert.equal(off.status,on.status);assert.equal(await off.text(),onBytes);
    assert.doesNotMatch(onBytes,/seedance-2.5/);
});
