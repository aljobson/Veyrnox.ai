// Disposable local Postgres only. No production credentials or fixtures.
// Exercises migration 0144 (ADR-0057 Phase 3): Pass Plays, the two caps, the
// monthly ceiling in entitlement, the Operator earnings read, and that no
// play path touches the ledger. Depends on 0142/0143 state from the earlier
// scripts only through the migrations; it creates its own users and content.
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
const draft = (patch = {}) => ({ content_type: 'SERIES', parent_id: null, position: null, title: 'Play story', synopsis: 'Episodes', language: 'en', ai_disclosures: [], ...patch });
const save = (actor, body) => value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [actor, randomUUID(), null, 0, body]).then((r) => { assert.ok(r.id, JSON.stringify(r)); return r.id; });
const entitlement = (actor, content) => value('SELECT public.cinema_entitlement($1,$2) AS value', [actor, content]);
const play = (actor, content, seconds = 30, client = c) => client.query('SELECT public.record_cinema_pass_play($1,$2,$3) AS value', [actor, content, seconds]).then((r) => r.rows[0].value);
const earnings = (actor, month) => value('SELECT public.operator_cinema_earnings($1,$2) AS value', [actor, month]);
const ledgerRows = () => value("SELECT count(*)::int AS value FROM public.ledger_entries WHERE reason NOT LIKE 'grant:%'");
async function race(tasks) { return Promise.all(tasks.map(async (task) => { const peer = new pg.Client({ connectionString: url }); await peer.connect(); try { return await task(peer); } finally { await peer.end(); } })); }
async function person() {
  const actor = randomUUID();
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [actor, `${actor}@example.invalid`]);
  return actor;
}
async function activePass(actor, plan = 'pass-monthly') {
  const s = await value('SELECT public.start_cinema_pass($1,$2,$3,$4,5,600) AS value', [actor, plan, randomUUID(), 'cinema-pass-2026-09-26']);
  const sub = `sub_${randomUUID().replaceAll('-', '')}`;
  const a = await value('SELECT public.apply_cinema_pass_event($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value', [`evt_${randomUUID().replaceAll('-', '')}`, 'customer.subscription.created', s.pass_id, sub, 'cus_1', 'active', new Date(Date.now() + 20 * 86400000).toISOString(), false, new Date().toISOString()]);
  assert.equal(a.status, 'active');
  return s.pass_id;
}
try {
  const migration = await readFile(new URL('../packages/db/schema/supabase/0144_cinema_pass_plays.sql', import.meta.url), 'utf8');
  await c.query(migration); await c.query(migration);
  assert.equal(await value("SELECT value FROM public.cinema_prices WHERE key='pass_ceiling_minutes'"), 3000);
  await assert.rejects(q("UPDATE public.cinema_prices SET value=51 WHERE key='episode_unlock'"), /check/i);
  await assert.rejects(q("INSERT INTO public.cinema_prices(key,value) VALUES('rent_price',1)"), /check/i);

  const creator = await person();
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [creator, randomUUID(), { username: `q_${creator.replaceAll('-', '').slice(0, 20)}`, display_name: 'Creator' }]);
  await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [creator]);
  const series = await save(creator, draft());
  const season = await save(creator, draft({ content_type: 'SEASON', parent_id: series, position: 1 }));
  const free = await save(creator, draft({ content_type: 'EPISODE', parent_id: season, position: 1 }));
  const ep8 = await save(creator, draft({ content_type: 'EPISODE', parent_id: season, position: 8 }));
  const ep9 = await save(creator, draft({ content_type: 'EPISODE', parent_id: season, position: 9 }));
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED', visibility='PUBLIC' WHERE id=ANY($1::uuid[])", [[series, season, free, ep8, ep9]]);
  const ledgerBefore = await ledgerRows();

  // Only a Pass holder with 'pass' access records anything.
  const viewer = await person(), holder = await person();
  assert.deepEqual(await play(viewer, ep8), { ok: true, recorded: false, access: 'locked', reason: null });
  assert.deepEqual(await play(viewer, free), { ok: true, recorded: false, access: 'free', reason: null });
  assert.equal((await play(viewer, series)).error, 'content_not_found');
  assert.equal((await play('nope', ep8)).error, 'not_authenticated');
  assert.equal((await play(randomUUID(), ep8)).error, 'not_authenticated');
  const passId = await activePass(holder);
  for (const s of [0, 61, -5]) assert.equal((await play(holder, ep8, s)).error, 'invalid_seconds', String(s));
  const first = await play(holder, ep8, 30);
  assert.deepEqual([first.recorded, first.access, first.seconds, first.minutes_used, first.ceiling_minutes], [true, 'pass', 30, 0, 3000]);
  assert.equal((await q('SELECT pass_id, content_id, seconds FROM public.cinema_pass_plays'))[0].pass_id, passId);
  // Unlocked content on a Pass account records nothing: the credits already paid for it.
  assert.equal((await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [holder, ep9, 'unlock-2026-09-26'])).access, 'unlocked');
  assert.deepEqual(await play(holder, ep9), { ok: true, recorded: false, access: 'unlocked', reason: null });

  // Wall-clock cap: at most 60 seconds per 60 seconds per Pass, including under concurrency.
  const second = await play(holder, ep8, 45);
  assert.deepEqual([second.recorded, second.seconds], [true, 30], 'topped up to the 60-second minute');
  const third = await play(holder, ep8, 10);
  assert.deepEqual([third.recorded, third.reason], [false, 'too_fast']);
  await q("UPDATE public.cinema_pass_plays SET played_at = played_at - interval '2 minutes'").catch(() => {});
  // Append-only: the UPDATE above must have been refused, so age the rows through a fresh Pass instead.
  assert.equal(await value('SELECT sum(seconds)::int AS value FROM public.cinema_pass_plays WHERE pass_id=$1', [passId]), 60);
  const racer = await person();
  await activePass(racer);
  const burst = await race(Array.from({ length: 6 }, () => (client) => play(racer, ep8, 20, client)));
  assert.equal(burst.filter((r) => r.recorded).reduce((n, r) => n + r.seconds, 0), 60, 'six concurrent 20-second heartbeats record exactly one minute');

  // The ceiling: a Pass at 3,000 minutes this month is locked with a reason, may still unlock, and records nothing more.
  const heavy = await person();
  const heavyPass = await activePass(heavy);
  const heavyUser = await value('SELECT id AS value FROM public.users WHERE auth_id=$1', [heavy]);
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0)).toISOString();
  await q('INSERT INTO public.cinema_pass_plays(pass_id,user_id,content_id,seconds,played_at) SELECT $1,$2,$3,60,$4::timestamptz + (g * interval \'1 minute\') FROM generate_series(0, 2998) g', [heavyPass, heavyUser, ep8, monthStart]);
  assert.deepEqual(await entitlement(heavy, ep8), { access: 'pass', credits: 0 });
  const last = await play(heavy, ep8, 60);
  assert.deepEqual([last.recorded, last.seconds, last.minutes_used], [true, 60, 3000]);
  assert.deepEqual(await entitlement(heavy, ep8), { access: 'locked', credits: 6, reason: 'pass_ceiling' });
  assert.deepEqual((await play(heavy, ep8, 30)), { ok: true, recorded: false, access: 'locked', reason: 'pass_ceiling' });
  assert.equal((await value('SELECT public.read_cinema_playback($1,$2) AS value', [heavy, ep8])).error, 'locked');
  assert.equal((await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [heavy, ep8, 'unlock-2026-09-26'])).access, 'unlocked');
  assert.deepEqual(await entitlement(heavy, ep8), { access: 'unlocked', credits: 0 });
  // Last month's plays do not count against this month.
  const lastMonth = new Date(Date.parse(monthStart) - 86400000).toISOString();
  const light = await person();
  const lightPass = await activePass(light);
  await q('INSERT INTO public.cinema_pass_plays(pass_id,user_id,content_id,seconds,played_at) SELECT $1,(SELECT id FROM public.users WHERE auth_id=$2),$3,60,$4::timestamptz - (g * interval \'1 minute\') FROM generate_series(0, 2999) g', [lightPass, light, ep8, lastMonth]);
  assert.deepEqual(await entitlement(light, ep8), { access: 'pass', credits: 0 });

  // Operator earnings: admin only, month aligned, unlock credits and pass seconds per title.
  assert.equal((await value("SELECT public.start_cinema_pass($1,'pass-weekly',$2,$3,5,600) AS value", [viewer, randomUUID(), 'cinema-pass-2026-09-26'])).ok, true);
  await assert.rejects(earnings(viewer, `${monthStart.slice(0, 7)}-01`), (e) => e.code === '42501');
  const operator = await person();
  await q('UPDATE public.users SET is_admin=true WHERE auth_id=$1', [operator]);
  assert.equal((await earnings(operator, `${monthStart.slice(0, 7)}-15`)).code, 'INVALID_MONTH');
  const report = await earnings(operator, `${monthStart.slice(0, 7)}-01`);
  assert.equal(report.ok, true);
  const row8 = report.content.find((r) => r.content_id === ep8), row9 = report.content.find((r) => r.content_id === ep9);
  assert.deepEqual([row8.unlocks, row8.unlock_credits], [1, 6], 'heavy unlocked ep8 after the ceiling');
  assert.equal(row8.pass_seconds, 30 + 30 + 60 + 2999 * 60 + 60, 'holder, racer and heavy this month; light was last month');
  assert.deepEqual([row9.unlocks, row9.unlock_credits, row9.pass_seconds], [1, 6, 0]);
  assert.equal(report.content.some((r) => r.content_id === free), false, 'no activity, no row');
  // Other scripts share this database and month, so totals are checked as a sum over the rows, not a fixed number.
  assert.equal(report.totals.unlock_credits, report.content.reduce((n, r) => n + r.unlock_credits, 0));
  assert.equal(report.totals.pass_seconds, report.content.reduce((n, r) => n + r.pass_seconds, 0));
  assert.ok(report.totals.unlock_credits >= 12);
  assert.equal(row8.creator_id, await value('SELECT id AS value FROM public.users WHERE auth_id=$1', [creator]));
  assert.equal(row8.title, 'Play story');

  // Money and grants: play paths wrote no ledger rows; tables closed; helpers internal.
  assert.equal(await ledgerRows(), ledgerBefore + 2, 'exactly the two Unlocks');
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_balances()'), 0);
  await assert.rejects(q('DELETE FROM public.cinema_pass_plays'), /append-only/);
  await assert.rejects(q('UPDATE public.cinema_pass_plays SET seconds=1'), /append-only/);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(await value("SELECT has_table_privilege($1, 'public.cinema_pass_plays', 'SELECT') AS value", [role]), false, role);
    assert.equal(await value("SELECT has_function_privilege($1, 'public.cinema_pass_month_seconds(uuid,timestamptz)', 'EXECUTE') AS value", [role]), false, role);
    const allowed = role === 'service_role';
    for (const fn of ['public.record_cinema_pass_play(text,uuid,integer)', 'public.operator_cinema_earnings(text,date)', 'public.cinema_entitlement(text,uuid)']) {
      assert.equal(await value("SELECT has_function_privilege($1, $2, 'EXECUTE') AS value", [role, fn]), allowed, `${role} ${fn}`);
    }
  }
  await q('BEGIN'); await q('SET LOCAL ROLE service_role');
  assert.equal((await play(holder, ep8, 5)).ok, true);
  await q('ROLLBACK');
  console.log('Cinema pass play checks passed: who records, the 60-second and monthly caps, ceiling in entitlement and playback, month boundaries, Operator earnings, ledger untouched and grants.');
} finally { await c.end(); }
