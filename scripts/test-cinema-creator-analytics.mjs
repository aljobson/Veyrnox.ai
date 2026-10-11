import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
const url = process.env.DATABASE_URL;
if (
  !url ||
  !["127.0.0.1", "localhost", "postgres"].includes(new URL(url).hostname)
)
  throw Error("owned local database required");
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (s, a = []) => (await c.query(s, a)).rows;
const value = async (s, a = []) => (await q(s, a))[0]?.value;
async function person(role) {
  const auth = randomUUID();
  await q(
    "INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())",
    [auth, `${auth}@example.invalid`],
  );
  await value("SELECT public.create_cinema_profile($1,$2,$3) AS value", [
    auth,
    randomUUID(),
    {
      username: `s_${auth.replaceAll("-", "").slice(0, 20)}`,
      display_name: role,
    },
  ]);
  const id = await value(
    "SELECT id AS value FROM public.users WHERE auth_id=$1",
    [auth],
  );
  await q("UPDATE public.cinema_memberships SET role=$2 WHERE user_id=$1", [
    id,
    role,
  ]);
  return { auth, id };
}
async function draft(owner, type, title, parent = null, position = null) {
  const r = await value(
    "SELECT public.save_cinema_draft($1,$2,NULL,0,$3) AS value",
    [
      owner.auth,
      randomUUID(),
      {
        content_type: type,
        title,
        synopsis: "Private collection fixture",
        language: "en",
        ai_disclosures: [],
        parent_id: parent,
        position,
        categories: parent ? [] : ["drama"],
      },
    ],
  );
  assert.ok(r.id, JSON.stringify(r));
  if (["SHORT", "EPISODE"].includes(type))
    await q(
      "INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,duration_seconds) VALUES($1,$2,$3,100,$4,'ready',$5,90)",
      [
        r.id,
        owner.id,
        randomUUID(),
        randomUUID().replaceAll("-", "").padEnd(64, "a"),
        randomUUID().replaceAll("-", ""),
      ],
    );
  return r.id;
}

