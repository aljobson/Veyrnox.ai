import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { MUSIC_MOBILE_ROLLOUT_FLAGS } from '../lib/musicRuntime.js';

const data = source => `data:text/javascript,${encodeURIComponent(source)}`;
register(data(`export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('/packages/db/supabase-client.js')) return { url: ${JSON.stringify(data(`
    export const envConfig = () => ({ supabaseUrl: 'https://db.test', serviceRoleKey: 'test' });
    export const rpc = async name => name === 'read_user_credits' ? { balance: 40 } : { ok: false };
  `))}, shortCircuit: true };
  if (specifier.endsWith('/lib/publicCatalog.js')) return { url: ${JSON.stringify(data(`export const readFreshMusicCatalog = async () => [];`))}, shortCircuit: true };
  if (specifier.endsWith('/lib/musicBackend.js')) return { url: ${JSON.stringify(data(`
    export const validMusicAuthId = value => typeof value === 'string' && value.length > 0;
    export const musicSchemaEnabled = () => true;
    export const musicGenerationEnabled = () => false;
    export const musicAlbumsEnabled = () => false;
    export const musicDailyCreditsEnabled = () => false;
    export const musicEntitlementProjection = () => ({ available: true });
  `))}, shortCircuit: true };
  return nextResolve(specifier, context);
}`));

test('authenticated music entitlements project every default-off mobile rollout capability', async () => {
  const { GET } = await import(`../app/api/v1/music/entitlements/route.js?capabilities=${Date.now()}`);
  const response = await GET(new Request('https://veyrnox.test/api/v1/music/entitlements', {
    headers: { 'x-veyrnox-auth-id': 'auth-user' },
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(Object.keys(body.features), [...MUSIC_MOBILE_ROLLOUT_FLAGS]);
  assert.deepEqual(Object.values(body.features), MUSIC_MOBILE_ROLLOUT_FLAGS.map(() => false));
});

