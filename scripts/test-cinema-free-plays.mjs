// Disposable local Postgres only. No production credentials or fixtures.
// Exercises migration 0245 (ADR-0057): Free Plays, the monthly free ceiling
// in entitlement, playback and the heartbeat, what a Cinema Pass holder gets
// past it, and that no play path touches the ledger. It creates its own
// users and content; the functions today's Worker calls must answer as before.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const draft = (patch = {}) => ({ content_type: 'SERIES', parent_id: null, position: null, title: 'Free story', synopsis: 'Episodes', language: 'en', ai_disclosures: [], ...patch });
const save = (actor, body) => value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [actor, randomUUID(), null, 0, body]).then((r) => { assert.ok(r.id, JSON.stringify(r)); return r.id; });
const call = (sql, args, client = c) => client.query(`SELECT ${sql} AS value`, args).then((r) => r.rows[0].value);
// What the Worker calls with the free ceiling on.
const metered = (actor, content) => call('public.cinema_metered_entitlement($1,$2)', [actor, content]);
const start = (actor, content, client) => call('public.start_cinema_playback($1,$2)', [actor, content], client);
const beat = (actor, content, seconds = 30, client) => call('public.record_cinema_play($1,$2,$3)', [actor, content, seconds], client);
// What it calls with the ceiling off: these must not change.
const entitlement = (actor, content) => call('public.cinema_entitlement($1,$2)', [actor, content]);
const playback = (actor, content) => call('public.read_cinema_playback($1,$2)', [actor, content]);
const passBeat = (actor, content, seconds = 30) => call('public.record_cinema_pass_play($1,$2,$3)', [actor, content, seconds]);
const userId = (actor) => value('SELECT id AS value FROM public.users WHERE auth_id=$1', [actor]);
const freeSeconds = (actor) => value('SELECT COALESCE(sum(f.seconds),0)::int AS value FROM public.cinema_free_plays f JOIN public.users u ON u.id=f.user_id WHERE u.auth_id=$1', [actor]);
const passSeconds = (actor) => value('SELECT COALESCE(sum(p.seconds),0)::int AS value FROM public.cinema_pass_plays p JOIN public.users u ON u.id=p.user_id WHERE u.auth_id=$1', [actor]);
const ledgerRows = () => value("SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason NOT LIKE 'grant:%'");
const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0));
// A past instant inside this month, outside the 60-second window the caps read.
const AGED = "GREATEST($4::timestamptz, now() - interval '2 minutes')";
/** Seed `seconds` of Free Plays for an account, as 60-second rows plus a remainder, at one instant. */
async function fill(actor, content, seconds, at = AGED, stamp = monthStart.toISOString()) {
  const user = await userId(actor), whole = Math.floor(seconds / 60), rest = seconds % 60;
  if (whole) await q(`INSERT INTO public.cinema_free_plays(user_id,content_id,seconds,source,played_at) SELECT $1,$2,60,'heartbeat',${at} FROM generate_series(1, $3::int)`, [user, content, whole, stamp]);
  if (rest) await q(`INSERT INTO public.cinema_free_plays(user_id,content_id,seconds,source,played_at) SELECT $1,$2,$3::int,'heartbeat',${at}`, [user, content, rest, stamp]);
}
async function race(tasks) { return Promise.all(tasks.map(async (task) => { const peer = new pg.Client({ connectionString: url }); await peer.connect(); try { return await task(peer); } finally { await peer.end(); } })); }
async function person() {
  const actor = randomUUID();
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [actor, `${actor}@example.invalid`]);
  return actor;
}
async function activePass(actor) {
  const s = await value('SELECT public.start_cinema_pass($1,$2,$3,$4,5,600) AS value', [actor, 'pass-monthly', randomUUID(), 'cinema-pass-2026-09-26']);
  const a = await value('SELECT public.apply_cinema_pass_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value', [`evt_${randomUUID().replaceAll('-', '')}`, 'customer.subscription.created', s.pass_id, `sub_${randomUUID().replaceAll('-', '')}`, 'cus_1', 'active', new Date(Date.now() + 20 * 86400000).toISOString(), false, new Date().toISOString()]);
  assert.equal(a.status, 'active');
  return s.pass_id;
}
const NEW_FUNCTIONS = ['public.cinema_free_plays_append_only()', 'public.cinema_free_month_seconds(uuid,timestamptz)', 'public.cinema_past_free_ceiling(uuid,uuid)',
  'public.cinema_metered_entitlement(text,uuid)', 'public.cinema_record_pass_seconds(uuid,uuid,integer)', 'public.start_cinema_playback(text,uuid)', 'public.record_cinema_play(text,uuid,integer)'];
