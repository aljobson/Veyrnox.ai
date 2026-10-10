// Real isolated Postgres: ballots, revoked accounts, competition windows and audit integrity.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (
  !url ||
  !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)
)
  throw Error('isolated database required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const now = () => Math.floor(Date.now() / 1000);
const manage = (actor, payload, key = randomUUID(), mfa = now()) =>
  value('SELECT public.manage_cinema_voting($1,$2,$3,$4,$5,$6) AS value', [
    actor,
    'aal2',
    mfa,
    key,
    payload,
    randomUUID(),
  ]);
const vote = (actor, target, competition, key = randomUUID(), client = c) =>
  client
    .query('SELECT public.cast_cinema_vote($1,$2,$3,$4) AS value', [
      actor,
      key,
      target,
      competition,
    ])
    .then((r) => r.rows[0].value);
const read = (actor, target) =>
  value('SELECT public.read_cinema_voting($1,$2) AS value', [actor, target]);
async function person(role = 'viewer') {
  const auth = randomUUID();
  await q(
    'INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',
    [auth, `${auth}@example.invalid`],
  );
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [
    auth,
    randomUUID(),
    {
      username: `v_${auth.replaceAll('-', '').slice(0, 20)}`,
      display_name: role,
    },
  ]);
  await q(
    'UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',
    [auth, role],
  );
  return auth;
}
async function title(creator, patch = {}) {
  if (patch.parent_id)
    await q(
      "UPDATE public.cinema_content SET lifecycle_status='DRAFT',visibility='PRIVATE' WHERE id=$1",
      [patch.parent_id],
    );
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
        title: 'Voting fixture',
        synopsis: 'Test',
        language: 'en',
        ai_disclosures: ['generated_script'],
        categories: ['drama'],
        ...patch,
      },
    ],
  );
  assert.ok(saved.id, JSON.stringify(saved));
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC' WHERE id=$1",
    [saved.id],
  );
  if (patch.parent_id)
    await q(
      "UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC' WHERE id=$1",
      [patch.parent_id],
    );
  return saved.id;
}
const competition = (name = 'Local competition', patch = {}) => ({
  action: 'create_competition',
  name,
  starts_at: new Date(Date.now() - 1000).toISOString(),
  ends_at: new Date(Date.now() + 86400000).toISOString(),
  target_types: ['FILM', 'SERIES', 'EPISODE'],
  reason: 'Isolated acceptance',
  ...patch,
});
try {
  const sql = await readFile(
    new URL(
      '../packages/db/schema/supabase/0266_cinema_qualified_voting.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await c.query(sql);
  await c.query(sql);
  const truncateGuard = await readFile(
    new URL(
      '../packages/db/schema/supabase/0268_cinema_community_truncate_guard.sql',
      import.meta.url,
    ),
    'utf8',
  );
  await c.query(truncateGuard);
  await c.query(truncateGuard);
  const creator = await person('creator'),
    admin = await person('administrator'),
    viewer = await person(),
    other = await person();
  const film = await title(creator),
    second = await title(creator);
  const before = await value(
    "SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason NOT LIKE 'grant:%'",
  );
  assert.equal((await manage(viewer, competition())).error, 'not_authorized');
  assert.equal(
    (await manage(admin, competition(), randomUUID(), now() - 600)).error,
    'not_authorized',
  );
  for (const patch of [
    { name: 1 },
    { target_types: null },
    { target_types: [] },
    { target_types: ['FILM', 'FILM'] },
    { starts_at: 'infinity' },
    { ends_at: '2026-02-30T00:00:00Z' },
    { reason: 123 },
    { evil: true },
  ]) {
    const r = await manage(admin, competition('Invalid', patch));
    assert.ok(r.error, JSON.stringify(patch));
  }
  const payload = competition(),
    key = randomUUID(),
    comp = await manage(admin, payload, key);
  assert.equal(comp.status, 'open');
  assert.equal((await manage(admin, payload, key)).idempotent, true);
  assert.equal(
    (await manage(admin, { ...payload, name: 'Changed' }, key)).error,
    'idempotency_conflict',
  );
  const ballotKey = randomUUID(),
    ballot = await vote(viewer, film, comp.id, ballotKey);
  assert.equal(ballot.status, 'qualified');
  assert.equal(ballot.idempotent, false);
  assert.equal((await vote(viewer, film, comp.id, ballotKey)).id, ballot.id);
  assert.equal((await vote(viewer, film, comp.id)).id, ballot.id);
  assert.equal(
    (await vote(viewer, second, comp.id, ballotKey)).error,
    'idempotency_conflict',
  );
  assert.equal(
    (await read(null, film)).competitions.find((x) => x.id === comp.id)
      .qualified_votes,
    1,
  );
  assert.equal(
    (await read(null, film)).competitions.find((x) => x.id === comp.id).my_vote,
    null,
  );
  assert.equal(
    (await read(viewer, film)).competitions.find((x) => x.id === comp.id)
      .my_vote.id,
    ballot.id,
  );
  await q(
    "UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",
    [viewer],
  );
  assert.equal((await vote(viewer, second, comp.id)).error, 'profile_required');
  assert.equal(
    (await read(null, film)).competitions.find((x) => x.id === comp.id)
      .qualified_votes,
    0,
  );
  await q(
    "UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",
    [viewer],
  );
  await q('UPDATE public.users SET frozen_at=now() WHERE auth_id=$1', [viewer]);
  assert.equal((await vote(viewer, second, comp.id)).error, 'profile_required');
  await q('UPDATE public.users SET frozen_at=NULL WHERE auth_id=$1', [viewer]);
  await q("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=$1", [
    film,
  ]);
  assert.equal((await read(null, film)).error, 'content_not_found');
  assert.equal((await vote(other, film, comp.id)).error, 'content_not_found');
  await q("UPDATE public.cinema_content SET visibility='PUBLIC' WHERE id=$1", [
    film,
  ]);
  const series = await title(creator, { content_type: 'SERIES' });
  const season = await title(creator, {
    content_type: 'SEASON',
    parent_id: series,
    position: 1,
    categories: undefined,
  });
  const episode = await title(creator, {
    content_type: 'EPISODE',
    parent_id: season,
    position: 1,
    categories: undefined,
  });
  assert.ok((await vote(other, episode, comp.id)).id);
  await q("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=$1", [
    season,
  ]);
  assert.equal((await read(null, episode)).error, 'content_not_found');
  await q("UPDATE public.cinema_content SET visibility='PUBLIC' WHERE id=$1", [
    season,
  ]);
  // Ten rapid ballots count; further ballots are held for administrator review.
  const fast = await person();
  const targets = [];
  for (let i = 0; i < 12; i++) {
    targets.push(await title(creator));
    const b = await vote(fast, targets[i], comp.id);
    assert.equal(b.status, i < 10 ? 'qualified' : 'under_review');
  }
  const held = (await read(fast, targets[10])).competitions.find(
    (x) => x.id === comp.id,
  ).my_vote;
  assert.equal(
    (await read(null, targets[10])).competitions.find((x) => x.id === comp.id)
      .qualified_votes,
    0,
  );
  assert.equal(
    (
      await manage(admin, {
        action: 'review_vote',
        id: held.id,
        decision: 'qualified',
        reason: 'Reviewed activity',
      })
    ).status,
    'qualified',
  );
  assert.equal(
    (await read(null, targets[10])).competitions.find((x) => x.id === comp.id)
      .qualified_votes,
    1,
  );
  await q(
    "UPDATE public.cinema_memberships SET role='administrator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",
    [fast],
  );
  assert.equal(
    (
      await manage(fast, {
        action: 'review_vote',
        id: held.id,
        decision: 'qualified',
        reason: 'Self approval',
      })
    ).error,
    'self_review_forbidden',
  );
  // Real concurrent duplicate requests: one row, one fresh result, one replay.
  const concurrentViewer = await person(),
    peers = [
      new pg.Client({ connectionString: url }),
      new pg.Client({ connectionString: url }),
    ];
  await Promise.all(peers.map((p) => p.connect()));
  try {
    const results = await Promise.all(
      peers.map((p) =>
        vote(concurrentViewer, second, comp.id, randomUUID(), p),
      ),
    );
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    assert.deepEqual(results.map((r) => r.idempotent).sort(), [false, true]);
  } finally {
    await Promise.all(peers.map((p) => p.end()));
  }
  const close = {
    action: 'close_competition',
    id: comp.id,
    reason: 'Window completed',
  };
  assert.equal((await manage(admin, close)).status, 'closed');
  assert.equal((await vote(viewer, film, comp.id)).id, ballot.id);
  assert.equal(
    (await vote(other, second, comp.id)).error,
    'competition_closed',
  );
  assert.equal(
    (await read(null, film)).competitions.some((x) => x.id === comp.id),
    false,
  );
  const future = await manage(
    admin,
    competition('Future', {
      starts_at: new Date(Date.now() + 3600000).toISOString(),
    }),
  );
  assert.equal(
    (await vote(other, film, future.id)).error,
    'competition_closed',
  );
  const live = await manage(admin, competition('Revocation'));
  await q('DELETE FROM auth.users WHERE id=$1', [other]);
  assert.equal((await vote(other, film, live.id)).error, 'profile_required');
  // A request waiting on the per-voter lock cannot use its old transaction time
  // to vote after the competition deadline.
  const deadlineActor = await person(),
    deadline = await manage(
      admin,
      competition('Deadline', {
        ends_at: new Date(Date.now() + 1200).toISOString(),
      }),
    );
  const locker = new pg.Client({ connectionString: url }),
    waiter = new pg.Client({ connectionString: url });
  await locker.connect();
  await waiter.connect();
  try {
    await locker.query('BEGIN');
    await locker.query(
      'SELECT pg_advisory_xact_lock(266,hashtext(id::text)) FROM public.users WHERE auth_id=$1',
      [deadlineActor],
    );
    const pending = vote(
      deadlineActor,
      second,
      deadline.id,
      randomUUID(),
      waiter,
    );
    await new Promise((resolve) => setTimeout(resolve, 1400));
    await locker.query('COMMIT');
    assert.equal((await pending).error, 'competition_closed');
  } finally {
    await locker.end();
    await waiter.end();
  }
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
      'SELECT public.manage_cinema_voting($1,$2,$3,$4,$5,$6) AS value',
      [
        admin,
        'aal2',
        Math.floor(Date.now() / 1000) - 299,
        randomUUID(),
        {
          action: 'close_competition',
          id: live.id,
          reason: 'Expired authentication fixture',
        },
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
  assert.equal((await read(null, film)).error, 'content_not_found');
  await q('UPDATE public.users SET frozen_at=NULL WHERE auth_id=$1', [creator]);
  // Service functions only; browser table grants and RPC execution denied.
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(
      await value(
        "SELECT has_table_privilege($1,'public.cinema_votes','SELECT') AS value",
        [role],
      ),
      false,
    );
    assert.equal(
      await value(
        "SELECT has_function_privilege($1,'public.cast_cinema_vote(text,uuid,uuid,uuid)','EXECUTE') AS value",
        [role],
      ),
      role === 'service_role',
    );
  }
  for (const sql of [
    'UPDATE public.cinema_community_actions SET reason=reason',
    'DELETE FROM public.cinema_community_actions',
    'TRUNCATE public.cinema_community_actions',
  ])
    await assert.rejects(c.query(sql), /append.only|immutable/i);
  assert.equal(
    await value(
      "SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason NOT LIKE 'grant:%'",
    ),
    before,
    'voting never spends or grants Credits',
  );
  console.log(
    'Cinema qualified voting: windows, uniqueness, concurrent replay, velocity hold, review, current Auth/roles, ancestor privacy, ACL and immutable audit passed',
  );
} finally {
  await c.end();
}
