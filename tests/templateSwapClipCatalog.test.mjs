import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { catalog, manifest, registry, id } from './fixtures/templateSwapClips.mjs';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }
export async function load(url,c,next) {
 const r = await next(url,c);
 if(url.endsWith('/lib/templateSwapClipSources.js')) return {...r,source:String(r.source).replace('Object.freeze({})', ${JSON.stringify(JSON.stringify(manifest))})};
 if(url.endsWith('/app/veyrnox/_lib/templateSwapClips.js')) return {...r,source:String(r.source).replace('Object.freeze([])', ${JSON.stringify(JSON.stringify(registry))})};
 return r;
}`));
const { GET } = await import('../app/api/catalog/route.js');
test('anonymous no-store projection contains no source identity or URL', async t => {
 Object.assign(process.env, { TEMPLATE_SWAP_CLIP_ENABLED: 'true', SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test' });
 t.mock.method(globalThis, 'fetch', async () => Response.json(catalog));
 const req = { url: 'https://site.test/api/catalog?template_swap=' + id, get headers() { assert.fail('identity read'); } };
 const response = await GET(req);
 assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
 assert.deepEqual(await response.json(), { id, model: catalog[0].id, credits: 47, durationSeconds: 5 });
 delete process.env.TEMPLATE_SWAP_CLIP_ENABLED;
 const off = await GET(req); assert.equal(off.status, 404); assert.equal(off.headers.get('cache-control'), 'no-store');
 assert.deepEqual(await off.json(), { error: 'template_swap_not_found' });
});
