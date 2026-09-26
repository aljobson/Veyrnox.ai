import test from 'node:test';
import assert from 'node:assert/strict';
import { unlockHandler, UNLOCK_CONSENT_VERSION } from '../lib/cinema/unlockApi.js';

const id = '11111111-1111-4111-8111-111111111111';
const uid = 'a'.repeat(32);
Object.assign(process.env, { CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', CINEMA_UNLOCKS_ENABLED: 'true' });

const post = (path, value, headers = {}) => new Request(`https://test.invalid/api/v1/cinema/${path}`, {
  method: 'POST', headers: { 'x-veyrnox-auth-id': id, 'content-type': 'application/json', ...headers }, body: JSON.stringify(value),
});
const get = (query, headers = {}) => new Request(`https://test.invalid/api/v1/cinema/entitlement${query}`, { headers: { 'x-veyrnox-auth-id': id, ...headers } });
const consent = { content_id: id, consent_version: UNLOCK_CONSENT_VERSION };

function setup(action, responses = {}) {
  const calls = [];
  const handle = unlockHandler({
    action,
    sign: async (videoUid, cfg, exp) => `signed:${videoUid}:${cfg.keyId}:${exp}`,
    now: () => 1_800_000_000_000,
    rpcCall: async (name, args) => {
      calls.push({ name, args });
      if (name === 'consume_account_read_request') return responses.rate ?? { ok: true };
      return responses[name] ?? { error: 'unexpected_rpc' };
    },
  });
  return { calls, handle };
}

test('identity, flag and input gates run before any RPC', async () => {
  const s = setup('unlock', { unlock_cinema_content: { ok: true, access: 'unlocked', credits: 6 } });
  assert.equal((await s.handle(post('unlocks', consent, { 'x-veyrnox-auth-id': '' }))).status, 401);
  for (const flag of ['CINEMA_ENABLED', 'SOCIAL_CINEMA_PROFILES_ENABLED', 'CINEMA_UNLOCKS_ENABLED']) {
    process.env[flag] = 'false';
    assert.equal((await s.handle(post('unlocks', consent))).status, 503);
    process.env[flag] = 'true';
  }
  for (const value of [{ content_id: 'nope', consent_version: UNLOCK_CONSENT_VERSION }, { ...consent, credits: 1 }, { ...consent, user_id: id }, [consent], null]) {
    assert.equal((await s.handle(post('unlocks', value))).status, 400);
  }
  assert.equal((await s.handle(post('unlocks?x=1', consent))).status, 400);
  assert.equal((await s.handle(post('unlocks', consent, { 'content-type': 'text/plain' }))).status, 415);
  // Stale or missing consent wording is refused and the current version named.
  const stale = await s.handle(post('unlocks', { content_id: id, consent_version: 'unlock-2020-01-01' }));
  assert.equal(stale.status, 400);
  assert.equal((await stale.json()).consent_version, UNLOCK_CONSENT_VERSION);
  assert.equal(s.calls.length, 0);
});

test('an Unlock is 201 once, 200 on replay, and money errors are typed', async () => {
  const first = setup('unlock', { unlock_cinema_content: { ok: true, access: 'unlocked', credits: 6, balance_after: 4, idempotent: false } });
  const res = await first.handle(post('unlocks', consent));
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.deepEqual([data.access, data.credits, data.balance_after, data.idempotent], ['unlocked', 6, 4, false]);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(first.calls[1].name, 'unlock_cinema_content');
  assert.equal(first.calls[1].args.p_consent_version, UNLOCK_CONSENT_VERSION);
  assert.equal(first.calls[1].args.p_auth_id, id);

  const replay = setup('unlock', { unlock_cinema_content: { ok: true, access: 'unlocked', credits: 6, idempotent: true } });
  assert.equal((await replay.handle(post('unlocks', consent))).status, 200);

  const free = setup('unlock', { unlock_cinema_content: { ok: true, access: 'free', credits: 0, idempotent: true } });
  assert.equal((await (await free.handle(post('unlocks', consent))).json()).access, 'free');

  for (const [error, status] of [['insufficient_credits', 402], ['account_frozen', 403], ['account_not_active', 403], ['content_not_found', 404], ['not_authenticated', 401], ['consent_required', 400], ['private_db_detail', 503]]) {
    const s = setup('unlock', { unlock_cinema_content: { error, credits: 6, balance: 2 } });
    const r = await s.handle(post('unlocks', consent));
    assert.equal(r.status, status, error);
    const body = await r.json();
    assert.equal(body.error, error === 'private_db_detail' ? 'temporarily_unavailable' : error);
    if (error === 'insufficient_credits') assert.deepEqual([body.credits, body.balance], [6, 2]);
  }
  const limited = setup('unlock', { unlock_cinema_content: { error: 'rate_limited', retry_after_seconds: 7 } });
  const r = await limited.handle(post('unlocks', consent));
  assert.equal(r.status, 429);
  assert.equal(r.headers.get('retry-after'), '7');
});

test('entitlement reads exactly one content id and reports the consent version', async () => {
  const s = setup('entitlement', { cinema_entitlement: { access: 'locked', credits: 6 } });
  for (const query of ['', '?content_id=nope', `?content_id=${id}&content_id=${id}`, `?content_id=${id}&extra=1`]) {
    assert.equal((await s.handle(get(query))).status, 400, query);
  }
  const res = await s.handle(get(`?content_id=${id}`));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual([data.access, data.credits, data.consent_version], ['locked', 6, UNLOCK_CONSENT_VERSION]);
  const missing = setup('entitlement', { cinema_entitlement: { error: 'content_not_found' } });
  assert.equal((await missing.handle(get(`?content_id=${id}`))).status, 404);
  const odd = setup('entitlement', { cinema_entitlement: { access: 'pass' } });
  assert.equal((await odd.handle(get(`?content_id=${id}`))).status, 503);
});

test('the shared account quota is consumed before every read or unlock', async () => {
  for (const action of ['entitlement', 'unlock', 'play']) {
    const s = setup(action, { rate: { ok: false, code: 'RATE_LIMITED', retry_after_seconds: 3 } });
    const req = action === 'entitlement' ? get(`?content_id=${id}`) : post(action === 'unlock' ? 'unlocks' : 'play', action === 'unlock' ? consent : { content_id: id });
    const res = await s.handle(req);
    assert.equal(res.status, action === 'play' ? 503 : 429);
    assert.equal(s.calls.length, action === 'play' ? 0 : 1);
  }
});

test('playback mints a fifteen-minute token only for an entitled viewer', async () => {
  delete process.env.CINEMA_STREAM_SIGNING_KEY_ID;
  const unconfigured = setup('play', { read_cinema_playback: { access: 'unlocked', stream_uid: uid } });
  assert.equal((await unconfigured.handle(post('play', { content_id: id }))).status, 503);
  assert.equal(unconfigured.calls.length, 0);

  Object.assign(process.env, {
    CINEMA_STREAM_SIGNING_KEY_ID: 'b'.repeat(32),
    CINEMA_STREAM_SIGNING_JWK: btoa(JSON.stringify({ kty: 'RSA', d: 'private' })),
    CINEMA_STREAM_CUSTOMER_CODE: 'abc123',
  });
  const ok = setup('play', { read_cinema_playback: { access: 'unlocked', stream_uid: uid } });
  const res = await ok.handle(post('play', { content_id: id }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.token, `signed:${uid}:${'b'.repeat(32)}:${1_800_000_000 + 900}`);
  assert.equal(data.expires_at, new Date((1_800_000_000 + 900) * 1000).toISOString());
  assert.equal(data.customer_code, 'abc123');
  assert.equal(data.stream_uid, undefined);

  const locked = setup('play', { read_cinema_playback: { error: 'locked', credits: 6 } });
  const l = await locked.handle(post('play', { content_id: id }));
  assert.equal(l.status, 402);
  assert.equal((await l.json()).credits, 6);
  const notReady = setup('play', { read_cinema_playback: { error: 'not_ready' } });
  assert.equal((await notReady.handle(post('play', { content_id: id }))).status, 409);
  const strange = setup('play', { read_cinema_playback: { access: 'unlocked' } });
  assert.equal((await strange.handle(post('play', { content_id: id }))).status, 503);
});

test('upstream failures are redacted', async () => {
  const s = unlockHandler({ action: 'unlock', rpcCall: async () => { throw new Error('private connection string'); } });
  const res = await s(post('unlocks', consent));
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes('private'));
});

test('a heartbeat records seconds only for a Pass holder and reports the ceiling', async () => {
  const s = setup('heartbeat', { record_cinema_pass_play: { ok: true, recorded: true, access: 'pass', seconds: 30, minutes_used: 12, ceiling_minutes: 3000 } });
  for (const value of [{ content_id: id }, { content_id: id, seconds: 0 }, { content_id: id, seconds: 61 }, { content_id: id, seconds: '30' }, { content_id: id, seconds: 30, extra: 1 }]) {
    assert.equal((await s.handle(post('play/heartbeat', value))).status, 400, JSON.stringify(value));
  }
  assert.equal(s.calls.length, 0);
  const res = await s.handle(post('play/heartbeat', { content_id: id, seconds: 30 }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual([data.recorded, data.access, data.seconds, data.minutes_used, data.ceiling_minutes, data.reason], [true, 'pass', 30, 12, 3000, undefined]);
  assert.deepEqual(s.calls[1].args, { p_auth_id: id, p_content_id: id, p_seconds: 30 });
  const ceiling = setup('heartbeat', { record_cinema_pass_play: { ok: true, recorded: false, access: 'locked', reason: 'pass_ceiling', minutes_used: 3000, ceiling_minutes: 3000 } });
  const c = await (await ceiling.handle(post('play/heartbeat', { content_id: id, seconds: 30 }))).json();
  assert.deepEqual([c.recorded, c.access, c.reason, c.seconds], [false, 'locked', 'pass_ceiling', 0]);
  const missing = setup('heartbeat', { record_cinema_pass_play: { error: 'content_not_found' } });
  assert.equal((await missing.handle(post('play/heartbeat', { content_id: id, seconds: 30 }))).status, 404);
  const odd = setup('heartbeat', { record_cinema_pass_play: { ok: true } });
  assert.equal((await odd.handle(post('play/heartbeat', { content_id: id, seconds: 30 }))).status, 503);
  // Entitlement passes a ceiling reason through.
  const ent = setup('entitlement', { cinema_entitlement: { access: 'locked', credits: 6, reason: 'pass_ceiling' } });
  assert.equal((await (await ent.handle(get(`?content_id=${id}`))).json()).reason, 'pass_ceiling');
});
