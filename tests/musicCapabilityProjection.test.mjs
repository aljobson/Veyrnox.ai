import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { MUSIC_MOBILE_ROLLOUT_FLAGS } from '../lib/musicRuntime.js';
import { musicDailyChallengeAt } from '../lib/musicDailyChallenge.js';

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
  assert.equal(body.daily_challenge, undefined);
});

test('enabled daily challenge is carried by the existing no-store entitlement contract', async () => {
  const previous = process.env.MUSIC_RUNTIME_FLAGS;
  const realNow = Date.now;
  Date.now = () => Date.parse('2026-11-24T12:00:00.000Z');
  process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify({ dailyChallenge: true });
  try {
    const { GET } = await import(`../app/api/v1/music/entitlements/route.js?daily-challenge=${Date.now()}`);
    const response = await GET(new Request('https://veyrnox.test/api/v1/music/entitlements', {
      headers: { 'x-veyrnox-auth-id': 'auth-user' },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.features.dailyChallenge, true);
    assert.deepEqual(body.daily_challenge, musicDailyChallengeAt(Date.now()));
  } finally {
    Date.now = realNow;
    if (previous === undefined) delete process.env.MUSIC_RUNTIME_FLAGS;
    else process.env.MUSIC_RUNTIME_FLAGS = previous;
  }
});

