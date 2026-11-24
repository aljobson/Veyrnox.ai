import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { musicDailyCreditsEnabled, musicRpcStatus, parseMusicQuote } from '../lib/musicBackend.js';
import { parseCrunMusicQuote } from '../lib/musicCrunContract.js';
import { POST as createMusicQuote } from '../app/api/v1/music/generation-quotes/route.js';

const migration = new URL('../packages/db/schema/supabase/0601_music_daily_allowance.sql', import.meta.url);

test('daily Music credits are default-off and require the complete generation path', () => {
  assert.equal(musicDailyCreditsEnabled({}), false);
  assert.equal(musicDailyCreditsEnabled({ MUSIC_RUNTIME_FLAGS: JSON.stringify({
    schema: true, generation: true, dispatch: true, dailyCredits: true,
  }) }), true);
  assert.equal(musicDailyCreditsEnabled({ MUSIC_RUNTIME_FLAGS: JSON.stringify({ dailyCredits: true }) }), false);
  assert.equal(musicRpcStatus('DAILY_ALLOWANCE_STALE'), 409);
});

test('all create parsers accept only a boolean capability bit', () => {
  const simple = { mode: 'simple', prompt: 'harbour pop', instrumental: true,
    provider_contract: 'crun-suno-v1', model_id: 'ace-step', suno_model: 'v6' };
  assert.equal(parseCrunMusicQuote({ ...simple, daily_allowance_capable: true }).dailyAllowanceCapable, true);
  assert.equal(parseCrunMusicQuote({ ...simple, daily_allowance_capable: 'yes' }).error, 'invalid_request');
  assert.equal(parseMusicQuote({ mode: 'simple', prompt: 'harbour pop', instrumental: true,
    daily_allowance_capable: true }).dailyAllowanceCapable, true);
  assert.equal(parseMusicQuote({ mode: 'simple', prompt: 'harbour pop', instrumental: true,
    daily_allowance_capable: 1 }).error, 'invalid_request');
});

test('migration keeps both switches dark and serializes global then user reservations', async () => {
  const sql = await readFile(migration, 'utf8');
  assert.match(sql, /VALUES\(true,false,10,100\)/);
  const globalLock = sql.indexOf("'music-daily-allowance:'||d::TEXT,0");
  const userLock = sql.indexOf("'music-daily-allowance:'||d::TEXT||':'||u::TEXT,0");
  assert.ok(globalLock > 0 && userLock > globalLock);
  assert.match(sql, /state='SUPERSEDED',superseded_at=now\(\)/);
  assert.match(sql, /q\.charged_credits<>q\.total_credits-\(q\.daily_free_candidates\*q\.unit_credits\)/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OF unit_credits,total_credits,daily_free_candidates,charged_credits/);
  assert.match(sql, /private\.music_admit_daily_free_job/);
  assert.match(sql, /music_submit_pair_daily[\s\S]*pg_advisory_xact_lock/);
  assert.match(sql, /FOREIGN KEY\(user_id\) REFERENCES public\.users\(id\) ON DELETE SET NULL/);
  assert.match(sql, /UPDATE public\.music_daily_allowance_claims SET user_id=NULL/);
  assert.match(sql, /UPDATE public\.music_daily_allowance_claims c SET state='RETURNED'/);
  assert.match(sql, /music_return_drift/);
  assert.match(sql, /music_daily_allowance_claims_quote_idx[\s\S]*\(quote_id\)/);
  assert.match(sql, /music_daily_allowance_claims_model_idx[\s\S]*\(model_id\)/);
});

test('route contracts isolate entitlement failure and use unique capable RPC names', async () => {
  const [entitlements, quotes] = await Promise.all([
    readFile(new URL('../app/api/v1/music/entitlements/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/api/v1/music/generation-quotes/route.js', import.meta.url), 'utf8'),
  ]);
  assert.match(entitlements, /daily allowance unavailable/);
  assert.match(entitlements, /\{ enabled: false, unavailable: true \}/);
  assert.match(quotes, /music_create_quote_with_daily_allowance/);
  assert.match(quotes, /music_create_custom_quote_with_daily_allowance/);
  assert.match(quotes, /list_credits/);
});

