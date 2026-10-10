import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)
)
  throw Error('isolated local database required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const mutate = (actor, payload, key = randomUUID(), client = c) =>
  client
    .query('SELECT public.mutate_cinema_comments($1,$2,$3) AS value', [
      actor,
      key,
      payload,
    ])
    .then((r) => r.rows[0].value);
const manage = (
  actor,
  payload,
  key = randomUUID(),
  mfa = Math.floor(Date.now() / 1000),
) =>
  value('SELECT public.manage_cinema_comments($1,$2,$3,$4,$5,$6) AS value', [
    actor,
    'aal2',
    mfa,
    key,
    payload,
    randomUUID(),
  ]);
const read = (actor, target, before = null) =>
  value('SELECT public.read_cinema_comments($1,$2,$3) AS value', [
    actor,
    target,
    before,
  ]);
async function person(role = 'viewer') {
  const a = randomUUID();
  await q(
    'INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',
    [a, `${a}@example.invalid`],
  );
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [
    a,
    randomUUID(),
    { username: `c_${a.replaceAll('-', '').slice(0, 20)}`, display_name: role },
  ]);
  await q(
    'UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',
    [a, role],
  );
  return a;
}
try {
  const sql = await readFile(
    new URL(
      '../packages/db/schema/supabase/0267_cinema_preapproved_comments.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await c.query(sql);
  await c.query(sql);
  const creator = await person('creator'),
    admin = await person('administrator'),
    author = await person(),
    reporter = await person();
  const saved = await value(
    'SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value',
    [
      creator,
      randomUUID(),
      null,
      0,
      {
        content_type: 'FILM',
        parent_id: null,
        position: null,
        title: 'Comment fixture',
        synopsis: 'Test',
        language: 'en',
        categories: ['drama'],
        ai_disclosures: ['generated_script'],
      },
    ],
  );
  assert.ok(saved.id);
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC' WHERE id=$1",
    [saved.id],
  );
  const payload = {
      action: 'submit',
      content_id: saved.id,
      body: '<script>alert("untrusted text")</script>',
    },
    key = randomUUID();
  for (const p of [
    { ...payload, status: 'approved' },
    { ...payload, body: 3 },
    { action: 'submit', content_id: saved.id, body: '' },
    {
      action: 'report',
      comment_id: randomUUID(),
      category: 'x',
      details: 'Bad',
    },
  ])
    assert.ok((await mutate(author, p)).error);
  const comment = await mutate(author, payload, key);
  assert.equal(comment.status, 'pending');
  assert.equal((await mutate(author, payload, key)).idempotent, true);
  assert.equal(
    (await mutate(author, { ...payload, body: 'Changed' }, key)).error,
    'idempotency_conflict',
  );
  assert.equal((await read(null, saved.id)).comments.length, 0);
  assert.equal((await read(reporter, saved.id)).own_comments.length, 0);
  assert.equal(
    (await read(author, saved.id)).own_comments[0].body,
    payload.body,
  );
  assert.equal(
    (await mutate(author, { ...payload, body: 'Second' })).error,
    'rate_limited',
  );
  assert.equal(
    (await mutate(reporter, { action: 'withdraw', comment_id: comment.id }))
      .error,
    'comment_not_found',
  );
  const decision = {
    action: 'review_comment',
    id: comment.id,
    decision: 'approved',
    reason: 'Reviewed and acceptable',
  };
  assert.equal((await manage(author, decision)).error, 'not_authorized');
  assert.equal(
    (
      await manage(
        admin,
        decision,
        randomUUID(),
        Math.floor(Date.now() / 1000) - 600,
      )
    ).error,
    'not_authorized',
  );
  const reviewKey = randomUUID();
  assert.equal((await manage(admin, decision, reviewKey)).status, 'approved');
  assert.equal((await manage(admin, decision, reviewKey)).idempotent, true);
  assert.equal((await manage(admin, decision)).error, 'already_reviewed');
  const publicRead = await read(null, saved.id);
  assert.equal(publicRead.comments[0].body, payload.body);
  assert.equal(publicRead.own_comments.length, 0);
  assert.equal(Object.hasOwn(publicRead.comments[0], 'author_id'), false);
  assert.equal(
    (
      await mutate(author, {
        action: 'report',
        comment_id: comment.id,
        category: 'spam',
        details: 'Self report',
      })
    ).error,
    'self_report_forbidden',
  );
  const reportPayload = {
      action: 'report',
      comment_id: comment.id,
      category: 'abuse',
      details: 'Please review this text',
    },
    reportKey = randomUUID();
  const report = await mutate(reporter, reportPayload, reportKey);
  assert.equal(report.status, 'open');
  assert.equal((await mutate(reporter, reportPayload)).id, report.id);
  const queue = await value(
    'SELECT public.list_cinema_comment_review($1,$2,$3) AS value',
    [admin, 'aal2', Math.floor(Date.now() / 1000)],
  );
  assert.ok(queue.reports.some((r) => r.id === report.id));
  assert.equal(
    (
      await manage(admin, {
        action: 'review_comment',
        id: comment.id,
        decision: 'removed',
        reason: 'Report upheld',
      })
    ).status,
    'removed',
  );
  assert.equal((await read(null, saved.id)).comments.length, 0);
  assert.equal(
    (
      await manage(admin, {
        action: 'resolve_report',
        id: report.id,
        reason: 'Action taken',
      })
    ).status,
    'resolved',
  );
  assert.equal((await mutate(reporter, reportPayload)).status, 'resolved');
  // Withdrawals remain author-scoped even after a title is hidden.
  await q("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=$1", [
    saved.id,
  ]);
  assert.equal((await read(null, saved.id)).error, 'content_not_found');
  assert.equal(
    (await mutate(author, { action: 'withdraw', comment_id: comment.id }))
      .status,
    'withdrawn',
  );
  assert.equal((await manage(admin, decision)).error, 'already_reviewed');
  await q("UPDATE public.cinema_content SET visibility='PUBLIC' WHERE id=$1", [
    saved.id,
  ]);
  // Two overlapping retries produce exactly one pending comment.
  const fresh = await person(),
    peers = [
      new pg.Client({ connectionString: url }),
      new pg.Client({ connectionString: url }),
    ],
    retry = randomUUID();
  await Promise.all(peers.map((p) => p.connect()));
  try {
    const results = await Promise.all(
      peers.map((p) =>
        mutate(fresh, { ...payload, body: 'Concurrent comment' }, retry, p),
      ),
    );
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.deepEqual(results.map((r) => r.idempotent).sort(), [false, true]);
  } finally {
    await Promise.all(peers.map((p) => p.end()));
  }
  const freshComment = (await read(fresh, saved.id)).own_comments[0];
  await q(
    "UPDATE public.cinema_memberships SET role='administrator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",
    [fresh],
  );
  assert.equal(
    (await manage(fresh, { ...decision, id: freshComment.id })).error,
    'self_review_forbidden',
  );
  await q('DELETE FROM auth.users WHERE id=$1', [fresh]);
  assert.equal(
    (await mutate(fresh, { action: 'withdraw', comment_id: freshComment.id }))
      .error,
    'profile_required',
  );
  assert.equal(
    (await manage(admin, { ...decision, id: freshComment.id })).error,
    'account_not_active',
  );
  // Fresh MFA must still be fresh after a contended per-administrator lock.
  const adminLocker = new pg.Client({ connectionString: url }),
    adminWaiter = new pg.Client({ connectionString: url });
  await adminLocker.connect();
  await adminWaiter.connect();
  try {
    await adminLocker.query('BEGIN');
    await adminLocker.query(
      'SELECT pg_advisory_xact_lock(266,hashtext(id::text)) FROM public.users WHERE auth_id=$1',
      [admin],
    );
    const pendingDecision = adminWaiter.query(
      'SELECT public.manage_cinema_comments($1,$2,$3,$4,$5,$6) AS value',
      [
        admin,
        'aal2',
        Math.floor(Date.now() / 1000) - 299,
        randomUUID(),
        { ...decision, id: freshComment.id },
        randomUUID(),
      ],
    );
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await adminLocker.query('COMMIT');
    assert.equal((await pendingDecision).rows[0].value.error, 'not_authorized');
  } finally {
    await adminLocker.end();
    await adminWaiter.end();
  }
  // A frozen creator immediately makes this title unavailable to community reads.
  await q('UPDATE public.users SET frozen_at=now() WHERE auth_id=$1', [
    creator,
  ]);
  assert.equal((await read(null, saved.id)).error, 'content_not_found');
  await q('UPDATE public.users SET frozen_at=NULL WHERE auth_id=$1', [creator]);
  // Forced RLS, revoked table grants, service-only functions and immutable audit.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(
      await value(
        "SELECT has_table_privilege($1,'public.cinema_comments','SELECT') AS value",
        [role],
      ),
      false,
    );
    assert.equal(
      await value(
        "SELECT has_function_privilege($1,'public.mutate_cinema_comments(text,uuid,jsonb)','EXECUTE') AS value",
        [role],
      ),
      role === 'service_role',
    );
  }
  console.log(
    'Cinema comments: pre-approval privacy, ownership, strict payloads, idempotency/concurrency, reports/removal, withdrawal, current Auth/roles and ACL passed',
  );
} finally {
  await c.end();
}
