import test from 'node:test';
import assert from 'node:assert/strict';
import { publishHandler, RIGHTS_VERSION } from '../lib/cinema/publishApi.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const NOW = Date.UTC(2026, 8, 26, 12, 0, 0);
Object.assign(process.env, { CINEMA_ENABLED: 'true', SOCIAL_CINEMA_PROFILES_ENABLED: 'true', CREATOR_CONTENT_ENABLED: 'true', CINEMA_PUBLISHING_ENABLED: 'true', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud' });
const adminHeaders = { 'x-veyrnox-auth-aal': 'aal2', 'x-veyrnox-auth-mfa-at': String(Math.floor(NOW / 1000) - 10), 'cf-access-jwt-assertion': 'token' };
const post = (path, body, headers = {}) => new Request(`https://test.invalid/api/v1/${path}`, { method: 'POST', headers: { 'x-veyrnox-auth-id': id, 'idempotency-key': id, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
const get = (path, headers = {}) => new Request(`https://test.invalid/api/v1/${path}`, { headers: { 'x-veyrnox-auth-id': id, ...headers } });

function setup(action, result, { rate = { ok: true }, access = async () => ({}) } = {}) {
  const calls = [];
  const handle = publishHandler({ action, accessVerifier: access, now: () => NOW, rpcCall: async (name, args) => { calls.push({ name, args }); return name === 'consume_account_read_request' ? rate : result; } });
  return { calls, handle };
}

test('a submission needs identity, the publishing switch, a UUID key and the rights wording in force', async () => {
  const s = setup('submit', { id: other, content_id: id, status: 'pending', idempotent: false });
  assert.equal((await s.handle(post('cinema/content/submit', { content_id: id, rights_version: RIGHTS_VERSION }, { 'x-veyrnox-auth-id': '' }))).status, 401);
  for (const flag of ['CINEMA_ENABLED', 'CREATOR_CONTENT_ENABLED', 'CINEMA_PUBLISHING_ENABLED']) { process.env[flag] = 'false'; assert.equal((await s.handle(post('cinema/content/submit', { content_id: id, rights_version: RIGHTS_VERSION }))).status, 503); process.env[flag] = 'true'; }
  assert.equal((await s.handle(post('cinema/content/submit', { content_id: id, rights_version: RIGHTS_VERSION }, { 'idempotency-key': 'nope' }))).status, 400);
  const stale = await s.handle(post('cinema/content/submit', { content_id: id, rights_version: 'rights-2020-01-01' }));
  assert.equal(stale.status, 400);
  assert.equal((await stale.json()).rights_version, RIGHTS_VERSION);
  for (const body of [{ content_id: 'x', rights_version: RIGHTS_VERSION }, { content_id: id, rights_version: RIGHTS_VERSION, extra: 1 }, [1]]) assert.equal((await s.handle(post('cinema/content/submit', body))).status, 400);
  assert.equal(s.calls.length, 0);
  const res = await s.handle(post('cinema/content/submit', { content_id: id, rights_version: RIGHTS_VERSION }));
  assert.equal(res.status, 201);
  assert.deepEqual(s.calls[1].args, { p_auth_id: id, p_idempotency_key: id, p_content_id: id, p_rights_version: RIGHTS_VERSION });
  for (const [error, status] of [['video_not_ready', 422], ['no_episodes', 422], ['already_submitted', 409], ['already_published', 409], ['suspended', 409], ['creator_required', 403], ['content_not_found', 404], ['idempotency_conflict', 409], ['private_detail', 503]]) {
    const r = await setup('submit', { error, missing: 2 }).handle(post('cinema/content/submit', { content_id: id, rights_version: RIGHTS_VERSION }));
    assert.equal(r.status, status, error);
    const data = await r.json();
    assert.equal(data.error, error === 'private_detail' ? 'temporarily_unavailable' : error);
    if (error === 'video_not_ready') assert.equal(data.missing, 2);
  }
  const replay = await setup('submit', { id: other, content_id: id, status: 'pending', idempotent: true }).handle(post('cinema/content/submit', { content_id: id, rights_version: RIGHTS_VERSION }));
  assert.equal(replay.status, 200);
});

test('a withdrawal carries a reason and reports what it reversed', async () => {
  const s = setup('withdraw', { content_id: id, status: 'DRAFT', unlocks_reversed: 3, credits_returned: 18, idempotent: false });
  assert.equal((await s.handle(post('cinema/content/withdraw', { content_id: id, reason: 'no' }))).status, 400);
  const res = await s.handle(post('cinema/content/withdraw', { content_id: id, reason: '  Rights changed  ' }));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).unlocks_reversed, 3);
  assert.equal(s.calls[1].args.p_reason, 'Rights changed');
  assert.equal((await setup('withdraw', { error: 'not_withdrawable' }).handle(post('cinema/content/withdraw', { content_id: id, reason: 'Rights changed' }))).status, 409);
});

test('the queue, review and suspend need a fresh second factor and an Access assertion, then re-check the role in the database', async () => {
  const queue = setup('queue', { submissions: [{ id: other, title: 'A story' }] });
  assert.equal((await queue.handle(get('admin/cinema/submissions'))).status, 403);
  assert.equal((await queue.handle(get('admin/cinema/submissions', { ...adminHeaders, 'x-veyrnox-auth-aal': 'aal1' }))).status, 403);
  assert.equal((await queue.handle(get('admin/cinema/submissions', { ...adminHeaders, 'x-veyrnox-auth-mfa-at': String(Math.floor(NOW / 1000) - 900) }))).status, 403);
  assert.equal((await queue.handle(get('admin/cinema/submissions', { ...adminHeaders, 'cf-access-jwt-assertion': '' }))).status, 403);
  assert.equal((await setup('queue', {}, { access: async () => { throw new Error('bad'); } }).handle(get('admin/cinema/submissions', adminHeaders))).status, 403);
  assert.equal(queue.calls.length, 0);
  const res = await queue.handle(get('admin/cinema/submissions', adminHeaders));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).submissions[0].title, 'A story');
  assert.deepEqual(queue.calls[1].args, { p_auth_id: id, p_aal: 'aal2', p_mfa_at: Math.floor(NOW / 1000) - 10 });
  const denied = setup('queue', { error: 'not_authorized' });
  assert.equal((await denied.handle(get('admin/cinema/submissions', adminHeaders))).status, 403);

  const review = setup('review', { id: other, content_id: id, status: 'approved', idempotent: false });
  for (const body of [{ submission_id: other, decision: 'maybe', reason: 'Looks fine' }, { submission_id: other, decision: 'approved', reason: 'ok' }, { submission_id: other, decision: 'rejected', reason: 'Not yet', creator_note: 'x'.repeat(501) }, { submission_id: other, decision: 'approved', reason: 'Looks fine', user_id: id }]) {
    assert.equal((await review.handle(post('admin/cinema/submissions', body, adminHeaders))).status, 400, JSON.stringify(body));
  }
  const ok = await review.handle(post('admin/cinema/submissions', { submission_id: other, decision: 'rejected', reason: 'Audio missing', creator_note: ' Please add audio to episode 3. ' }, adminHeaders));
  assert.equal(ok.status, 200);
  const args = review.calls.at(-1).args;
  assert.deepEqual([args.p_submission_id, args.p_decision, args.p_reason, args.p_creator_note, args.p_aal], [other, 'rejected', 'Audio missing', 'Please add audio to episode 3.', 'aal2']);
  assert.match(args.p_request_id, /^[0-9a-f-]{36}$/);
  for (const [error, status] of [['self_review_forbidden', 403], ['already_reviewed', 409], ['submission_not_found', 404], ['not_authorized', 403]]) {
    assert.equal((await setup('review', { error }).handle(post('admin/cinema/submissions', { submission_id: other, decision: 'approved', reason: 'Looks fine' }, adminHeaders))).status, status, error);
  }
  const suspend = setup('suspend', { content_id: id, status: 'SUSPENDED', unlocks_reversed: 1, credits_returned: 6, idempotent: false });
  assert.equal((await suspend.handle(post('admin/cinema/suspend', { content_id: id, reason: 'Rights complaint upheld' }))).status, 403, 'no gate headers');
  const sres = await suspend.handle(post('admin/cinema/suspend', { content_id: id, reason: 'Rights complaint upheld' }, adminHeaders));
  assert.equal(sres.status, 200);
  assert.equal((await sres.json()).credits_returned, 6);
  const rateLimited = setup('suspend', {}, { rate: { ok: false, code: 'RATE_LIMITED' } });
  assert.equal((await rateLimited.handle(post('admin/cinema/suspend', { content_id: id, reason: 'Rights complaint upheld' }, adminHeaders))).status, 429);
});

test('upstream failures are redacted', async () => {
  const s = publishHandler({ action: 'submit', rpcCall: async () => { throw new Error('private connection string'); } });
  const res = await s(post('cinema/content/submit', { content_id: id, rights_version: RIGHTS_VERSION }));
  assert.equal(res.status, 503);
  assert.ok(!(await res.text()).includes('private'));
});