const SERVICE_ROLE_FUNCTIONS = ['public.cinema_metered_entitlement(text,uuid)', 'public.start_cinema_playback(text,uuid)', 'public.record_cinema_play(text,uuid,integer)'];
try {
  const migration = await readFile(new URL('../packages/db/schema/supabase/0245_cinema_free_plays.sql', import.meta.url), 'utf8');
  // Idempotency proof inside a rolled-back transaction, so the re-apply cannot
  // reinstate this file's function bodies over later migrations for the rest of the run.
  await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK');
  const CEILING = await value("SELECT value FROM public.cinema_prices WHERE key='free_ceiling_minutes'");
  assert.equal(CEILING, 300, 'the proposed default; the owner confirms it');
  // Read, never assumed: a later migration may move the Pass ceiling.
  const PASS_CEILING = await value("SELECT value FROM public.cinema_prices WHERE key='pass_ceiling_minutes'");
  for (const sql of ["UPDATE public.cinema_prices SET value=100001 WHERE key='free_ceiling_minutes'", "UPDATE public.cinema_prices SET value=-1 WHERE key='free_ceiling_minutes'",
    "UPDATE public.cinema_prices SET value=51 WHERE key='free_episodes'", "INSERT INTO public.cinema_prices(key,value) VALUES('rent_price',1)"]) await assert.rejects(q(sql), /check/i, sql);

  const creator = await person();
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [creator, randomUUID(), { username: `f_${creator.replaceAll('-', '').slice(0, 20)}`, display_name: 'Creator' }]);
  await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [creator]);
  const series = await save(creator, draft());
  const season = await save(creator, draft({ content_type: 'SEASON', parent_id: series, position: 1 }));
  const episode = (position) => save(creator, draft({ content_type: 'EPISODE', parent_id: season, position }));
  // Positions 1 to 5 of season 1 are Free Episodes; 6 and 8 are paid. Episode 3 has no video yet.
  const free = await episode(1), free2 = await episode(2), unready = await episode(3), ep6 = await episode(6), ep8 = await episode(8);
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED', visibility='PUBLIC' WHERE id=ANY($1::uuid[])", [[series, season, free, free2, unready, ep6, ep8]]);
  const uid = {};
  for (const [name, content] of [['free', free], ['free2', free2], ['ep6', ep6], ['ep8', ep8]]) {
    uid[name] = randomUUID().replaceAll('-', '');
    await q("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid) VALUES($1,(SELECT id FROM public.users WHERE auth_id=$2),$3,100,$4,'ready',$5)", [content, creator, randomUUID(), 'f'.repeat(64), uid[name]]);
  }
  const ledgerBefore = await ledgerRows();

  // Granting playback of a free title counts one minute, whatever the player reports afterwards.
  const viewer = await person();
  assert.deepEqual(await metered(viewer, free), { access: 'free', credits: 0 });
  assert.deepEqual(await start(viewer, free), { access: 'free', stream_uid: uid.free });
  assert.deepEqual(await q('SELECT f.seconds, f.source, f.content_id FROM public.cinema_free_plays f WHERE f.user_id=$1', [await userId(viewer)]), [{ seconds: 60, source: 'start', content_id: free }]);
  // That minute is inside the wall-clock cap: a heartbeat in the same minute adds nothing.
  const early = await beat(viewer, free, 30);
  assert.deepEqual([early.recorded, early.access, early.reason, early.minutes_used, early.ceiling_minutes], [false, 'free', 'too_fast', 1, CEILING]);
  // Each grant counts: starts are bounded by the ceiling, not by the clock.
  assert.deepEqual(await start(viewer, free2), { access: 'free', stream_uid: uid.free2 });
  assert.equal(await freeSeconds(viewer), 120);
  // Nothing is counted when nothing is granted.
  assert.deepEqual(await start(viewer, ep8), { error: 'locked', credits: 6 });
  assert.deepEqual(await start(viewer, unready), { error: 'not_ready' });
  assert.deepEqual(await start(viewer, series), { error: 'content_not_found' });
  assert.deepEqual(await beat(viewer, ep8), { ok: true, recorded: false, access: 'locked', reason: null });
  assert.equal((await beat(viewer, series)).error, 'content_not_found');
  for (const s of [0, 61, -5]) assert.equal((await beat(viewer, free, s)).error, 'invalid_seconds', String(s));
  assert.equal(await freeSeconds(viewer), 120);
  // No account, no playback and no count. The public catalogue still reads 'free'.
  for (const stranger of ['nope', randomUUID()]) {
    assert.deepEqual(await start(stranger, free), { error: 'not_authenticated' });
    assert.deepEqual(await beat(stranger, free), { error: 'not_authenticated' });
    assert.deepEqual(await metered(stranger, free), { access: 'free', credits: 0 });
  }
  assert.deepEqual(await metered(null, free), { access: 'free', credits: 0 });
  assert.deepEqual(await metered(viewer, ep8), { access: 'locked', credits: 6 }, 'paid titles answer as cinema_entitlement does');

  // Heartbeats: at most 60 seconds per 60 seconds per account, so a replayed heartbeat adds nothing.
  const steady = await person();
  const one = await beat(steady, free, 30);
  assert.deepEqual([one.recorded, one.access, one.seconds, one.minutes_used, one.ceiling_minutes], [true, 'free', 30, 0, CEILING]);
  const two = await beat(steady, free2, 45);
  assert.deepEqual([two.recorded, two.seconds, two.minutes_used], [true, 30, 1], 'topped up to the 60-second minute, across titles');
  const replay = await beat(steady, free, 10);
  assert.deepEqual([replay.recorded, replay.reason], [false, 'too_fast']);
  assert.deepEqual(await q("SELECT source, sum(seconds)::int AS seconds FROM public.cinema_free_plays WHERE user_id=$1 GROUP BY source", [await userId(steady)]), [{ source: 'heartbeat', seconds: 60 }]);
  const racer = await person();
  const burst = await race(Array.from({ length: 6 }, () => (client) => beat(racer, free, 20, client)));
  assert.equal(burst.filter((r) => r.recorded).reduce((n, r) => n + r.seconds, 0), 60, 'six concurrent 20-second heartbeats record exactly one minute');
  assert.equal(await freeSeconds(racer), 60);

  // The ceiling: the last heartbeat is cut to what is left, then every free title is locked for the account.
  const heavy = await person();
  await fill(heavy, free, CEILING * 60 - 30);
  assert.deepEqual(await metered(heavy, free), { access: 'free', credits: 0 }, '30 seconds left');
  const last = await beat(heavy, free, 60);
  assert.deepEqual([last.recorded, last.seconds, last.minutes_used, last.ceiling_minutes], [true, 30, CEILING, CEILING]);
  for (const content of [free, free2]) assert.deepEqual(await metered(heavy, content), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual(await beat(heavy, free, 30), { ok: true, recorded: false, access: 'locked', reason: 'free_ceiling', minutes_used: CEILING, ceiling_minutes: CEILING });
  assert.deepEqual(await start(heavy, free), { error: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.equal(await freeSeconds(heavy), CEILING * 60, 'not one second past the ceiling');
  assert.deepEqual(await metered(heavy, ep8), { access: 'locked', credits: 6 }, 'a paid title keeps its price and has no free reason');
  // A play start is cut to what is left too, and concurrent starts cannot pass the ceiling.
  const edge = await person();
  await fill(edge, free, CEILING * 60 - 30);
  assert.equal((await start(edge, free)).access, 'free');
  assert.deepEqual(await start(edge, free), { error: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.equal(await freeSeconds(edge), CEILING * 60);
  const crowd = await person();
  await fill(crowd, free, (CEILING - 1) * 60);
  const starts = await race(Array.from({ length: 4 }, () => (client) => start(crowd, free, client)));
  assert.deepEqual([starts.filter((r) => r.access === 'free').length, starts.filter((r) => r.reason === 'free_ceiling').length], [1, 3]);
  assert.equal(await freeSeconds(crowd), CEILING * 60);

  // Calendar month, UTC: last month's plays do not count; the month's first instant does.
  const light = await person(), eve = await person(), first = await person();
  await fill(light, free, CEILING * 60, '$4::timestamptz', new Date(monthStart.getTime() - 86400000).toISOString());
  await fill(eve, free, CEILING * 60, "$4::timestamptz - interval '1 millisecond'");
  await fill(first, free, CEILING * 60, '$4::timestamptz');
  assert.deepEqual(await metered(light, free), { access: 'free', credits: 0 });
  assert.deepEqual(await metered(eve, free), { access: 'free', credits: 0 });
  assert.deepEqual(await metered(first, free), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.equal((await start(light, free)).access, 'free');
  assert.equal(await value('SELECT public.cinema_free_month_seconds($1, now()) AS value', [await userId(light)]), 60);

  // The number comes from cinema_prices and nowhere else.
  await q('BEGIN');
  await q("UPDATE public.cinema_prices SET value=1 WHERE key='free_ceiling_minutes'");
  assert.deepEqual(await metered(steady, free), { access: 'locked', credits: 0, reason: 'free_ceiling' }, 'steady has used exactly one minute');
  await q("UPDATE public.cinema_prices SET value=0 WHERE key='free_ceiling_minutes'");
  const none = await person();
  assert.deepEqual(await start(none, free), { error: 'locked', credits: 0, reason: 'free_ceiling' }, 'a ceiling of 0 allows no free viewing');
  await q('ROLLBACK');
  assert.deepEqual(await metered(steady, free), { access: 'free', credits: 0 });

  // A Cinema Pass holder uses the free minutes first: under the free ceiling the play is a Free Play.
  const holder = await person();
  await activePass(holder);
  const asFree = await beat(holder, free, 30);
  assert.deepEqual([asFree.recorded, asFree.access, asFree.seconds], [true, 'free', 30]);
  assert.equal(await passSeconds(holder), 0);
  // Past it the title plays under the Pass and counts toward the Pass ceiling.
  await fill(holder, free, CEILING * 60 - 30);
  assert.deepEqual(await metered(holder, free), { access: 'pass', credits: 0 });
  assert.deepEqual(await start(holder, free), { access: 'pass', stream_uid: uid.free });
  const asPass = await beat(holder, free, 30);
  assert.deepEqual([asPass.recorded, asPass.access, asPass.seconds, asPass.minutes_used, asPass.ceiling_minutes], [true, 'pass', 30, 0, PASS_CEILING]);
  assert.deepEqual(await q('SELECT p.content_id, p.seconds FROM public.cinema_pass_plays p WHERE p.user_id=$1', [await userId(holder)]), [{ content_id: free, seconds: 30 }]);
  assert.equal(await freeSeconds(holder), CEILING * 60, 'Pass viewing adds no Free Play');
  // The Pass caps are the same through this function: 60 seconds per minute, on paid titles as well.
  const topUp = await beat(holder, ep8, 45);
  assert.deepEqual([topUp.recorded, topUp.access, topUp.seconds], [true, 'pass', 30]);
  assert.deepEqual([(await beat(holder, free, 10)).reason, (await beat(holder, ep8, 10)).reason], ['too_fast', 'too_fast']);
  assert.equal(await passSeconds(holder), 60);
  // Both ceilings reached: locked, and there is nothing to pay for a free title.
  const spent = await person();
  const spentPass = await activePass(spent);
  await fill(spent, free, CEILING * 60);
  await q(`INSERT INTO public.cinema_pass_plays(pass_id,user_id,content_id,seconds,played_at) SELECT $1,$2,$3,60,${AGED} FROM generate_series(1, $5::int)`, [spentPass, await userId(spent), ep8, monthStart.toISOString(), PASS_CEILING]);
  assert.deepEqual(await metered(spent, free), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual(await start(spent, free), { error: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual([(await beat(spent, free)).recorded, (await beat(spent, free)).reason], [false, 'free_ceiling']);
  assert.deepEqual(await metered(spent, ep8), { access: 'locked', credits: 6, reason: 'pass_ceiling' });
  assert.deepEqual(await start(spent, ep8), { error: 'locked', credits: 6, reason: 'pass_ceiling' });

  // A title unlocked while it was paid still plays once it becomes free and the free minutes are gone.
  assert.equal((await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [heavy, ep6, 'unlock-2026-09-26'])).access, 'unlocked');
  assert.deepEqual(await start(heavy, ep6), { access: 'unlocked', stream_uid: uid.ep6 });
  assert.deepEqual(await beat(heavy, ep6), { ok: true, recorded: false, access: 'unlocked', reason: null });
  await q('BEGIN');
  await q("UPDATE public.cinema_prices SET value=6 WHERE key='free_episodes'");
  assert.deepEqual(await entitlement(heavy, ep6), { access: 'free', credits: 0 });
  assert.deepEqual(await metered(heavy, ep6), { access: 'unlocked', credits: 0 });
  assert.deepEqual(await start(heavy, ep6), { access: 'unlocked', stream_uid: uid.ep6 });
  assert.deepEqual(await beat(heavy, ep6), { ok: true, recorded: false, access: 'unlocked', reason: null, minutes_used: CEILING, ceiling_minutes: CEILING });
  await q('ROLLBACK');
  assert.equal(await freeSeconds(heavy), CEILING * 60);

  // With the ceiling off the Worker calls the older functions, and they answer as before even for an account past it.
  assert.deepEqual(await entitlement(heavy, free), { access: 'free', credits: 0 });
  assert.deepEqual(await playback(heavy, free), { access: 'free', stream_uid: uid.free });
  assert.deepEqual(await passBeat(heavy, free), { ok: true, recorded: false, access: 'free', reason: null });
  assert.equal(await freeSeconds(heavy), CEILING * 60);

  // Money: no play path wrote a ledger row or moved a balance.
  assert.equal(await ledgerRows(), ledgerBefore + 1, 'exactly the one Unlock');
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_balances()'), 0);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_free_credits()'), 0);

  // Append-only, forced RLS, no browser or service-role table access, functions closed by default.
  await assert.rejects(q('DELETE FROM public.cinema_free_plays'), /append-only/);
  await assert.rejects(q('UPDATE public.cinema_free_plays SET seconds=1'), /append-only/);
  await assert.rejects(q('TRUNCATE public.cinema_free_plays'), /append-only \(attempted TRUNCATE\)/);
  assert.deepEqual(await q("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='public.cinema_free_plays'::regclass"), [{ relrowsecurity: true, relforcerowsecurity: true }]);
  assert.equal(await value("SELECT count(*)::int AS value FROM pg_policies WHERE schemaname='public' AND tablename='cinema_free_plays'"), 0);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal(await value("SELECT has_table_privilege($1, 'public.cinema_free_plays', $2) AS value", [role, privilege]), false, `${role} ${privilege}`);
  }
  for (const fn of NEW_FUNCTIONS) {
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      assert.equal(await value("SELECT has_function_privilege($1, $2, 'EXECUTE') AS value", [role, fn]), role === 'service_role' && SERVICE_ROLE_FUNCTIONS.includes(fn), `${role} ${fn}`);
    }
    const [config] = await q('SELECT proconfig, prosecdef FROM pg_proc WHERE oid=$1::regprocedure', [fn]);
    assert.ok(config.proconfig.includes('search_path=""'), `${fn} pins an empty search_path`);
    assert.equal(config.prosecdef, fn !== 'public.cinema_free_plays_append_only()', `${fn} security definer`);
  }
  await q('BEGIN'); await q('SET LOCAL ROLE service_role');
  assert.equal((await beat(light, free, 5)).ok, true);
  assert.equal((await metered(light, free)).access, 'free');
  await q('ROLLBACK');
  await q('BEGIN'); await q('SET LOCAL ROLE service_role');
  await assert.rejects(q('SELECT 1 FROM public.cinema_free_plays LIMIT 1'), /permission denied/);
  await q('ROLLBACK');
  for (const role of ['anon', 'authenticated']) {
    await q('BEGIN'); await q(`SET LOCAL ROLE ${role}`);
    await assert.rejects(start(viewer, free), /permission denied/, role);
    await q('ROLLBACK');
  }
  console.log('Cinema free play checks passed: a minute per play start, heartbeat caps and replay, the ceiling boundary, concurrency, month boundaries, the price row, Pass holder rules, Unlock precedence, older functions unchanged, ledger untouched, append-only, RLS and grants.');
} finally { await c.end(); }
