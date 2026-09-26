import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorHandler } from '../lib/cinema/operatorApi.js';
const actor = '11111111-1111-4111-8111-111111111111', target = '22222222-2222-4222-8222-222222222222';
const NOW = Date.UTC(2026, 8, 26, 12);
Object.assign(process.env, { CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', CINEMA_UNLOCKS_ENABLED: 'true',
  CINEMA_SUBSCRIPTIONS_ENABLED: 'true', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud', STRIPE_SECRET_KEY: 'sk_test_fake' });
const req = (body = { content_id: target, reason: 'Rights complaint' }, headers = {}, query = '') => new Request(`https://example.invalid/api/v1/admin/cinema/unlocks/reverse${query}`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': actor, 'x-veyrnox-auth-id': actor,
    'x-veyrnox-auth-aal': 'aal2', 'x-veyrnox-auth-mfa-at': String(NOW / 1000), 'cf-access-jwt-assertion': 'access', ...headers }, body: JSON.stringify(body),
});
const refundBody = { pass_id: target, reason: 'Duplicate Pass charge' };
const operation = { ok: true, complete: false, action_id: actor, pass_id: target, subscription_id: 'sub_1', customer_id: 'cus_1' };
function setup(action = 'reverse_unlocks', options = {}) {
  const calls = [], refunds = [];
  const handle = operatorHandler({ action, now: () => NOW, accessVerifier: options.access || (async () => ({})),
    rpcCall: async (name, args) => {
      calls.push({ name, args });
      if (options.throw) throw Error('private connection secret');
      if (name === 'consume_account_read_request') return options.rate || { ok: true };
      if (name === 'complete_cinema_operator_refund') return options.completed || { ok: true, idempotent: false };
      return options.result || (action === 'refund_pass' ? operation : { ok: true, content_id: target, unlocks_reversed: 2, credits_returned: 12 });
    }, refund: async (op) => { refunds.push(op); return options.refund || { ok: true, refundId: 're_1', amountCents: 1299 }; },
  });
  return { handle, calls, refunds };
}
test('Operator authentication, recent MFA, Access and switches fail before side effects', async () => {
  const s = setup();
  for (const [headers, status] of [[{ 'x-veyrnox-auth-id': '' }, 401], [{ 'x-veyrnox-auth-aal': 'aal1' }, 403],
    [{ 'x-veyrnox-auth-mfa-at': String(NOW / 1000 - 301) }, 403], [{ 'x-veyrnox-auth-mfa-at': String(NOW / 1000 + 6) }, 403],
    [{ 'x-veyrnox-auth-mfa-at': 'NaN' }, 403], [{ 'cf-access-jwt-assertion': '' }, 403]]) assert.equal((await s.handle(req(undefined, headers))).status, status);
  assert.equal((await setup('reverse_unlocks', { access: async () => { throw Error('bad token'); } }).handle(req())).status, 403);
  for (const flag of ['CINEMA_ENABLED', 'SOCIAL_CINEMA_PROFILES_ENABLED', 'CINEMA_UNLOCKS_ENABLED']) {
    process.env[flag] = 'false'; assert.equal((await s.handle(req())).status, 503); process.env[flag] = 'true';
  }
  process.env.CINEMA_SUBSCRIPTIONS_ENABLED = 'false';
  assert.equal((await setup('refund_pass').handle(req(refundBody))).status, 503); process.env.CINEMA_SUBSCRIPTIONS_ENABLED = 'true';
  delete process.env.ACCESS_AUD; assert.equal((await s.handle(req())).status, 503); process.env.ACCESS_AUD = 'aud';
  assert.equal(s.calls.length, 0);
});
test('strict bodies refuse forged actor, Stripe ids, amounts, query parameters and oversized input', async () => {
  const s = setup();
  for (const body of [null, [], { content_id: target, reason: 'no' }, { content_id: [target], reason: 'valid reason' },
    { content_id: target, reason: 'x'.repeat(501) }, { content_id: target, reason: 'valid reason', actor_id: actor }]) {
    assert.equal((await s.handle(req(body))).status, 400);
  }
  assert.equal((await s.handle(req(undefined, {}, '?x=1'))).status, 400);
  assert.equal((await s.handle(req(undefined, { 'idempotency-key': 'bad' }))).status, 400);
  assert.equal((await s.handle(req(undefined, { 'content-type': 'text/plain' }))).status, 415);
  assert.equal((await s.handle(req({ content_id: target, reason: 'x'.repeat(70000) }))).status, 413);
  for (const field of ['amount', 'payment_intent', 'subscription_id', 'user_id']) {
    assert.equal((await setup('refund_pass').handle(req({ ...refundBody, [field]: 'forged' }))).status, 400);
  }
  assert.equal(s.calls.length, 0);
});
test('reversal uses verified actor and explicit safe projection; rate and database failures redact details', async () => {
  const s = setup('reverse_unlocks', { result: { ok: true, content_id: target, unlocks_reversed: 2, credits_returned: 12, secret: 'private' } });
  const r = await s.handle(req()); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await r.json()).secret, undefined);
  assert.deepEqual([s.calls[1].args.p_auth_id, s.calls[1].args.p_target_id, s.calls[1].args.p_action], [actor, target, 'reverse_unlocks']);
  for (const [error, status] of [['not_authorized', 403], ['content_not_found', 404], ['content_still_published', 409], ['idempotency_conflict', 409], ['toString', 503]]) {
    assert.equal((await setup('reverse_unlocks', { result: { error } }).handle(req())).status, status);
  }
  const rate = setup('refund_pass', { rate: { code: 'RATE_LIMITED' } });
  assert.equal((await rate.handle(req(refundBody))).status, 429); assert.equal(rate.refunds.length, 0);
  const failure = await setup('refund_pass', { throw: true }).handle(req(refundBody));
  assert.equal(failure.status, 503); assert.ok(!(await failure.text()).includes('private'));
});
test('refund authorizes and persists before Stripe; only success records a receipt', async () => {
  const s = setup('refund_pass'); const res = await s.handle(req(refundBody));
  assert.equal(res.status, 200); const data = await res.json(); assert.equal(data.refund_usd_cents, 1299);
  assert.equal(data.refundId, undefined); assert.equal(data.subscription_id, undefined);
  assert.deepEqual(s.calls.map(c => c.name), ['consume_account_read_request', 'begin_cinema_operator_action', 'complete_cinema_operator_refund']);
  assert.equal(s.calls[2].args.p_action_id, actor);
  for (const [result, status] of [[{ pending: true }, 202], [{ error: 'refund_review_required' }, 409], [{ error: 'stripe_unavailable' }, 502]]) {
    const attempt = setup('refund_pass', { refund: result }); const response = await attempt.handle(req(refundBody));
    assert.equal(response.status, status); assert.equal(attempt.calls.length, 2);
    if (status === 202) assert.equal((await response.json()).refunded, false);
  }
  for (const error of ['not_authorized', 'pass_not_flagged', 'refund_already_requested']) {
    const denied = setup('refund_pass', { result: { error } }); await denied.handle(req(refundBody)); assert.equal(denied.refunds.length, 0);
  }
  const replay = setup('refund_pass', { result: { ok: true, complete: true, pass_id: target, refund_usd_cents: 1299 } });
  assert.equal((await replay.handle(req(refundBody))).status, 200); assert.equal(replay.refunds.length, 0);
  const receiptFailed = setup('refund_pass', { completed: { error: 'private' } });
  assert.equal((await receiptFailed.handle(req(refundBody))).status, 503);
});