await q(
  await readFile(
    new URL(
      "../packages/db/schema/supabase/0284_cinema_creator_analytics.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await q(
  await readFile(
    new URL(
      "../packages/db/schema/supabase/0284_cinema_creator_analytics.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const analytics = async (actor, id) => {
  const before = await value(
    "SELECT count(*) AS value FROM public.ledger_entries",
  );
  const result = await value(
    "SELECT public.read_cinema_creator_analytics($1,$2) AS value",
    [actor.auth, id],
  );
  assert.equal(
    await value("SELECT count(*) AS value FROM public.ledger_entries"),
    before,
  );
  return result;
};
async function watch(actor, id, seconds = 90, when = "3 days") {
  const upload = (
      await q(
        "SELECT id,stream_uid FROM public.cinema_uploads WHERE content_id=$1",
        [id],
      )
    )[0],
    session = randomUUID();
  await q(
    "INSERT INTO public.cinema_watch_sessions(id,user_id,content_id,upload_id,stream_uid,duration_seconds,created_at,expires_at) VALUES($1,$2,$3,$4,$5,90,now()-$6::interval,now()-$6::interval+interval '15 minutes')",
    [session, actor.id, id, upload.id, upload.stream_uid, when],
  );
  for (let begin = 0; begin < seconds; begin += 60)
    await q(
      "INSERT INTO public.cinema_watch_events(id,session_id,payload,covered,seconds,created_at) VALUES($1,$2,'{}',$3::int8multirange,$4,now()-$5::interval+interval '2 minutes')",
      [
        randomUUID(),
        session,
        `{[${begin},${Math.min(begin + 60, seconds)})}`,
        Math.min(60, seconds - begin),
        when,
      ],
    );
}
try {
  await q("BEGIN");
  const creator = await person("creator"),
    other = await person("creator"),
    viewers = [];
  const title = await draft(creator, "SHORT", "Analytics privacy fixture");
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at=now()-interval '4 days' WHERE id=$1",
    [title],
  );
  for (let i = 0; i < 4; i++) {
    const viewer = await person("viewer");
    viewers.push(viewer);
    await watch(viewer, title);
  }
  let result = await analytics(creator, title);
  assert.equal(result.suppressed, true);
  assert.equal(result.metrics, null);
  const fifth = await person("viewer");
  viewers.push(fifth);
  await watch(fifth, title, 40);
  await watch(viewers[0], title);
  await watch(creator, title);
  const shortViewer = await person("viewer");
  await watch(shortViewer, title, 29);
  const oldViewer = await person("viewer");
  await watch(oldViewer, title, 90, "30 days");
  const todayViewer = await person("viewer");
  await watch(todayViewer, title, 90, "0 minutes");
  const competition = randomUUID();
  await q(
    "INSERT INTO public.cinema_competitions(id,name,starts_at,ends_at,target_types,created_by) VALUES($1,'Analytics competition',now()-interval '4 days',now()-interval '1 day',ARRAY['SHORT'],$2)",
    [competition, creator.id],
  );
  await q(
    "INSERT INTO public.cinema_votes(voter_id,content_id,competition_id,idempotency_key,status,created_at) VALUES($1,$2,$3,$4,'qualified',now()-interval '3 days')",
    [viewers[0].id, title, competition, randomUUID()],
  );
  await q(
    "INSERT INTO public.cinema_share_actions(actor_id,idempotency_key,content_id,kind,created_at) VALUES($1,$2,$3,'copy',now()-interval '3 days'),($1,$4,$3,'share',now()-interval '3 days')",
    [viewers[0].id, randomUUID(), title, randomUUID()],
  );
  const comment = randomUUID();
  await q(
    "INSERT INTO public.cinema_comments(id,author_id,content_id,body,status,created_at) VALUES($1,$2,$3,'Approved fixture','approved',now()-interval '3 days')",
    [comment, viewers[0].id, title],
  );
  await q(
    "INSERT INTO public.cinema_comments(author_id,content_id,body,status,created_at) VALUES($1,$2,'Pending fixture','pending',now()-interval '3 days')",
    [viewers[1].id, title],
  );
  result = await analytics(creator, title);
  assert.equal(result.suppressed, false);
  assert.deepEqual(result.metrics, {
    viewers: 5,
    completions: 4,
    voters: 1,
    sharers: 1,
    commenters: 1,
  });
  assert.equal(
    Date.parse(result.period_end) - Date.parse(result.period_start),
    28 * 86400000,
  );
  assert.equal(new Date(result.period_end).getUTCHours(), 0);
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "content_id",
      "metrics",
      "minimum_viewers",
      "period_end",
      "period_start",
      "suppressed",
    ].sort(),
  );
  await q("SET LOCAL TIME ZONE 'Europe/London'");
  assert.deepEqual((await analytics(creator, title)).metrics, result.metrics);
  await q("SET LOCAL TIME ZONE 'UTC'");
  assert.equal((await analytics(other, title)).error, "content_not_found");
  assert.equal((await analytics(viewers[0], title)).error, "creator_required");
  assert.equal((await analytics(creator, null)).error, "content_not_found");
  await q(
    "INSERT INTO public.cinema_comment_reports(reporter_id,comment_id,category,details) VALUES($1,$2,'spam','Reported fixture')",
    [viewers[1].id, comment],
  );
  assert.equal((await analytics(creator, title)).metrics.commenters, 0);
  await q(
    "UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=$1",
    [fifth.id],
  );
  assert.equal((await analytics(creator, title)).metrics, null);
  await q(
    "UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=$1",
    [fifth.id],
  );
  await q("UPDATE public.users SET frozen_at=now() WHERE id=$1", [creator.id]);
  assert.equal((await analytics(creator, title)).error, "creator_required");
  await q("UPDATE public.users SET frozen_at=NULL WHERE id=$1", [creator.id]);
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='DRAFT',visibility='PRIVATE' WHERE id=$1",
    [title],
  );
  assert.equal((await analytics(creator, title)).error, "content_not_found");
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC' WHERE id=$1",
    [title],
  );
  await q(
    "UPDATE public.cinema_uploads SET stream_uid=$2 WHERE content_id=$1",
    [title, randomUUID().replaceAll("-", "")],
  );
  assert.equal((await analytics(creator, title)).metrics, null);
  const series = await draft(creator, "SERIES", "Analytics series"),
    season = await draft(creator, "SEASON", "One", series, 1),
    episode = await draft(creator, "EPISODE", "First", season, 1);
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at=now()-interval '4 days' WHERE id=ANY($1::uuid[])",
    [[series, season, episode]],
  );
  for (const viewer of viewers) await watch(viewer, episode);
  assert.equal((await analytics(creator, series)).metrics.viewers, 5);
  assert.equal((await analytics(creator, episode)).error, "content_not_found");
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='DRAFT',visibility='PRIVATE' WHERE id=$1",
    [season],
  );
  assert.equal((await analytics(creator, series)).error, "content_not_found");
  for (const role of ["anon", "authenticated"])
    assert.equal(
      await value(
        "SELECT has_function_privilege($1,'public.read_cinema_creator_analytics(text,uuid)','EXECUTE') AS value",
        [role],
      ),
      false,
    );
  assert.equal(
    await value(
      "SELECT has_function_privilege('service_role','public.read_cinema_creator_analytics(text,uuid)','EXECUTE') AS value",
    ),
    true,
  );
  const func = (
    await q(
      "SELECT provolatile,prosecdef,proconfig FROM pg_proc WHERE oid='public.read_cinema_creator_analytics(text,uuid)'::regprocedure",
    )
  )[0];
  assert.equal(func.provolatile, "s");
  assert.equal(func.prosecdef, true);
  assert.ok(func.proconfig.includes('search_path=""'));
  const beforeService = await value(
    "SELECT count(*) AS value FROM public.ledger_entries",
  );
  await q("SET LOCAL ROLE service_role");
  assert.equal(
    (
      await value(
        "SELECT public.read_cinema_creator_analytics($1,$2) AS value",
        [other.auth, title],
      )
    ).error,
    "content_not_found",
  );
  await q("RESET ROLE");
  assert.equal(
    await value("SELECT count(*) AS value FROM public.ledger_entries"),
    beforeService,
  );
  await q("ROLLBACK");
  console.log(
    "Cinema creator analytics: privacy, exact aggregates, deduplication, current eligibility, ownership, UTC window and service ACL passed",
  );
} catch (e) {
  await q("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
