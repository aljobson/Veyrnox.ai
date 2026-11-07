import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { inventory, exportedMethods } from '../scripts/generate-route-inventory.mjs';
register('data:text/javascript,' + encodeURIComponent("export async function resolve(s,c,next){return next(s==='next/server'?'next/server.js':s,c)}"));
const routes = await Promise.all(['affiliates','revenue','endpoints'].map(p => import('../app/api/v1/admin/' + p + '/route.js')));
test('route inventory is current and recognizes declarations, aliases and re-exports', async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL('../lib/adminRouteInventory.json',import.meta.url))), await inventory());
  assert.deepEqual(exportedMethods("export async function GET() {} export const POST = handler; export { put as PUT }; export { DELETE } from './x'; // export const PATCH"), ['DELETE','GET','POST','PUT']);
  const rows = await inventory();
  assert.ok(rows.some(r => r.path === '/app/admin/payments' && r.gate === 'page'));
  assert.ok(rows.some(r => r.path === '/api/v1/admin/revenue' && r.gate === 'admin'));
  assert.ok(rows.some(r => r.path === '/api/webhook/stripe' && r.gate === 'webhook'));
  for (const [path, method] of [['/api/v1/editor/ai-edit', 'POST'], ['/api/v1/editor/ai-edit/quote', 'GET'], ['/api/v1/editor/ai-edit/by-key/:idempotencyKey', 'GET']]) {
    assert.deepEqual(rows.find(r => r.path === path), { path, methods: [method], gate: 'v1' });
  }
});
test('report routes enforce identity, bounds, safe errors and no-store', async t => {
  const env = { SUPABASE_URL:'https://db.test',SUPABASE_SERVICE_ROLE_KEY:'test',ADMIN_REQUIRE_AAL2:'true',ACCESS_TEAM_DOMAIN:'',ACCESS_AUD:'' };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k,process.env[k]]));
  Object.assign(process.env,env);
  t.after(() => { for(const [k,v] of Object.entries(saved)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; } });
  const calls=[];
  let refuse=false;
  t.mock.method(console,'error',()=>{});
  t.mock.method(globalThis,'fetch',async (url,init) => { calls.push(JSON.parse(init.body));return refuse ? Response.json({code:'42501',message:'not_admin'},{status:403}) : Response.json({ok:true,permissions:['payments','affiliates','endpoints'],by_source:[]}); });
  const headers={'x-veyrnox-auth-id':'11111111-1111-4111-8111-111111111111','x-veyrnox-auth-aal':'aal2'};
  for(const {GET} of routes) {
    const missing=await GET(new Request('https://test/api'));
    assert.equal(missing.status,401);assert.equal(missing.headers.get('cache-control'),'no-store');
  }
  for(const {GET} of routes.slice(0,2)) for(const query of ['?days=0','?days=366','?days=2.5','?days=3&days=4']) assert.equal((await GET(new Request('https://test/api'+query,{headers}))).status,400);
  assert.equal(calls.length,0);
  for(const {GET} of routes) {
    const res=await GET(new Request('https://test/api',{headers}));assert.equal(res.status,200);assert.equal(res.headers.get('cache-control'),'no-store');
  }
  refuse=true;
  for(const {GET} of routes) assert.equal((await GET(new Request('https://test/api',{headers}))).status,403);
});
