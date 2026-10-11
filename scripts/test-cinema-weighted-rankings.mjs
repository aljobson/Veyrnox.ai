import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
const url = process.env.DATABASE_URL;
if (
  !url ||
  !["127.0.0.1", "localhost", "postgres"].includes(new URL(url).hostname)
)
  throw Error("local database required");
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (s, a = []) => (await c.query(s, a)).rows;
const val = async (s, a = []) => (await q(s, a))[0]?.value;
async function person(role) {
  const auth = randomUUID();
  await q(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [auth, `${auth}@example.invalid`],
  );
  await val("SELECT public.create_cinema_profile($1,$2,$3) AS value", [
    auth,
    randomUUID(),
    {
      username: `r_${auth.replaceAll("-", "").slice(0, 20)}`,
      display_name: role,
    },
  ]);
  const id = await val(
    "SELECT id AS value FROM public.users WHERE auth_id=$1",
    [auth],
  );
  await q("UPDATE public.cinema_memberships SET role=$2 WHERE user_id=$1", [
    id,
    role,
  ]);
  return { auth, id };
}
async function title(owner, name) {
  const draft = await val(
    "SELECT public.save_cinema_draft($1,$2,NULL,0,$3) AS value",
    [
      owner.auth,
      randomUUID(),
      {
        content_type: "SHORT",
        parent_id: null,
        position: null,
        title: name,
        synopsis: "Ranking fixture",
        language: "en",
        ai_disclosures: ["generated_script"],
        categories: ["drama"],
      },
    ],
  );
  assert.ok(draft.id, JSON.stringify(draft));
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at=now()-interval '2 days' WHERE id=$1",
    [draft.id],
  );
  const [u] = await q(
    "INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,duration_seconds) VALUES($1,$2,$3,100,$4,'ready',$5,90) RETURNING id",
    [
      draft.id,
      owner.id,
      randomUUID(),
      randomUUID().replaceAll("-", "").padEnd(64, "a"),
      randomUUID().replaceAll("-", ""),
    ],
  );
  return { id: draft.id, upload: u.id };
}
try {
  for (const file of [
    "0281_cinema_audience_signals",
    "0282_cinema_weighted_rankings",
  ]) {
    const s = await readFile(
      new URL(`../packages/db/schema/supabase/${file}.sql`, import.meta.url),
      "utf8",
    );
    await q(s);
    await q(s);
  }
  await q("BEGIN");
  const owner = await person("creator"),
    a = await person("administrator"),
    b = await person("administrator"),
    viewers = await Promise.all(
      Array.from({ length: 10 }, () => person("viewer")),
    ),
    film = await title(owner, "Full response"),
    other = await title(owner, "Votes alone");
  for (const u of viewers)
    for (const t of [film, other]) {
      const r = await val(
        "SELECT public.unlock_cinema_content($1,$2,$3) AS value",
        [u.auth, t.id, "unlock-2026-09-26"],
      );
      assert.equal(r.ok, true, JSON.stringify(r));
    }
  const ledger = await val(
    "SELECT count(*) AS value FROM public.ledger_entries",
  );
  const session = randomUUID();
  const begun = await val(
    "SELECT public.begin_cinema_watch_session($1,$2,$3) AS value",
    [viewers[0].auth, film.id, session],
  );
  assert.equal(begun.session_id, session);
  const beat = randomUUID();
  const args = [viewers[0].auth, session, beat, 30, JSON.stringify([[0, 30]])];
  let progress = await val(
    "SELECT public.record_cinema_watch_progress($1,$2,$3,$4,$5) AS value",
    args,
  );
  assert.equal(progress.seconds, 0, "opening a player earns no watch time");
  assert.equal(
    (
      await val(
        "SELECT public.record_cinema_watch_progress($1,$2,$3,$4,$5) AS value",
        args,
      )
    ).idempotent,
    true,
  );
  assert.equal(
    (
      await val(
        "SELECT public.record_cinema_watch_progress($1,$2,$3,$4,$5) AS value",
        [...args.slice(0, 4), JSON.stringify([[30, 60]])],
      )
    ).error,
    "idempotency_conflict",
  );
  await new Promise((r) => setTimeout(r, 1100));
  await q(
    "UPDATE public.cinema_audience_clock SET last_at=now()-interval '30 seconds' WHERE user_id=$1",
    [viewers[0].id],
  );
  progress = await val(
    "SELECT public.record_cinema_watch_progress($1,$2,$3,$4,$5) AS value",
    [viewers[0].auth, session, randomUUID(), 30, JSON.stringify([[0, 30]])],
  );
  assert.ok(
    progress.seconds >= 1 && progress.seconds <= 2,
    "watch time cannot precede the minted session",
  );
  const second = randomUUID();
  await val("SELECT public.begin_cinema_watch_session($1,$2,$3) AS value", [
    viewers[0].auth,
    other.id,
    second,
  ]);
  assert.equal(
    (
      await val(
        "SELECT public.record_cinema_watch_progress($1,$2,$3,$4,$5) AS value",
        [viewers[0].auth, second, randomUUID(), 30, JSON.stringify([[0, 30]])],
      )
    ).seconds,
    0,
    "parallel tabs share the clock",
  );
  assert.equal(
    (
      await val(
        "SELECT public.record_cinema_watch_progress($1,$2,$3,$4,$5) AS value",
        [viewers[1].auth, session, randomUUID(), 30, JSON.stringify([[0, 30]])],
      )
    ).error,
    "session_not_found",
  );
  const sk = randomUUID();
  assert.equal(
    (
      await val(
        "SELECT public.record_cinema_share_action($1,$2,$3,$4) AS value",
        [viewers[0].auth, film.id, sk, "copy"],
      )
    ).ok,
    true,
  );
  assert.equal(
    (
      await val(
        "SELECT public.record_cinema_share_action($1,$2,$3,$4) AS value",
        [viewers[0].auth, film.id, sk, "share"],
      )
    ).error,
    "idempotency_conflict",
  );
  const comp = randomUUID();
  await q(
    "INSERT INTO public.cinema_competitions(id,name,starts_at,ends_at,target_types,status,created_by) VALUES($1,'Verified weekly model',now()-interval '1 day',now()-interval '1 hour',ARRAY['SHORT'],'closed',$2)",
    [comp, a.id],
  );
  for (const t of [film, other])
    for (const u of viewers.slice(0, 5)) {
      const sid = randomUUID();
      await q(
        "INSERT INTO public.cinema_watch_sessions(id,user_id,content_id,upload_id,stream_uid,duration_seconds,created_at,expires_at) VALUES($1,$2,$3,$4,(SELECT stream_uid FROM public.cinema_uploads WHERE id=$4),90,now()-interval '2 hours',now()-interval '105 minutes')",
        [sid, u.id, t.id, t.upload],
      );
      await q(
        "INSERT INTO public.cinema_watch_events(id,session_id,payload,covered,seconds,created_at) VALUES($1,$2,'{}',int8multirange(int8range(0,$3,'[)')),$4,now()-interval '110 minutes')",
        [randomUUID(), sid, t === film ? 60 : 30, t === film ? 60 : 30],
      );
      if (t === film)
        await q(
          "INSERT INTO public.cinema_watch_events(id,session_id,payload,covered,seconds,created_at) VALUES($1,$2,'{}',int8multirange(int8range(60,90,'[)')),30,now()-interval '109 minutes')",
          [randomUUID(), sid],
        );
      // Deliberate repeated viewing must not inflate unique coverage or audience.
      await q(
        "INSERT INTO public.cinema_watch_events(id,session_id,payload,covered,seconds,created_at) VALUES($1,$2,'{}',int8multirange(int8range(0,30,'[)')),30,now()-interval '109 minutes')",
        [randomUUID(), sid],
      );
    }
  for (const [i, u] of viewers.entries()) {
    await q(
      "INSERT INTO public.cinema_votes(voter_id,content_id,competition_id,idempotency_key,status,created_at) VALUES($1,$2,$3,$4,'qualified',now()-interval '2 hours')",
      [u.id, other.id, comp, randomUUID()],
    );
    if (i < 5) {
      await q(
        "INSERT INTO public.cinema_votes(voter_id,content_id,competition_id,idempotency_key,status,created_at) VALUES($1,$2,$3,$4,'qualified',now()-interval '2 hours')",
        [u.id, film.id, comp, randomUUID()],
      );
      await q(
        "INSERT INTO public.cinema_share_actions(actor_id,idempotency_key,content_id,kind,created_at) VALUES($1,$2,$3,'copy',now()-interval '2 hours')",
        [u.id, randomUUID(), film.id],
      );
      await q(
        "INSERT INTO public.cinema_comments(author_id,content_id,body,status,created_at) VALUES($1,$2,'Thoughtful response','approved',now()-interval '2 hours')",
        [u.id, film.id],
      );
    }
  }
  const scores = await val(
    "SELECT public.calculate_cinema_weekly_scores($1) AS value",
    [comp],
  );
  assert.equal(scores.length, 2);
  assert.equal(
    scores[0].content_id,
    film.id,
    "all signals outrank votes alone",
  );
  const f = scores[0];
  assert.deepEqual(f.signals, {
    votes: 5,
    viewers: 5,
    completions: 5,
    shares: 5,
    engagement: 5,
  });
  assert.ok(Object.values(f.components).every((x) => x > 0));
  assert.equal(scores[1].signals.viewers, 5);
  assert.equal(scores[1].signals.completions, 0);
  assert.ok(
    Math.abs(
      f.score -
        100 *
          (0.4 * f.components.votes +
            0.25 * f.components.completion +
            0.15 * f.components.viewers +
            0.1 * f.components.sharing +
            0.1 * f.components.engagement),
    ) < 0.000001,
  );
  const manage = async (
    admin,
    payload,
    key = randomUUID(),
    at = Math.floor(Date.now() / 1000),
  ) =>
    val("SELECT public.manage_cinema_rankings($1,$2,$3,$4,$5,$6) AS value", [
      admin.auth,
      "aal2",
      at,
      key,
      payload,
      randomUUID(),
    ]);
  const prepare = {
    action: "prepare",
    id: comp,
    reason: "Reviewed eligible audience",
  };
  const pk = randomUUID();
  const snap = await manage(a, prepare, pk);
  assert.equal(snap.status, "provisional");
  assert.equal((await manage(a, prepare, pk)).idempotent, true);
  assert.deepEqual(
    await val("SELECT public.list_cinema_winners() AS value"),
    [],
    "provisional scores are private",
  );
  assert.equal(
    (
      await manage(a, {
        action: "publish",
        id: snap.id,
        reason: "Approve checked scores",
      })
    ).error,
    "self_review_forbidden",
  );
  assert.equal(
    (
      await manage(
        b,
        { action: "publish", id: snap.id, reason: "Approve checked scores" },
        randomUUID(),
        Math.floor(Date.now() / 1000) - 301,
      )
    ).error,
    "not_authorized",
  );
  assert.equal(
    (await manage(a, { ...prepare, reason: "A different reason" }, pk)).error,
    "idempotency_conflict",
  );
  const held = randomUUID();
  await q(
    "INSERT INTO public.cinema_votes(id,voter_id,content_id,competition_id,idempotency_key,status,created_at) VALUES($1,$2,$3,$4,$5,'under_review',now()-interval '2 hours')",
    [held, viewers[6].id, film.id, comp, randomUUID()],
  );
  assert.equal(
    (
      await manage(b, {
        action: "publish",
        id: snap.id,
        reason: "Approve checked scores",
      })
    ).error,
    "votes_need_review",
    "held ballots discovered after preparation still block publication",
  );
  await q("UPDATE public.cinema_votes SET status='rejected' WHERE id=$1", [
    held,
  ]);
  await q(
    "UPDATE public.cinema_comments SET status='rejected' WHERE content_id=$1",
    [film.id],
  );
  assert.equal(
    (
      await manage(b, {
        action: "publish",
        id: snap.id,
        reason: "Approve checked scores",
      })
    ).error,
    "snapshot_stale",
    "changed comment eligibility invalidates frozen scores",
  );
  await q(
    "UPDATE public.cinema_comments SET status='approved' WHERE content_id=$1",
    [film.id],
  );
  const pub = await manage(b, {
    action: "publish",
    id: snap.id,
    reason: "Approve checked scores",
  });
  assert.equal(pub.status, "published");
  const winners = await val("SELECT public.list_cinema_winners() AS value");
  assert.equal(winners.length, 1);
  assert.equal(winners[0].titles[0].id, film.id);
  assert.equal(Object.hasOwn(winners[0].titles[0], "signals"), false);
  await q("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=$1", [
    film.id,
  ]);
  assert.ok(
    !(await val("SELECT public.list_cinema_winners() AS value"))[0].titles.some(
      (t) => t.id === film.id,
    ),
    "hidden titles disappear from historical public snapshots",
  );
  assert.equal(
    await val("SELECT count(*) AS value FROM public.ledger_entries"),
    ledger,
    "ranking never writes credits",
  );
  for (const name of [
    "cinema_watch_sessions",
    "cinema_watch_events",
    "cinema_share_actions",
    "cinema_ranking_snapshots",
    "cinema_ranking_decisions",
  ]) {
    const [r] = await q(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
      [`public.${name}`],
    );
    assert.ok(r.relrowsecurity && r.relforcerowsecurity);
    assert.equal(
      (
        await q(
          "SELECT has_table_privilege('service_role',$1,'SELECT') AS allowed",
          [`public.${name}`],
        )
      )[0].allowed,
      false,
    );
  }
  assert.equal(
    (
      await q(
        "SELECT has_function_privilege('service_role','public.calculate_cinema_weekly_scores(uuid)','EXECUTE') AS allowed",
      )
    )[0].allowed,
    false,
  );
  if (process.env.RETICLE_FIXTURE_SEED === "true") {
    await q(
      "UPDATE public.cinema_content SET visibility='PUBLIC' WHERE id=$1",
      [film.id],
    );
    await q("COMMIT");
  } else await q("ROLLBACK");
  console.log(
    "PASS weighted ranking: all five components, real-time/replay limits, unique coverage, immutable provisional snapshots, independent fresh-MFA publication, live privacy and unchanged ledger",
  );
} finally {
  await c.end();
}