test('quote route preserves the legacy wire and emits allowance fields only for a capable request', async (t) => {
  const original = {
    flags: process.env.MUSIC_RUNTIME_FLAGS,
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  t.after(() => {
    if (original.flags === undefined) delete process.env.MUSIC_RUNTIME_FLAGS;
    else process.env.MUSIC_RUNTIME_FLAGS = original.flags;
    if (original.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = original.url;
    if (original.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = original.key;
  });
  process.env.SUPABASE_URL = 'https://daily-route.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
  const rpcNames = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/model_catalog') return Response.json([{
      active: true, id: 'ace-step', name: 'ACE-Step', modality: 'audio', credits_5s: 4,
      gated_flag: false, provider: 'crun', provider_endpoint: 'crun:suno/music-generate',
      updated_at: '2099-01-01T00:00:00Z',
    }]);
    const name = url.pathname.split('/').pop();
    rpcNames.push(name);
    return Response.json({
      ok: true, quote_id: '00000000-0000-4000-8000-000000000010', mode: 'simple',
      model_id: 'ace-step', provider_contract: 'crun-suno-v1', unit_credits: 4,
      total_credits: 8, charged_credits: name.endsWith('with_daily_allowance') ? 0 : 8,
      list_credits: 8, daily_free_candidates: 2, daily_allowance_reset_at: '2099-01-02T00:00:00Z',
      balance: 20, balance_after: name.endsWith('with_daily_allowance') ? 20 : 12,
      affordable: true, expires_at: '2099-01-01T00:10:00Z',
    });
  });
  const request = (capable) => new Request('https://veyrnox.test/api/v1/music/generation-quotes', {
    method: 'POST', headers: { 'content-type': 'application/json',
      'x-veyrnox-auth-id': '00000000-0000-4000-8000-000000000001' },
    body: JSON.stringify({ mode: 'simple', provider_contract: 'crun-suno-v1', model_id: 'ace-step',
      prompt: 'harbour pop', instrumental: true, suno_model: 'v6',
      ...(capable === undefined ? {} : { daily_allowance_capable: capable }) }),
  });

  process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify({ schema: true, generation: true, dispatch: true });
  const disabled = await createMusicQuote(request(undefined));
  assert.equal(disabled.status, 201);
  const disabledBody = await disabled.json();
  assert.equal(rpcNames.at(-1), 'music_create_quote');
  assert.equal('list_credits' in disabledBody, false);
  assert.equal('daily_free_candidates' in disabledBody, false);

  process.env.MUSIC_RUNTIME_FLAGS = JSON.stringify({ schema: true, generation: true, dispatch: true, dailyCredits: true });
  const enabled = await createMusicQuote(request(true));
  assert.equal(enabled.status, 201);
  const enabledBody = await enabled.json();
  assert.equal(rpcNames.at(-1), 'music_create_quote_with_daily_allowance');
  assert.deepEqual({ list: enabledBody.list_credits, charged: enabledBody.total_credits,
    covered: enabledBody.daily_free_candidates }, { list: 8, charged: 0, covered: 2 });

  const legacy = await createMusicQuote(request(undefined));
  assert.equal(legacy.status, 201);
  const legacyBody = await legacy.json();
  assert.equal(rpcNames.at(-1), 'music_create_quote');
  assert.equal('list_credits' in legacyBody, false);
  assert.equal('daily_free_candidates' in legacyBody, false);
});

test('daily allowance claims join the classified privacy export', async () => {
  const [route, privacy] = await Promise.all([
    readFile(new URL('../app/api/v1/account/export/[exportId]/route.js', import.meta.url), 'utf8'),
    readFile(new URL('../lib/privacyExport.js', import.meta.url), 'utf8'),
  ]);
  assert.match(privacy, /'music_daily_allowance'/);
  assert.match(route, /read_music_daily_allowance_export_page/);
  assert.match(route, /missingDedicatedExportReader/);
});

test('all web locales carry the allowance price and reset copy', async () => {
  for (const locale of ['en', 'de', 'es', 'fr', 'pt', 'ja', 'ko', 'zh', 'ar', 'hi', 'ru']) {
    const messages = (await import(`../lib/i18n/messages/app/${locale}/music-suno.mjs`)).default;
    for (const key of ['dailyAllowance.one', 'dailyAllowance.other', 'dailyAllowanceUnavailable', 'dailyAllowanceExhausted', 'dailyCovered.one', 'dailyCovered.other', 'payable', 'noAccountCredits', 'resetsAt', 'err.daily_allowance_stale']) {
      assert.equal(typeof messages[`app.music.suno.${key}`], 'string', `${locale}:${key}`);
    }
  }
});
