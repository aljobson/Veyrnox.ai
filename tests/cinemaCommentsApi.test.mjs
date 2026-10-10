import test from 'node:test';
import assert from 'node:assert/strict';
import {
  commentsHandler,
  validCommentMutation,
  validCommentDecision,
} from '../lib/cinema/commentsApi.js';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222',
  NOW = Date.UTC(2026, 9, 10, 12);
Object.assign(process.env, {
  CINEMA_ENABLED: 'true',
  SOCIAL_CINEMA_PROFILES_ENABLED: 'true',
  CINEMA_VIEWING_ENABLED: 'true',
  COMMENTS_ENABLED: 'true',
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
  new Request(`https://test.invalid/api/v1/cinema/comments${query}`, {
    headers: { ...headers, ...extra },
  });
const post = (b, extra = {}) =>
  new Request('https://test.invalid/api/v1/cinema/comments', {
    method: 'POST',
    headers: { ...headers, ...extra },
    body: JSON.stringify(b),
  });
const setup = (
  action,
  result,
  { authed = true, rate = { ok: true }, access = async () => ({}) } = {},
) => {
  const calls = [];
  return {
    calls,
    handle: commentsHandler({
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
const comment = {
  id: other,
  body: '<b>Plain text</b>',
  username: 'fixture',
  display_name: 'Fixture',
  created_at: '2026-10-10T12:00:00+00:00',
  own: true,
  private: 'sensitive',
};
test('public comments ignore spoofed identity and exclude own pending content and private fields', async () => {
  const s = setup(
    'read',
    {
      comments: [comment],
      own_comments: [{ ...comment, status: 'pending' }],
      next_cursor: null,
    },
    { authed: false },
  );
  const r = await s.handle(get());
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.comments[0].own, false);
  assert.equal(b.comments[0].private, undefined);
  assert.deepEqual(b.own_comments, []);
  assert.equal(b.comments[0].body, comment.body);
  assert.equal(s.calls[0].args.p_auth_id, null);
});
test('exact query, identity and feature checks happen before RPC', async () => {
  const s = setup('read', {
    comments: [],
    own_comments: [],
    next_cursor: null,
  });
  assert.equal(
    (await s.handle(get('', { 'x-veyrnox-auth-id': '' }))).status,
    401,
  );
  for (const key of [
    'CINEMA_ENABLED',
    'SOCIAL_CINEMA_PROFILES_ENABLED',
    'CINEMA_VIEWING_ENABLED',
    'COMMENTS_ENABLED',
  ]) {
    process.env[key] = 'false';
    assert.equal((await s.handle(get())).status, 503);
    process.env[key] = 'true';
  }
  for (const query of [
    '',
    `?content_id=${id}&content_id=${other}`,
    `?content_id=${id}&before_id=x`,
    `?content_id=${id}&author=${id}`,
  ])
    assert.equal((await s.handle(get(query))).status, 400);
  assert.equal(s.calls.length, 0);
  assert.equal(
    (await s.handle(get(`?content_id=${id}&before_id=${other}`))).status,
    200,
  );
  assert.equal(s.calls[1].args.p_before_id, other);
});
test('strict mutation schema rejects status/author injection and preserves submission key', async () => {
  const s = setup('mutate', {
      id: other,
      status: 'pending',
      idempotent: false,
    }),
    payload = {
      action: 'submit',
      content_id: other,
      body: 'A thoughtful comment',
    };
  for (const b of [
    { ...payload, author_id: id },
    { ...payload, status: 'approved' },
    { ...payload, body: 'x'.repeat(2001) },
    [],
    null,
  ])
    assert.equal((await s.handle(post(b))).status, 400);
  assert.equal(s.calls.length, 0);
  const r = await s.handle(post(payload));
  assert.equal(r.status, 201);
  assert.deepEqual(s.calls[1].args, {
    p_auth_id: id,
    p_idempotency_key: id,
    p_payload: payload,
  });
  assert.equal(
    (
      await setup('mutate', {
        id: other,
        status: 'pending',
        idempotent: true,
      }).handle(post(payload))
    ).status,
    200,
  );
});
test('reports require known categories and reason; withdrawals cannot include content or review fields', () => {
  assert.equal(
    validCommentMutation({
      action: 'report',
      comment_id: id,
      category: 'spam',
      details: 'Repeated spam',
    }),
    true,
  );
  for (const b of [
    { action: 'report', comment_id: id, category: 'unknown', details: 'Bad' },
    { action: 'report', comment_id: id, category: 'spam', details: 'no' },
    { action: 'withdraw', comment_id: id, body: 'Changed' },
  ])
    assert.equal(validCommentMutation(b), false);
  assert.equal(
    validCommentMutation({ action: 'withdraw', comment_id: id }),
    true,
  );
  assert.equal(
    validCommentDecision({
      action: 'review_comment',
      id,
      decision: 'approved',
      reason: 'Reviewed',
    }),
    true,
  );
  assert.equal(
    validCommentDecision({
      action: 'resolve_report',
      id,
      decision: 'approved',
      reason: 'Reviewed',
    }),
    false,
  );
});
test('moderation requires fresh MFA, verified Access, and current DB role', async () => {
  const s = setup('queue', { comments: [], reports: [] });
  assert.equal((await s.handle(get(''))).status, 403);
  assert.equal(
    (await s.handle(get('', { ...admin, 'x-veyrnox-auth-aal': 'aal1' })))
      .status,
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
            throw Error('secret');
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
});
test('upstream errors, quotas and malformed projections fail closed', async () => {
  assert.equal(
    (await setup('read', {}, { rate: { ok: false } }).handle(get())).status,
    503,
  );
  assert.equal(
    (await setup('read', {}, { rate: { code: 'RATE_LIMITED' } }).handle(get()))
      .status,
    429,
  );
  for (const result of [
    { error: 'private_data' },
    {
      comments: [{ ...comment, body: 123 }],
      own_comments: [],
      next_cursor: null,
    },
    { comments: [], own_comments: [], next_cursor: 'bad' },
  ]) {
    const r = await setup('read', result).handle(get());
    assert.equal(r.status, 503);
    assert.ok(!(await r.text()).includes('private_data'));
  }
});
