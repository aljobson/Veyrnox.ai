// Real isolated Postgres: ballots, revoked accounts, competition windows and audit integrity.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
const url = process.env.DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1", "postgres"].includes(new URL(url).hostname)
)
  throw Error("isolated database required");
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const now = () => Math.floor(Date.now() / 1000);
const manage = (actor, payload, key = randomUUID(), mfa = now()) =>
  value("SELECT public.manage_cinema_story_polls($1,$2,$3,$4,$5,$6) AS value", [
    actor,
    "aal2",
    mfa,
    key,
    payload,
    randomUUID(),
  ]);
const vote = (actor, target, competition, key = randomUUID(), client = c) =>
  client
    .query("SELECT public.cast_cinema_story_choice($1,$2,$3,$4) AS value", [
      actor,
      key,
      target,
      competition,
    ])
    .then((r) => r.rows[0].value);
const read = (actor, target) =>
  value("SELECT public.read_cinema_story_polls($1,$2) AS value", [
    actor,
    target,
  ]);
async function person(role = "viewer") {
  const auth = randomUUID();
  await q(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [auth, `${auth}@example.invalid`],
  );
  await value("SELECT public.create_cinema_profile($1,$2,$3) AS value", [
    auth,
    randomUUID(),
    {
      username: `v_${auth.replaceAll("-", "").slice(0, 20)}`,
      display_name: role,
    },
  ]);
  await q(
    "UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",
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
    "SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value",
    [
      creator,
      randomUUID(),
      null,
      0,
      {
        content_type: "FILM",
        parent_id: null,
        position: null,
        title: "Voting fixture",
        synopsis: "Test",
        language: "en",
        ai_disclosures: ["generated_script"],
        categories: ["drama"],
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
const poll = (content_id, patch = {}) => ({
  action: "create_story_poll",
  content_id,
  question: "Which way next?",
  options: ["Forest", "River"],
  opens_at: new Date(Date.now() - 1000).toISOString(),
  closes_at: new Date(Date.now() + 86400000).toISOString(),
  reason: "Isolated acceptance",
  ...patch,
});
const rootEpisode = async (creator) => {
  const series = await title(creator, { content_type: "SERIES" });
  const season = await title(creator, {
    content_type: "SEASON",
    parent_id: series,
    position: 1,
    categories: undefined,
  });
  const episode = await title(creator, {
    content_type: "EPISODE",
    parent_id: season,
    position: 1,
    categories: undefined,
  });
  return { series, season, episode };
};
const choice = vote;
try {
  const sql = await readFile(
    new URL(
      "../packages/db/schema/supabase/0270_cinema_story_polls.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await c.query(sql);
  await c.query(sql);
  const creator = await person("creator"),
    admin = await person("administrator"),
    viewer = await person(),
    other = await person();
  const { series, season, episode } = await rootEpisode(creator),
    second = (await rootEpisode(creator)).episode,
    film = await title(creator);
  const before = await value(
    "SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason NOT LIKE 'grant:%'",
  );
  assert.equal((await manage(viewer, poll(episode))).error, "not_authorized");
  assert.equal(
    (await manage(admin, poll(episode), randomUUID(), now() - 600)).error,
    "not_authorized",
  );
  assert.equal((await manage(admin, poll(film))).error, "content_not_found");
  for (const patch of [
    { question: 1 },
    { options: null },
    { options: [] },
    { options: ["Left"] },
    { options: [" Left ", "left"] },
    { options: ["One", 2] },
    { options: ["One", "x".repeat(121)] },
    { opens_at: "infinity" },
    { closes_at: "2026-02-30T00:00:00Z" },
    { reason: 1 },
    { evil: true },
  ])
    assert.ok(
      (await manage(admin, poll(episode, patch))).error,
      JSON.stringify(patch),
    );
  const payload = poll(episode),
    key = randomUUID(),
    created = await manage(admin, payload, key);
  assert.equal(created.status, "open");
  assert.equal((await manage(admin, payload, key)).idempotent, true);
  assert.equal(
    (await manage(admin, { ...payload, question: "Changed" }, key)).error,
    "idempotency_conflict",
  );
  assert.equal((await manage(admin, poll(episode))).error, "poll_overlap");
  const item = (await read(null, episode)).polls[0],
    options = item.options;
  assert.equal(item.my_choice, null);
  assert.equal(item.is_open, true);
  assert.equal(options.length, 2);
  const secondPoll = await manage(admin, poll(second)),
    secondOptions = (await read(null, second)).polls[0].options;
  assert.equal(
    (await choice(viewer, created.id, secondOptions[0].id)).error,
    "invalid_choice",
  );
  const ballotKey = randomUUID(),
    ballot = await choice(viewer, created.id, options[0].id, ballotKey);
  assert.equal(ballot.status, "qualified");
  assert.equal(ballot.idempotent, false);
  assert.equal(
    (await choice(viewer, created.id, options[0].id, ballotKey)).id,
    ballot.id,
  );
  assert.equal((await choice(viewer, created.id, options[0].id)).id, ballot.id);
  assert.equal(
    (await choice(viewer, created.id, options[1].id)).error,
    "choice_already_recorded",
  );
  assert.equal(
    (await choice(viewer, secondPoll.id, secondOptions[0].id, ballotKey)).error,
    "idempotency_conflict",
  );
  assert.equal((await read(null, episode)).polls[0].options[0].votes, 1);
  assert.equal(
    (await read(viewer, episode)).polls[0].my_choice.option_id,
    options[0].id,
  );
  assert.equal((await read(other, episode)).polls[0].my_choice, null);
  await q(
    "UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",
    [viewer],
  );
  assert.equal(
    (await choice(viewer, secondPoll.id, secondOptions[0].id)).error,
    "profile_required",
  );
  assert.equal((await read(null, episode)).polls[0].options[0].votes, 0);
  await q(
    "UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",
    [viewer],
  );
  await q("UPDATE public.users SET frozen_at=now() WHERE auth_id=$1", [viewer]);
  assert.equal(
    (await choice(viewer, secondPoll.id, secondOptions[0].id)).error,
    "profile_required",
  );
  assert.equal((await read(null, episode)).polls[0].options[0].votes, 0);
  await q("UPDATE public.users SET frozen_at=NULL WHERE auth_id=$1", [viewer]);
  for (const target of [series, season, episode]) {
    await q(
      "UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=$1",
      [target],
    );
    assert.equal((await read(null, episode)).error, "content_not_found");
    assert.equal(
      (await choice(other, created.id, options[0].id)).error,
      "content_not_found",
    );
    await q(
      "UPDATE public.cinema_content SET visibility='PUBLIC' WHERE id=$1",
      [target],
    );
  }
  // Simultaneous different answers produce one ballot and an explicit conflict.
  const concurrent = await person(),
    peers = [
      new pg.Client({ connectionString: url }),
      new pg.Client({ connectionString: url }),
    ];
  await Promise.all(peers.map((p) => p.connect()));
  try {
    const results = await Promise.all(
      peers.map((p, i) =>
        choice(concurrent, created.id, options[i].id, randomUUID(), p),
      ),
    );
    assert.equal(results.filter((r) => r.status === "qualified").length, 1);
    assert.equal(
      results.filter((r) => r.error === "choice_already_recorded").length,
      1,
    );
    assert.equal(
      (await read(null, episode)).polls[0].options.reduce(
        (n, o) => n + o.votes,
        0,
      ),
      2,
    );
  } finally {
    await Promise.all(peers.map((p) => p.end()));
  }
  // Velocity holds answers until a different, eligible moderator approves.
  const fast = await person();
  let held, heldEpisode, heldOption;
  for (let i = 0; i < 11; i++) {
    const target = (await rootEpisode(creator)).episode,
      cp = await manage(admin, poll(target)),
      op = (await read(null, target)).polls[0].options[0];
    const b = await choice(fast, cp.id, op.id);
    assert.equal(b.status, i < 10 ? "qualified" : "under_review");
    if (i === 10) {
      held = b;
      heldEpisode = target;
      heldOption = op.id;
    }
  }
  assert.equal((await read(null, heldEpisode)).polls[0].options[0].votes, 0);
  await q(
    "UPDATE public.cinema_memberships SET role='administrator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",
    [fast],
  );
  const review = {
    action: "review_story_choice",
    id: held.id,
    decision: "qualified",
    reason: "Reviewed unusual activity",
  };
  assert.equal((await manage(fast, review)).error, "self_review_forbidden");
  assert.equal((await manage(admin, review)).status, "qualified");
  assert.equal(
    (await read(null, heldEpisode)).polls[0].options.find(
      (o) => o.id === heldOption,
    ).votes,
    1,
  );
  const close = {
    action: "close_story_poll",
    id: created.id,
    reason: "Window completed",
  };
  assert.equal((await manage(admin, close)).status, "closed");
  assert.equal((await choice(viewer, created.id, options[0].id)).id, ballot.id);
  assert.equal(
    (await choice(other, created.id, options[0].id)).error,
    "poll_closed",
  );
  assert.equal((await read(null, episode)).polls[0].is_open, false);
  assert.equal(
    (await read(null, episode)).polls[0].options.reduce(
      (n, o) => n + o.votes,
      0,
    ),
    2,
  );
  const future = await manage(
    admin,
    poll(episode, { opens_at: new Date(Date.now() + 3600000).toISOString() }),
  );
  const futureOption = await value(
    "SELECT id AS value FROM public.cinema_story_poll_options WHERE poll_id=$1 ORDER BY position LIMIT 1",
    [future.id],
  );
  assert.equal(
    (await choice(other, future.id, futureOption)).error,
    "poll_closed",
  );
  assert.equal(
    (await read(null, episode)).polls.some((p) => p.id === future.id),
    false,
  );
  await q("DELETE FROM auth.users WHERE id=$1", [other]);
  assert.equal(
    (await choice(other, secondPoll.id, secondOptions[0].id)).error,
    "profile_required",
  );
  // A deadline still holds after waiting on the per-voter lock.
  const deadlineActor = await person(),
    deadlineEpisode = (await rootEpisode(creator)).episode;
  const deadline = await manage(
    admin,
    poll(deadlineEpisode, {
      closes_at: new Date(Date.now() + 1400).toISOString(),
    }),
  );
  const deadlineOption = (await read(null, deadlineEpisode)).polls[0].options[0]
    .id;
  const locker = new pg.Client({ connectionString: url }),
    waiter = new pg.Client({ connectionString: url });
  await locker.connect();
  await waiter.connect();
  try {
    await locker.query("BEGIN");
    await locker.query(
      "SELECT pg_advisory_xact_lock(270,hashtext(id::text)) FROM public.users WHERE auth_id=$1",
      [deadlineActor],
    );
    const pending = choice(
      deadlineActor,
      deadline.id,
      deadlineOption,
      randomUUID(),
      waiter,
    );
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await locker.query("COMMIT");
    assert.equal((await pending).error, "poll_closed");
    // Fresh MFA is rechecked after the shared administrator audit lock.
    await locker.query("BEGIN");
    await locker.query(
      "SELECT pg_advisory_xact_lock(266,hashtext(id::text)) FROM public.users WHERE auth_id=$1",
      [admin],
    );
    const pendingClose = waiter.query(
      "SELECT public.manage_cinema_story_polls($1,$2,$3,$4,$5,$6) AS value",
      [
        admin,
        "aal2",
        now() - 299,
        randomUUID(),
        { ...close, id: secondPoll.id },
        randomUUID(),
      ],
    );
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await locker.query("COMMIT");
    assert.equal((await pendingClose).rows[0].value.error, "not_authorized");
  } finally {
    await locker.end();
    await waiter.end();
  }
  await q("UPDATE public.users SET frozen_at=now() WHERE auth_id=$1", [
    creator,
  ]);
  assert.equal((await read(null, episode)).error, "content_not_found");
  await q("UPDATE public.users SET frozen_at=NULL WHERE auth_id=$1", [creator]);
  // Bounded inventory refuses another poll without creating options or audit rows.
  await q("BEGIN");
  await q(
    "INSERT INTO public.cinema_story_polls(content_id,question,opens_at,closes_at,created_by) SELECT $1,'Capacity fixture',now(),now()+interval '1 day',(SELECT id FROM public.users WHERE auth_id=$2) FROM generate_series(1,100)",
    [second, admin],
  );
  const capacityEpisode = (await rootEpisode(creator)).episode;
  assert.equal(
    (await manage(admin, poll(capacityEpisode))).error,
    "poll_capacity",
  );
  await q("ROLLBACK");
  for (const table of [
    "cinema_story_polls",
    "cinema_story_poll_options",
    "cinema_story_poll_votes",
  ]) {
    const r = (
      await q(
        "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
        [`public.${table}`],
      )
    )[0];
    assert.equal(r.relrowsecurity, true);
    assert.equal(r.relforcerowsecurity, true);
    for (const role of ["anon", "authenticated", "service_role"])
      for (const grant of [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE",
        "TRUNCATE",
        "REFERENCES",
        "TRIGGER",
      ])
        assert.equal(
          await value("SELECT has_table_privilege($1,$2,$3) AS value", [
            role,
            `public.${table}`,
            grant,
          ]),
          false,
        );
  }
  for (const fn of [
    "cast_cinema_story_choice(text,uuid,uuid,uuid)",
    "read_cinema_story_polls(text,uuid)",
    "manage_cinema_story_polls(text,text,bigint,uuid,jsonb,uuid)",
    "list_cinema_story_polls_review(text,text,bigint)",
  ]) {
    for (const role of ["anon", "authenticated"])
      assert.equal(
        await value("SELECT has_function_privilege($1,$2,'EXECUTE') AS value", [
          role,
          `public.${fn}`,
        ]),
        false,
      );
    assert.equal(
      await value(
        "SELECT has_function_privilege('service_role',$1,'EXECUTE') AS value",
        [`public.${fn}`],
      ),
      true,
    );
    const f = (
      await q(
        "SELECT prosecdef,proconfig FROM pg_proc WHERE oid=$1::regprocedure",
        [`public.${fn}`],
      )
    )[0];
    assert.equal(f.prosecdef, true);
    assert.ok(f.proconfig.includes('search_path=""'));
  }
  assert.equal(
    await value(
      "SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason NOT LIKE 'grant:%'",
    ),
    before,
  );
  console.log(
    "Story polls: distinct immutable answers, privacy, current eligibility, overlapping windows, concurrency, held-choice review, deadline/MFA lock waits, bounded inventory and service-only RLS/ACL boundaries pass; no Credits moved.",
  );
} finally {
  await c.end();
}
