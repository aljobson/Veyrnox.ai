// Acceptance for 0355: private resume positions. Run against a rebuilt database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
const url = process.env.DATABASE_URL;
if (!url || !["127.0.0.1", "localhost", "postgres"].includes(new URL(url).hostname))
  throw Error("owned local database required");
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (s, a = []) => (await c.query(s, a)).rows;
const value = async (s, a = []) => (await q(s, a))[0]?.value;
async function person(role) {
  const auth = randomUUID();
  await q("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())", [auth, `${auth}@example.invalid`]);
  await value("SELECT public.create_cinema_profile($1,$2,$3) AS value", [
    auth, randomUUID(), { username: `s_${auth.replaceAll("-", "").slice(0, 20)}`, display_name: role },
  ]);
  const id = await value("SELECT id AS value FROM public.users WHERE auth_id=$1", [auth]);
  await q("UPDATE public.cinema_memberships SET role=$2 WHERE user_id=$1", [id, role]);
  return { auth, id };
}
async function short(owner, title, seconds = 90) {
  const r = await value("SELECT public.save_cinema_draft($1,$2,NULL,0,$3) AS value", [
    owner.auth, randomUUID(),
    { content_type: "SHORT", title, synopsis: "Resume fixture", language: "en", ai_disclosures: [], parent_id: null, position: null, categories: ["drama"] },
  ]);
  assert.ok(r.id, JSON.stringify(r));
  await q(
    "INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,duration_seconds) VALUES($1,$2,$3,100,$4,'ready',$5,$6)",
    [r.id, owner.id, randomUUID(), randomUUID().replaceAll("-", "").padEnd(64, "a"), randomUUID().replaceAll("-", ""), seconds],
  );
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED',visibility='PUBLIC',published_at=now() WHERE id=$1", [r.id]);
  return r.id;
}
const save = (a, id, pos) => value("SELECT public.save_cinema_watch_resume($1,$2,$3) AS value", [a.auth, id, pos]);
const list = (a, before = null, limit = 20) => value("SELECT public.list_cinema_watch_resume($1,$2,$3) AS value", [a.auth, before, limit]);
const drop = (a, id) => value("SELECT public.remove_cinema_watch_resume($1,$2) AS value", [a.auth, id]);
const age = (user, content) =>
  q("UPDATE public.cinema_watch_resume SET updated_at=updated_at-interval '1 minute' WHERE user_id=$1 AND content_id=$2", [user, content]);
try {
  const migration = await readFile(new URL("../packages/db/schema/supabase/0355_cinema_watch_progress.sql", import.meta.url), "utf8");
  await q(migration);
  await q(migration);
  await q("BEGIN");
  const owner = await person("creator"), viewer = await person("viewer"), other = await person("viewer");
  const film = await short(owner, "Resume film"), film2 = await short(owner, "Second film");
  const ledger = await value("SELECT count(*) AS value FROM public.ledger_entries");
  const balances = await value("SELECT coalesce(sum(balance),0) AS value FROM public.credit_balances");

  // A free title: access is free, so a viewer can save a position; one write per title per 10 s.
  let r = await save(viewer, film, 40);
  assert.equal(r.recorded, true, JSON.stringify(r));
  assert.deepEqual([r.position_seconds, r.duration_seconds, r.completed], [40, 90, false]);
  r = await save(viewer, film, 50);
  assert.equal(r.recorded, false, "second write inside 10 s is a quiet no-op");
  assert.equal(r.position_seconds, 40);
  await age(viewer.id, film);
  r = await save(viewer, film, 5);
  assert.equal(r.position_seconds, 5, "the person may seek back");

  // Own rows only: another account sees nothing, and cannot remove the row.
  assert.deepEqual((await list(other)).items, []);
  await drop(other, film);
  const mine = await list(viewer);
  assert.equal(mine.items.length, 1);
  assert.equal(mine.items[0].content_id, film);
  assert.equal(mine.items[0].position_seconds, 5);
  assert.ok(!JSON.stringify(mine).includes(viewer.id));

  // Validation and clamping.
  assert.equal((await save(viewer, film2, -1)).error, "invalid_position");
  assert.equal((await save(viewer, film2, 601)).error, "invalid_position");
  assert.equal((await save(viewer, randomUUID(), 3)).error, "content_not_found");
  assert.equal((await save({ auth: randomUUID() }, film, 3)).error, "profile_required");
  r = await save(viewer, film2, 600);
  assert.equal(r.position_seconds, 90, "position clamps to the real duration");
  assert.equal(r.completed, true);
  assert.equal((await list(viewer)).items.length, 1, "completed titles are not offered to resume");

  // Pagination: limit+1 and a stable cursor on content id.
  await age(viewer.id, film2);
  const third = await short(owner, "Third film");
  await save(viewer, third, 10);
  await q("UPDATE public.cinema_watch_resume SET completed=false WHERE user_id=$1", [viewer.id]);
  const page = await list(viewer, null, 1);
  assert.equal(page.items.length, 2);
  const next = await list(viewer, page.items[0].content_id, 1);
  assert.equal(next.items.length, 2);
  assert.notEqual(next.items[0].content_id, page.items[0].content_id);
  assert.equal((await list(viewer, randomUUID(), 1)).error, "invalid_cursor");
  assert.equal((await list(viewer, null, 41)).error, "invalid_query");

  // Withdrawal removes the row from the projection at once.
  await q("UPDATE public.cinema_content SET lifecycle_status='DRAFT' WHERE id=$1", [third]);
  assert.ok(!(await list(viewer)).items.some((i) => i.content_id === third));

  // Dismiss.
  assert.equal((await drop(viewer, film)).removed, true);
  assert.equal((await drop(viewer, film)).removed, true);
  assert.ok(!(await list(viewer)).items.some((i) => i.content_id === film));

  // Never a money write.
  assert.equal(await value("SELECT count(*) AS value FROM public.ledger_entries"), ledger);
  assert.equal(await value("SELECT coalesce(sum(balance),0) AS value FROM public.credit_balances"), balances);

  // No browser or service role reaches the table directly.
  for (const role of ["anon", "authenticated", "service_role"]) {
    await q("SAVEPOINT s");
    await q(`SET LOCAL ROLE ${role}`);
    await assert.rejects(() => q("SELECT * FROM public.cinema_watch_resume"), /permission denied/);
    await q("ROLLBACK TO SAVEPOINT s");
  }
  for (const role of ["anon", "authenticated"]) {
    await q("SAVEPOINT s");
    await q(`SET LOCAL ROLE ${role}`);
    await assert.rejects(() => q("SELECT public.list_cinema_watch_resume($1,NULL,5)", [viewer.auth]), /permission denied/);
    await q("ROLLBACK TO SAVEPOINT s");
  }

  // Account deletion tombstone drops the rows.
  await save(viewer, film, 12);
  assert.equal(await value("SELECT count(*)::int AS value FROM public.cinema_watch_resume WHERE user_id=$1", [viewer.id]), 3);
  await q("UPDATE public.users SET deleted_at=now() WHERE id=$1", [viewer.id]);
  assert.equal(await value("SELECT count(*)::int AS value FROM public.cinema_watch_resume WHERE user_id=$1", [viewer.id]), 0);
  console.log("cinema watch resume: ok");
} finally {
  await q("ROLLBACK").catch(() => {});
  await c.end();
}
