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
const mutate = (actor, kind, id, active, key = randomUUID()) =>
  value("SELECT public.mutate_cinema_retention($1,$2,$3,$4,$5) AS value", [
    actor.auth,
    key,
    kind,
    id,
    active,
  ]);
const list = (actor, kind, before = null, limit = 20) =>
  value("SELECT public.list_cinema_retention($1,$2,$3,$4) AS value", [
    actor.auth,
    kind,
    before,
    limit,
  ]);
try {
  const migration = await readFile(
    new URL(
      "../packages/db/schema/supabase/0283_cinema_saved_titles_and_follows.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await q(migration);
  await q(migration);
  await q("BEGIN");
  const owner = await person("creator"),
    viewer = await person("viewer"),
    other = await person("viewer");
  const film = await draft(owner, "SHORT", "Saved film"),
    series = await draft(owner, "SERIES", "Followed series"),
    season = await draft(owner, "SEASON", "Season", series, 1),
    episode = await draft(owner, "EPISODE", "Episode", season, 1);
  await q(
    "UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at=now() WHERE id=ANY($1::uuid[])",
    [[film, series, season, episode]],
  );
  const ledger = await value(
    "SELECT count(*) AS value FROM public.ledger_entries",
  );
  const key = randomUUID();
  let r = await mutate(viewer, "saved", film, true, key);
  assert.equal(r.active, true);
  assert.equal(
    (await mutate(viewer, "saved", film, true, key)).idempotent,
    true,
  );
  assert.equal(
    (await mutate(viewer, "saved", film, false, key)).error,
    "idempotency_conflict",
  );
  assert.equal((await list(viewer, "saved")).items[0].content_id, film);
  assert.deepEqual((await list(other, "saved")).items, []);
  const status = await value(
    "SELECT public.read_cinema_retention($1,$2) AS value",
    [viewer.auth, film],
  );
  assert.equal(status.saved, true);
  assert.equal(status.creator_id, owner.id);
  await mutate(viewer, "saved", film, false);
  await mutate(viewer, "saved", film, true, key);
  assert.deepEqual(
    (await list(viewer, "saved")).items,
    [],
    "old acknowledgment never recreates an undone save",
  );
  await mutate(viewer, "saved", film, true);
  await mutate(viewer, "saved", series, true);
  const page = await list(viewer, "saved", null, 1);
  assert.equal(page.items.length, 2, "limit+1 establishes a real next page");
  const rest = await list(viewer, "saved", page.items[0].target_id, 1);
  assert.equal(rest.items.length, 1);
  assert.notEqual(rest.items[0].target_id, page.items[0].target_id);
  assert.equal((await list(other, "saved", film)).error, "invalid_cursor");
  assert.equal((await mutate(viewer, "creator", owner.id, true)).active, true);
  assert.equal(
    (await mutate(owner, "creator", owner.id, true)).error,
    "self_follow_forbidden",
  );
  assert.equal((await mutate(viewer, "series", series, true)).active, true);
  assert.equal(
    (await mutate(viewer, "series", film, true)).error,
    "content_not_found",
  );
  assert.equal(
    (await mutate(viewer, "saved", episode, true)).error,
    "content_not_found",
  );
  assert.equal((await list(viewer, "creator")).items[0].target_id, owner.id);
  assert.equal((await list(viewer, "series")).items[0].target_id, series);
  await q(
    "UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=ANY($1::uuid[])",
    [[film, series]],
  );
  for (const kind of ["saved", "creator", "series"])
    assert.deepEqual((await list(viewer, kind)).items, []);
  assert.equal(
    (
      await value("SELECT public.read_cinema_retention($1,$2) AS value", [
        viewer.auth,
        film,
      ])
    ).error,
    "content_not_found",
  );
  assert.equal(
    (await mutate(viewer, "saved", film, true)).error,
    "content_not_found",
  );
  assert.equal(
    (await mutate(viewer, "saved", film, false)).active,
    false,
    "owner can remove a withdrawn reference",
  );
  await q(
    "UPDATE public.cinema_content SET visibility='PUBLIC' WHERE id=ANY($1::uuid[])",
    [[film, series]],
  );
  await q(
    "UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=$1",
    [owner.id],
  );
  assert.deepEqual((await list(viewer, "creator")).items, []);
  await q(
    "UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=$1",
    [owner.id],
  );
  await q("UPDATE public.cinema_content SET visibility='PRIVATE' WHERE id=$1", [
    episode,
  ]);
  assert.deepEqual(
    (await list(viewer, "series")).items,
    [],
    "series must retain a public ready episode",
  );
  await q("UPDATE public.cinema_content SET visibility='PUBLIC' WHERE id=$1", [
    episode,
  ]);
  await q(
    "UPDATE public.cinema_memberships SET account_status='restricted' WHERE user_id=$1",
    [viewer.id],
  );
  assert.equal((await list(viewer, "saved")).error, "profile_required");
  assert.equal(
    (await mutate(viewer, "saved", film, true)).error,
    "profile_required",
  );
  await q(
    "UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=$1",
    [viewer.id],
  );
  await q("SAVEPOINT typed_active");
  await assert.rejects(
    mutate(viewer, "saved", film, "invalid_boolean"),
    /invalid input syntax for type boolean/,
  );
  await q("ROLLBACK TO SAVEPOINT typed_active");
  for (const name of [
    "cinema_saved_titles",
    "cinema_creator_follows",
    "cinema_series_follows",
    "cinema_retention_requests",
  ]) {
    const [acl] = await q(
      "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass",
      [`public.${name}`],
    );
    assert.ok(acl.relrowsecurity && acl.relforcerowsecurity);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [priv] = await q(
        "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",
        [role, `public.${name}`],
      );
      assert.equal(priv.allowed, false);
    }
  }
  for (const sig of [
    "read_cinema_retention(text,uuid)",
    "mutate_cinema_retention(text,uuid,text,uuid,boolean)",
    "list_cinema_retention(text,text,uuid,integer)",
  ]) {
    for (const role of ["anon", "authenticated", "service_role"])
      assert.equal(
        await value("SELECT has_function_privilege($1,$2,'EXECUTE') AS value", [
          role,
          `public.${sig}`,
        ]),
        role === "service_role",
      );
    const [row] = await q(
      "SELECT proconfig FROM pg_proc WHERE oid=$1::regprocedure",
      [`public.${sig}`],
    );
    assert.ok(row.proconfig.includes('search_path=""'));
  }
  await q("SAVEPOINT receipt_limits");
  const original = await value(
    "SELECT count(*) AS value FROM public.cinema_retention_requests WHERE user_id=$1",
    [viewer.id],
  );
  await q(
    "INSERT INTO public.cinema_retention_requests(user_id,request_key,payload,result) SELECT $1,gen_random_uuid(),$2::jsonb,$3::jsonb FROM generate_series(1,30)",
    [
      viewer.id,
      { kind: "saved", target_id: film, active: false },
      { kind: "saved", target_id: film, active: false, idempotent: false },
    ],
  );
  assert.equal(
    (await mutate(viewer, "saved", film, false)).error,
    "rate_limited",
    "30 writes/minute is enforced independently",
  );
  await q("ROLLBACK TO SAVEPOINT receipt_limits");
  await q(
    "INSERT INTO public.cinema_retention_requests(user_id,request_key,payload,result,created_at) SELECT $1,gen_random_uuid(),$2::jsonb,$3::jsonb,now()-interval '2 hours' FROM generate_series(1,500)",
    [
      viewer.id,
      { kind: "saved", target_id: film, active: false },
      { kind: "saved", target_id: film, active: false, idempotent: false },
    ],
  );
  assert.equal(
    (await mutate(viewer, "saved", film, false)).error,
    "rate_limited",
    "500 writes/day is enforced independently",
  );
  await q("ROLLBACK TO SAVEPOINT receipt_limits");
  await q(
    "INSERT INTO public.cinema_retention_requests(user_id,request_key,payload,result,created_at) VALUES($1,$2,$3,$4,now()-interval '8 days')",
    [
      viewer.id,
      randomUUID(),
      { kind: "saved", target_id: film, active: true },
      { kind: "saved", target_id: film, active: true, idempotent: false },
    ],
  );
  await mutate(viewer, "saved", film, false);
  assert.equal(
    await value(
      "SELECT count(*) AS value FROM public.cinema_retention_requests WHERE user_id=$1 AND created_at<now()-interval '7 days'",
      [viewer.id],
    ),
    "0",
  );
  await q("ROLLBACK TO SAVEPOINT receipt_limits");
  assert.equal(
    await value(
      "SELECT count(*) AS value FROM public.cinema_retention_requests WHERE user_id=$1",
      [viewer.id],
    ),
    original,
  );
  await q("SAVEPOINT collection_limit");
  await q(
    "INSERT INTO public.cinema_content(id,creator_id,content_type,title,synopsis,language) SELECT gen_random_uuid(),$1,'SHORT','Hidden cap fixture','','en' FROM generate_series(1,1000)",
    [owner.id],
  );
  await q(
    "INSERT INTO public.cinema_saved_titles(user_id,content_id) SELECT $1,id FROM public.cinema_content WHERE creator_id=$2 AND title='Hidden cap fixture'",
    [other.id, owner.id],
  );
  assert.equal(
    (await mutate(other, "saved", film, true)).error,
    "collection_limit",
    "hidden entries cannot create an unbounded private collection",
  );
  await q("ROLLBACK TO SAVEPOINT collection_limit");
  assert.equal(
    await value("SELECT count(*) AS value FROM public.ledger_entries"),
    ledger,
  );
  await q("COMMIT");
  const concurrentKey = randomUUID();
  const clients = await Promise.all(
    [0, 1].map(async () => {
      const x = new pg.Client({ connectionString: url });
      await x.connect();
      return x;
    }),
  );
  try {
    const results = await Promise.all(
      clients.map((x) =>
        x.query(
          "SELECT public.mutate_cinema_retention($1,$2,$3,$4,$5) AS value",
          [other.auth, concurrentKey, "saved", film, true],
        ),
      ),
    );
    assert.equal(
      results.filter((x) => x.rows[0].value.idempotent === false).length,
      1,
    );
    assert.equal(
      results.filter((x) => x.rows[0].value.idempotent === true).length,
      1,
    );
  } finally {
    await Promise.all(clients.map((x) => x.end()));
  }
  console.log(
    "Cinema collections: replay, isolation, current withdrawal, creators/series, paging, concurrent idempotency, account restrictions, forced RLS/ACL and unchanged credits passed",
  );
} finally {
  await q("ROLLBACK").catch(() => {});
  await c.end();
}
