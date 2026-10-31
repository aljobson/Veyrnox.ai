// Disposable local Postgres only. No production credentials or fixtures.
// Exercises migration 0245 (ADR-0057) as amended by 0415 (ADR-0307, F-15):
// the monthly free ceiling now binds on the FULL authorized lease reserved at
// each play start, not on voluntary heartbeats. A free title's heartbeats are
// analytics and never add to the ceiling; a Cinema Pass holder past the free
// ceiling still plays under the Pass with the Pass caps unchanged. No play
// path touches the ledger. It creates its own users and content.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
// Seconds that count toward the free ceiling: only 'start' leases (0415).
const counted = (actor) => value('SELECT public.cinema_free_month_seconds((SELECT id FROM public.users WHERE auth_id=$1), now()) AS value', [actor]);
const passSeconds = (actor) => value('SELECT COALESCE(sum(p.seconds),0)::int AS value FROM public.cinema_pass_plays p JOIN public.users u ON u.id=p.user_id WHERE u.auth_id=$1', [actor]);
const ledgerRows = () => value("SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason NOT LIKE 'grant:%'");
const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0));
/** Seed `seconds` of counted free viewing as 'start' leases (<=60s rows plus a remainder) at one instant. */
async function fill(actor, content, seconds, at = '$4::timestamptz', stamp = monthStart.toISOString()) {
  const user = await userId(actor), whole = Math.floor(seconds / 60), rest = seconds % 60;
  if (whole) await q(`INSERT INTO public.cinema_free_plays(user_id,content_id,seconds,source,played_at) SELECT $1,$2,60,'start',${at} FROM generate_series(1, $3::int)`, [user, content, whole, stamp]);
  if (rest) await q(`INSERT INTO public.cinema_free_plays(user_id,content_id,seconds,source,played_at) SELECT $1,$2,$3::int,'start',${at}`, [user, content, rest, stamp]);
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
  const CEILING = await value("SELECT value FROM public.cinema_prices WHERE key='free_ceiling_minutes'");
  assert.equal(CEILING, 300, 'the proposed default; the owner confirms it');
  const PASS_CEILING = await value("SELECT value FROM public.cinema_prices WHERE key='pass_ceiling_minutes'");
  for (const sql of ["UPDATE public.cinema_prices SET value=100001 WHERE key='free_ceiling_minutes'", "UPDATE public.cinema_prices SET value=-1 WHERE key='free_ceiling_minutes'",
    "UPDATE public.cinema_prices SET value=51 WHERE key='free_episodes'", "INSERT INTO public.cinema_prices(key,value) VALUES('rent_price',1)"]) await assert.rejects(q(sql), /check/i, sql);

  const creator = await person();
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [creator, randomUUID(), { username: `f_${creator.replaceAll('-', '').slice(0, 20)}`, display_name: 'Creator' }]);
  await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [creator]);
  const series = await save(creator, draft());
  const season = await save(creator, draft({ content_type: 'SEASON', parent_id: series, position: 1 }));
  const episode = (position) => save(creator, draft({ content_type: 'EPISODE', parent_id: season, position }));
  const free = await episode(1), free2 = await episode(2), unready = await episode(3), ep6 = await episode(6), ep8 = await episode(8);
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED', visibility='PUBLIC' WHERE id=ANY($1::uuid[])", [[series, season, free, free2, unready, ep6, ep8]]);
  const uid = {};
  // Explicit runtimes, so each start's lease is a known number. free is 120s, free2 90s.
  for (const [name, content, duration] of [['free', free, 120], ['free2', free2, 90], ['ep6', ep6, 100], ['ep8', ep8, 100]]) {
    uid[name] = randomUUID().replaceAll('-', '');
    await q("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,duration_seconds) VALUES($1,(SELECT id FROM public.users WHERE auth_id=$2),$3,100,$4,'ready',$5,$6)", [content, creator, randomUUID(), 'f'.repeat(64), uid[name], duration]);
  }
  const ledgerBefore = await ledgerRows();

  // A play start reserves the whole runtime up front; the ceiling counts it at once (F-15).
  const viewer = await person();
  assert.deepEqual(await metered(viewer, free), { access: 'free', credits: 0 });
  assert.deepEqual(await start(viewer, free), { access: 'free', stream_uid: uid.free });
  assert.deepEqual(await q('SELECT f.seconds, f.source, f.content_id FROM public.cinema_free_plays f WHERE f.user_id=$1', [await userId(viewer)]), [{ seconds: 120, source: 'start', content_id: free }]);
  assert.equal(await counted(viewer), 120, 'the full 120s runtime is charged at start');
  // A viewer who sends no heartbeat is still charged the runtime, and a heartbeat never moves the ceiling.
  await beat(viewer, free, 60);
  assert.equal(await counted(viewer), 120, 'a heartbeat is analytics only');
  // Each grant counts its own lease.
  assert.deepEqual(await start(viewer, free2), { access: 'free', stream_uid: uid.free2 });
  assert.equal(await counted(viewer), 210, '120 + 90');
  // Nothing is counted when nothing is granted.
  assert.deepEqual(await start(viewer, ep8), { error: 'locked', credits: 6 });
  assert.deepEqual(await start(viewer, unready), { error: 'not_ready' });
  assert.deepEqual(await start(viewer, series), { error: 'content_not_found' });
  assert.deepEqual(await beat(viewer, ep8), { ok: true, recorded: false, access: 'locked', reason: null });
  assert.equal((await beat(viewer, series)).error, 'content_not_found');
  for (const s of [0, 61, -5]) assert.equal((await beat(viewer, free, s)).error, 'invalid_seconds', String(s));
  assert.equal(await counted(viewer), 210, 'refused calls count nothing');
  // No account, no playback and no count. The public catalogue still reads 'free'.
  for (const stranger of ['nope', randomUUID()]) {
    assert.deepEqual(await start(stranger, free), { error: 'not_authenticated' });
    assert.deepEqual(await beat(stranger, free), { error: 'not_authenticated' });
    assert.deepEqual(await metered(stranger, free), { access: 'free', credits: 0 });
  }
  assert.deepEqual(await metered(null, free), { access: 'free', credits: 0 });
  assert.deepEqual(await metered(viewer, ep8), { access: 'locked', credits: 6 }, 'paid titles answer as cinema_entitlement does');

  // Free-title heartbeats are analytics: they never change the counted ceiling.
  const steady = await person();
  const before = await counted(steady);
  await beat(steady, free, 30);
  await beat(steady, free2, 45);
  assert.equal(await counted(steady), before, 'no free heartbeat counts toward the ceiling');

  // The ceiling binds on the up-front leases, and the crossing play is cut to what is left.
  const edge = await person();
  await fill(edge, free, CEILING * 60 - 60);
  assert.deepEqual(await metered(edge, free), { access: 'free', credits: 0 }, '60 seconds left');
  assert.deepEqual(await start(edge, free), { access: 'free', stream_uid: uid.free });
  assert.equal(await counted(edge), CEILING * 60, 'a 120s title is cut to the 60s that remained');
  for (const content of [free, free2]) assert.deepEqual(await metered(edge, content), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual(await start(edge, free), { error: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.equal(await counted(edge), CEILING * 60, 'not one second past the ceiling');
  assert.deepEqual(await metered(edge, ep8), { access: 'locked', credits: 6 }, 'a paid title keeps its price and has no free reason');

  // Concurrent starts cannot pass the ceiling.
  const crowd = await person();
  await fill(crowd, free, CEILING * 60 - 60);
  const starts = await race(Array.from({ length: 4 }, () => (client) => start(crowd, free, client)));
  assert.deepEqual([starts.filter((r) => r.access === 'free').length, starts.filter((r) => r.reason === 'free_ceiling').length], [1, 3]);
  assert.equal(await counted(crowd), CEILING * 60);

  // Rows dated next month do not count against this month.
  const ahead = await person();
  await fill(ahead, free, CEILING * 60, '$4::timestamptz', new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)).toISOString());
  assert.deepEqual(await metered(ahead, free), { access: 'free', credits: 0 });
  // No price row: nothing free plays, and nothing is counted.
  await q('BEGIN');
  await q("DELETE FROM public.cinema_prices WHERE key='free_ceiling_minutes'");
  assert.deepEqual(await start(steady, free), { error: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual(await metered(steady, free), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  await q('ROLLBACK');

  // Calendar month, UTC: last month's leases do not count; the month's first instant does.
  const light = await person(), eve = await person(), first = await person();
  await fill(light, free, CEILING * 60, '$4::timestamptz', new Date(monthStart.getTime() - 86400000).toISOString());
  await fill(eve, free, CEILING * 60, "$4::timestamptz - interval '1 millisecond'");
  await fill(first, free, CEILING * 60, '$4::timestamptz');
  assert.deepEqual(await metered(light, free), { access: 'free', credits: 0 });
  assert.deepEqual(await metered(eve, free), { access: 'free', credits: 0 });
  assert.deepEqual(await metered(first, free), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.equal((await start(light, free)).access, 'free');
  assert.equal(await value('SELECT public.cinema_free_month_seconds($1, now()) AS value', [await userId(light)]), 120);

  // The number comes from cinema_prices and nowhere else.
  const oneMin = await person();
  await fill(oneMin, free, 60);
  await q('BEGIN');
  await q("UPDATE public.cinema_prices SET value=1 WHERE key='free_ceiling_minutes'");
  assert.deepEqual(await metered(oneMin, free), { access: 'locked', credits: 0, reason: 'free_ceiling' }, 'one minute used, a ceiling of one');
  await q("UPDATE public.cinema_prices SET value=0 WHERE key='free_ceiling_minutes'");
  const none = await person();
  assert.deepEqual(await start(none, free), { error: 'locked', credits: 0, reason: 'free_ceiling' }, 'a ceiling of 0 allows no free viewing');
  await q('ROLLBACK');
  assert.deepEqual(await metered(oneMin, free), { access: 'free', credits: 0 });

  // A Cinema Pass holder uses the free minutes first: under the free ceiling the play is a Free Play.
  const holder = await person();
  await activePass(holder);
  assert.deepEqual(await start(holder, free), { access: 'free', stream_uid: uid.free });
  assert.equal(await passSeconds(holder), 0, 'under the free ceiling, a Pass holder watches free first');
  assert.equal(await counted(holder), 120);
  // Past the free ceiling the title plays under the Pass and counts toward the Pass ceiling.
  await fill(holder, free, CEILING * 60);
  assert.deepEqual(await metered(holder, free), { access: 'pass', credits: 0 });
  assert.deepEqual(await start(holder, free), { access: 'pass', stream_uid: uid.free });
  const asPass = await beat(holder, free, 30);
  assert.deepEqual([asPass.recorded, asPass.access, asPass.seconds, asPass.minutes_used, asPass.ceiling_minutes], [true, 'pass', 30, 0, PASS_CEILING]);
  assert.deepEqual(await q('SELECT p.content_id, p.seconds FROM public.cinema_pass_plays p WHERE p.user_id=$1', [await userId(holder)]), [{ content_id: free, seconds: 30 }]);
  // The Pass caps are the same through this function: 60 seconds per minute, on paid titles as well.
  const topUp = await beat(holder, ep8, 45);
  assert.deepEqual([topUp.recorded, topUp.access, topUp.seconds], [true, 'pass', 30]);
  assert.deepEqual([(await beat(holder, free, 10)).reason, (await beat(holder, ep8, 10)).reason], ['too_fast', 'too_fast']);
  assert.equal(await passSeconds(holder), 60);
  // Near the Pass ceiling, a free title's heartbeat is cut to what the Pass has left.
  const nearly = await person();
  const nearlyPass = await activePass(nearly);
  await fill(nearly, free, CEILING * 60);
  await q(`INSERT INTO public.cinema_pass_plays(pass_id,user_id,content_id,seconds,played_at) SELECT $1,$2,$3,60,GREATEST($4::timestamptz, now() - interval '2 minutes') FROM generate_series(1, $5::int)`, [nearlyPass, await userId(nearly), ep8, monthStart.toISOString(), PASS_CEILING - 1]);
  await q(`INSERT INTO public.cinema_pass_plays(pass_id,user_id,content_id,seconds,played_at) VALUES ($1,$2,$3,50,GREATEST($4::timestamptz, now() - interval '2 minutes'))`, [nearlyPass, await userId(nearly), ep8, monthStart.toISOString()]);
  const cut = await beat(nearly, free, 30);
  assert.deepEqual([cut.recorded, cut.access, cut.seconds, cut.minutes_used], [true, 'pass', 10, PASS_CEILING]);
  assert.deepEqual(await metered(nearly, free), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.equal((await beat(nearly, free, 30)).reason, 'free_ceiling', 'the Pass is spent too');
  // A Pass that lapsed or was cancelled does not play free titles past the free ceiling.
  for (const [label, sql] of [['lapsed', "UPDATE public.cinema_passes SET current_period_end = now() - interval '1 hour' WHERE id=$1"], ['ended', "UPDATE public.cinema_passes SET status='ended', ended_at=now(), end_reason='subscription_ended' WHERE id=$1"]]) {
    const former = await person();
    const formerPass = await activePass(former);
    await fill(former, free, CEILING * 60);
    assert.deepEqual(await metered(former, free), { access: 'pass', credits: 0 }, label);
    await q(sql, [formerPass]);
    assert.deepEqual(await metered(former, free), { access: 'locked', credits: 0, reason: 'free_ceiling' }, label);
    assert.deepEqual(await start(former, free), { error: 'locked', credits: 0, reason: 'free_ceiling' }, label);
    assert.deepEqual([(await beat(former, free)).recorded, (await beat(former, free)).reason], [false, 'free_ceiling'], label);
    assert.equal(await passSeconds(former), 0, label);
  }
  // A Pass that lapses between the entitlement read and the heartbeat's lock records nothing.
  const racing = await person();
  const racingPass = await activePass(racing);
  await fill(racing, free, CEILING * 60);
  const held = new pg.Client({ connectionString: url }); await held.connect();
  await held.query('BEGIN'); await held.query('SELECT 1 FROM public.cinema_passes WHERE id=$1 FOR UPDATE', [racingPass]);
  const pending = beat(racing, free, 30);
  await new Promise((r) => setTimeout(r, 300));
  await held.query("UPDATE public.cinema_passes SET current_period_end = now() - interval '1 hour' WHERE id=$1", [racingPass]);
  await held.query('COMMIT'); await held.end();
  assert.deepEqual([(await pending).recorded, (await pending).reason], [false, 'pass_lapsed']);
  assert.equal(await passSeconds(racing), 0);

  // Both ceilings reached: locked, and there is nothing to pay for a free title.
  const spent = await person();
  const spentPass = await activePass(spent);
  await fill(spent, free, CEILING * 60);
  await q(`INSERT INTO public.cinema_pass_plays(pass_id,user_id,content_id,seconds,played_at) SELECT $1,$2,$3,60,GREATEST($4::timestamptz, now() - interval '2 minutes') FROM generate_series(1, $5::int)`, [spentPass, await userId(spent), ep8, monthStart.toISOString(), PASS_CEILING]);
  assert.deepEqual(await metered(spent, free), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual(await start(spent, free), { error: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual([(await beat(spent, free)).recorded, (await beat(spent, free)).reason], [false, 'free_ceiling']);
  assert.deepEqual(await metered(spent, ep8), { access: 'locked', credits: 6, reason: 'pass_ceiling' });
  assert.deepEqual(await start(spent, ep8), { error: 'locked', credits: 6, reason: 'pass_ceiling' });

  // A title unlocked while it was paid still plays once it becomes free and the free minutes are gone.
  const heavy = await person();
  await fill(heavy, free, CEILING * 60);
  assert.equal((await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [heavy, ep6, 'unlock-2026-09-26'])).access, 'unlocked');
  assert.deepEqual(await start(heavy, ep6), { access: 'unlocked', stream_uid: uid.ep6 });
  assert.deepEqual(await beat(heavy, ep6), { ok: true, recorded: false, access: 'unlocked', reason: null });
  await q('BEGIN');
  await q("UPDATE public.cinema_prices SET value=6 WHERE key='free_episodes'");
  assert.deepEqual(await entitlement(heavy, ep6), { access: 'free', credits: 0 });
  assert.deepEqual(await metered(heavy, ep6), { access: 'unlocked', credits: 0 });
  assert.deepEqual(await start(heavy, ep6), { access: 'unlocked', stream_uid: uid.ep6 });
  // Once the Unlock is reversed (takedown), the free ceiling applies again.
  assert.equal((await value("SELECT public.reverse_cinema_unlocks($1,'operator','test takedown') AS value", [ep6])).unlocks_reversed, 1);
  assert.deepEqual(await metered(heavy, ep6), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual(await start(heavy, ep6), { error: 'locked', credits: 0, reason: 'free_ceiling' });
  await q('ROLLBACK');
  assert.equal(await counted(heavy), CEILING * 60);

  // With the ceiling off the Worker calls the older functions, and they answer as before even for an account past it.
  assert.deepEqual(await entitlement(heavy, free), { access: 'free', credits: 0 });
  assert.deepEqual(await playback(heavy, free), { access: 'free', stream_uid: uid.free });
  assert.deepEqual(await passBeat(heavy, free), { ok: true, recorded: false, access: 'free', reason: null });

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
  assert.equal((await start(light, free)).access, 'free');
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
  console.log('Cinema free play checks passed: the full lease is reserved per play start, heartbeats are analytics, the ceiling boundary binds on starts, mixed concurrency, month boundaries, the price row, Pass holder rules (free first, near, lapsed, ended, racing), Unlock precedence and reversal, older functions unchanged, ledger untouched, append-only, RLS and grants.');
} finally { await c.end(); }
