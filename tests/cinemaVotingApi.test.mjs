import test from 'node:test';
import assert from 'node:assert/strict';
import { votingHandler, validVotingAction } from '../lib/cinema/votingApi.js';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const NOW = Date.UTC(2026, 9, 10, 12);
Object.assign(process.env, {
  CINEMA_ENABLED: 'true',
  SOCIAL_CINEMA_PROFILES_ENABLED: 'true',
  CINEMA_VIEWING_ENABLED: 'true',
  VOTING_ENABLED: 'true',
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_AUD: 'aud',
});
const headers = {
  'x-veyrnox-auth-id': id,
  'content-type': 'application/json',
  'idempotency-key': id,
};
const admin = {
  'x-veyrnox-auth-aal': 'aal2',
  'x-veyrnox-auth-mfa-at': String(NOW / 1000),
  'cf-access-jwt-assertion': 'synthetic',
};
const get = (query = `?content_id=${other}`, extra = {}) =>
  new Request(`https://test.invalid/api/v1/cinema/voting${query}`, {
    headers: { ...headers, ...extra },
  });
const post = (body, extra = {}) =>
  new Request('https://test.invalid/api/v1/cinema/votes', {
    method: 'POST',
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
  });
const setup = (
  action,
  result,
  { authed = true, rate = { ok: true }, access = async () => ({}) } = {},
) => {
  const calls = [];
  return {
    calls,
    handle: votingHandler({
      action,
      authed,
      now: () => NOW,
      accessVerifier: access,
      rpcCall: async (name, args) => {
        calls.push({ name, args });
        return name === 'consume_account_read_request' ? rate : result;
      },
    }),
  };
};
const row = {
  id: other,
  name: 'Community',
  starts_at: '2026-10-10T11:00:00+00:00',
  ends_at: '2026-10-11T11:00:00+00:00',
  qualified_votes: 2,
  my_vote: { id, status: 'qualified' },
  private: 'must not leak',
};
test('public projection ignores spoofed identity and accepts actual Postgres timestamp offsets', async () => {
  const s = setup('read', { competitions: [row] }, { authed: false });
  const r = await s.handle(get());
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.equal(d.competitions[0].my_vote, null);
  assert.equal(d.competitions[0].private, undefined);
  assert.equal(s.calls[0].args.p_auth_id, null);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('identity, feature and exact query gates happen before RPCs', async () => {
  const s = setup('read', { competitions: [] });
  assert.equal(
    (await s.handle(get('', { 'x-veyrnox-auth-id': '' }))).status,
    401,
  );
  for (const key of [
    'CINEMA_ENABLED',
    'SOCIAL_CINEMA_PROFILES_ENABLED',
    'CINEMA_VIEWING_ENABLED',
    'VOTING_ENABLED',
  ]) {
    process.env[key] = 'false';
    assert.equal((await s.handle(get())).status, 503);
    process.env[key] = 'true';
  }
  for (const query of [
    '',
    `?content_id=${id}&content_id=${other}`,
    `?content_id=${id}&owner=${id}`,
    '?content_id=x',
  ])
    assert.equal((await s.handle(get(query))).status, 400);
  assert.equal(s.calls.length, 0);
});
test('ballots strictly allow fields and preserve the retry key', async () => {
  const s = setup('vote', {
    id: other,
    status: 'under_review',
    idempotent: false,
  });
  for (const b of [
    { content_id: id, competition_id: other, status: 'qualified' },
    null,
    [],
    { content_id: 'x', competition_id: other },
  ])
    assert.equal((await s.handle(post(b))).status, 400);
  assert.equal(
    (
      await s.handle(
        post(
          { content_id: id, competition_id: other },
          { 'idempotency-key': 'x' },
        ),
      )
    ).status,
    400,
  );
  assert.equal(s.calls.length, 0);
  assert.equal(
    (await s.handle(post({ content_id: id, competition_id: other }))).status,
    201,
  );
  assert.deepEqual(s.calls[1].args, {
    p_auth_id: id,
    p_idempotency_key: id,
    p_content_id: id,
    p_competition_id: other,
  });
  assert.equal(
    (
      await setup('vote', {
        id: other,
        status: 'qualified',
        idempotent: true,
      }).handle(post({ content_id: id, competition_id: other }))
    ).status,
    200,
  );
});
test('shared quota and unknown upstream responses fail closed', async () => {
  assert.equal(
    (await setup('read', {}, { rate: { code: 'RATE_LIMITED' } }).handle(get()))
      .status,
    429,
  );
  assert.equal(
    (await setup('read', {}, { rate: { ok: false } }).handle(get())).status,
    503,
  );
  for (const result of [
    { competitions: [{ ...row, qualified_votes: -1 }] },
    { competitions: [{ ...row, qualified_votes: NaN }] },
    { error: 'private_provider_detail' },
  ])
    assert.equal((await setup('read', result).handle(get())).status, 503);
});
test('administrator review requires fresh MFA, verified Access and current DB permission', async () => {
  const s = setup('queue', { competitions: [], votes: [] });
  assert.equal((await s.handle(get(''))).status, 403);
  assert.equal(
    (
      await s.handle(
        get('', {
          ...admin,
          'x-veyrnox-auth-mfa-at': String(NOW / 1000 - 301),
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await s.handle(get('', { ...admin, 'cf-access-jwt-assertion': '' })))
      .status,
    403,
  );
  assert.equal(s.calls.length, 0);
  assert.equal(
    (
      await setup(
        'queue',
        {},
        {
          access: async () => {
            throw Error('private token');
          },
        },
      ).handle(get('', admin))
    ).status,
    403,
  );
  assert.equal(
    (await setup('queue', { error: 'not_authorized' }).handle(get('', admin)))
      .status,
    403,
  );
  assert.equal((await s.handle(get('', admin))).status, 200);
  assert.deepEqual(s.calls[1].args, {
    p_auth_id: id,
    p_aal: 'aal2',
    p_mfa_at: NOW / 1000,
  });
});
test('competition input rejects invalid calendar days, excessive windows and unknown types', () => {
  const p = {
    action: 'create_competition',
    name: 'Festival',
    starts_at: '2026-10-10T00:00:00Z',
    ends_at: '2026-10-11T00:00:00Z',
    target_types: ['FILM'],
    reason: 'Launch window',
  };
  assert.equal(validVotingAction(p), true);
  for (const patch of [
    { ends_at: '2026-11-30T00:00:00Z' },
    { starts_at: '2026-02-30T00:00:00Z' },
    { target_types: ['FILM', 'FILM'] },
    { target_types: ['SEASON'] },
    { name: 1 },
    { owner: id },
    { starts_at: '2026-10-10T00:00:00+00:00' },
  ])
    assert.equal(validVotingAction({ ...p, ...patch }), false);
});
