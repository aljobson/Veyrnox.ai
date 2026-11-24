import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';
import { MUSIC_MOBILE_ROLLOUT_FLAGS } from '../lib/musicRuntime.js';
import { musicDailyChallengeAt } from '../lib/musicDailyChallenge.js';
import { musicInspirationSources } from '../lib/musicInspiration.js';

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
    export const musicStudioChatEnabled = () => {
      const flags = JSON.parse(process.env.MUSIC_RUNTIME_FLAGS || '{}');
      return flags.ui === true && flags.beatEditor === true && flags.studioChat === true;
    };
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
  assert.deepEqual(body.inspiration_sources, []);
  assert.equal(body.daily_challenge, undefined);
});

test('inspiration capabilities expose audio only when its private contract is configured', () => {
  const base = {
    MUSIC_INSPIRATION_ENABLED: 'true',
    MUSIC_INSPIRATION_MODEL: 'google/gemini-test',
    MUSIC_INSPIRATION_API_KEY: 'test-only',
    MUSIC_INSPIRATION_SCHEMA_ENABLED: 'true',
    MUSIC_INSPIRATION_RECEIPT_SECRET: 'a'.repeat(32),
    UPLOAD_INTEGRITY_ENABLED: 'true',
    MUSIC_RUNTIME_FLAGS: JSON.stringify({ schema: true, inspiration: true }),
  };
  assert.deepEqual(musicInspirationSources({}), []);
  assert.deepEqual(musicInspirationSources(base), ['audio']);
  for (const key of ['MUSIC_INSPIRATION_ENABLED', 'MUSIC_INSPIRATION_MODEL', 'MUSIC_INSPIRATION_API_KEY',
    'MUSIC_INSPIRATION_SCHEMA_ENABLED', 'MUSIC_INSPIRATION_RECEIPT_SECRET', 'UPLOAD_INTEGRITY_ENABLED', 'MUSIC_RUNTIME_FLAGS']) {
    assert.deepEqual(musicInspirationSources({ ...base, [key]: undefined }), [], `${key} fails closed`);
  }
  assert.deepEqual(musicInspirationSources({
    ...base,
    UPLOAD_HASH_MATCH_REQUIRED: 'true',
    UPLOAD_HASH_MATCH_PROVIDER: 'not-enrolled',
    CONTENT_SCAN_ENABLED: 'true',
    OPENAI_API_KEY: 'test-only',
  }), [], 'all pickers stay hidden when required upload admission has no registered provider');
  assert.deepEqual(musicInspirationSources({ ...base, CONTENT_SCAN_ENABLED: 'true', OPENAI_API_KEY: 'test-only' }), ['audio'],
    'unimplemented image/video kinds are never advertised');
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

test('native Studio actions require the same combined UI, beat editor and studioChat gate as web', async () => {
  const previous = process.env.MUSIC_RUNTIME_FLAGS;
  try {
    for (const [flags, expected] of [
      [{ studioChat: true }, false],
      [{ ui: true, studioChat: true }, false],
      [{ ui: true, beatEditor: true, studioChat: true }, true],
    ]) {
      process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify(flags);
      const { GET } = await import(`../app/api/v1/music/entitlements/route.js?studio-chat=${JSON.stringify(flags)}-${Date.now()}`);
      const response = await GET(new Request('https://veyrnox.test/api/v1/music/entitlements', {
        headers: { 'x-veyrnox-auth-id': 'auth-user' },
      }));
      assert.equal((await response.json()).features.studioChat, expected);
    }
  } finally {
    if (previous === undefined) delete process.env.MUSIC_RUNTIME_FLAGS;
    else process.env.MUSIC_RUNTIME_FLAGS = previous;
  }
});

