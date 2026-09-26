// Disposable local Postgres only. No production credentials or fixtures.
// Exercises migration 0142 (ADR-0057 Phase 1): Free Episodes, Episode Unlock,
// takedown reversal, grants and the ledger invariants around all of it.
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
const CONSENT = 'unlock-2026-09-26';
const draft = (patch = {}) => ({ content_type: 'SERIES', parent_id: null, position: null, title: 'Paid story', synopsis: 'Episodes', language: 'en', ai_disclosures: [], ...patch });
const save = (actor, body) => value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [actor, randomUUID(), null, 0, body]).then((r) => { assert.ok(r.id, JSON.stringify(r)); return r.id; });
const entitlement = (actor, content) => value('SELECT public.cinema_entitlement($1,$2) AS value', [actor, content]);
const unlock = (actor, content, consent = CONSENT, client = c) => client.query('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [actor, content, consent]).then((r) => r.rows[0].value);
const playback = (actor, content) => value('SELECT public.read_cinema_playback($1,$2) AS value', [actor, content]);
const userId = (actor) => value('SELECT id AS value FROM public.users WHERE auth_id=$1', [actor]);
const balance = async (actor) => (await q('SELECT b.balance, b.free_balance FROM public.credit_balances b JOIN public.users u ON u.id=b.user_id WHERE u.auth_id=$1', [actor]))[0];
const ledgerRows = (actor, like) => value("SELECT count(*)::int AS value FROM public.ledger_entries l JOIN public.users u ON u.id=l.user_id WHERE u.auth_id=$1 AND l.reason LIKE $2", [actor, like]);
async function race(tasks) { return Promise.all(tasks.map(async (task) => { const peer = new pg.Client({ connectionString: url }); await peer.connect(); try { return await task(peer); } finally { await peer.end(); } })); }
async function person() {
  const actor = randomUUID();
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [actor, `${actor}@example.invalid`]);
  return actor;
}
try {
  const migration = await readFile(new URL('../packages/db/schema/supabase/0142_cinema_unlocks.sql', import.meta.url), 'utf8');
  await c.query(migration); await c.query(migration);
  assert.deepEqual(await q('SELECT key, value FROM public.cinema_prices ORDER BY key'), [{ key: 'episode_unlock', value: 6 }, { key: 'film_unlock', value: 6 }, { key: 'free_episodes', value: 5 }]);

  // A creator with a published series (season 1: 7 episodes, season 2: 22), a film and a short.
  const creator = await person(), alice = await person(), bob = await person(), carol = await person();
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [creator, randomUUID(), { username: `u_${creator.replaceAll('-', '').slice(0, 20)}`, display_name: 'Creator' }]);
  await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [creator]);
  const series = await save(creator, draft());
  const season1 = await save(creator, draft({ content_type: 'SEASON', parent_id: series, position: 1 }));
  const season2 = await save(creator, draft({ content_type: 'SEASON', parent_id: series, position: 2 }));
  const s1 = [], s2 = [];
  for (let i = 1; i <= 7; i++) s1.push(await save(creator, draft({ content_type: 'EPISODE', parent_id: season1, position: i })));
  for (let i = 1; i <= 22; i++) s2.push(await save(creator, draft({ content_type: 'EPISODE', parent_id: season2, position: i })));
  const film = await save(creator, draft({ content_type: 'FILM', title: 'Feature' }));
  const short = await save(creator, draft({ content_type: 'SHORT', title: 'Teaser' }));
  const all = [series, season1, season2, ...s1, ...s2, film, short];

  // Drafts are invisible to viewers and cost nothing.
  assert.equal((await entitlement(alice, s1[5])).error, 'content_not_found');
  assert.equal((await unlock(alice, s1[5])).error, 'content_not_found');
  // No writer publishes yet; the test stands in for the publication slice.
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED', visibility='PUBLIC' WHERE id=ANY($1::uuid[])", [all]);
  assert.equal((await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), series, 1, draft({ title: 'Edit' })])).error, 'draft_locked');

  // Free Episodes: shorts, and season 1 positions 1..5. Everything else is 6 credits.
  for (const id of [...s1.slice(0, 5), short]) assert.deepEqual(await entitlement(alice, id), { access: 'free', credits: 0 });
  for (const id of [s1[5], s1[6], s2[0], film]) assert.deepEqual(await entitlement(alice, id), { access: 'locked', credits: 6 });
  for (const id of [series, season1]) assert.equal((await entitlement(alice, id)).error, 'content_not_found');
  assert.deepEqual(await entitlement(null, s1[5]), { access: 'locked', credits: 6 });
  assert.deepEqual(await entitlement('not-a-uuid', s1[0]), { access: 'free', credits: 0 });
  assert.equal((await unlock(alice, s1[0])).access, 'free');
  assert.equal(await ledgerRows(alice, 'unlock:%'), 0);

  // An Unlock spends Free Credits first, is permanent, and replays without a second row.
  assert.deepEqual(await balance(alice), { balance: 10, free_balance: 10 });
  const first = await unlock(alice, s1[5]);
  assert.deepEqual([first.ok, first.access, first.credits, first.balance_after, first.idempotent], [true, 'unlocked', 6, 4, false]);
  assert.deepEqual(await balance(alice), { balance: 4, free_balance: 4 });
  assert.deepEqual(await q("SELECT delta, free_delta, job_id FROM public.ledger_entries WHERE reason=$1 AND user_id=(SELECT id FROM public.users WHERE auth_id=$2)", [`unlock:cinema:${s1[5]}`, alice]), [{ delta: -6, free_delta: -6, job_id: null }]);
  const again = await unlock(alice, s1[5]);
  assert.deepEqual([again.idempotent, again.unlock_id], [true, first.unlock_id]);
  assert.equal(await ledgerRows(alice, 'unlock:%'), 1);
  assert.deepEqual(await entitlement(alice, s1[5]), { access: 'unlocked', credits: 0 });
  assert.deepEqual(await entitlement(bob, s1[5]), { access: 'locked', credits: 6 });

  // Short of credits: typed, nothing moves. Pack Credits then cover the rest.
  const short6 = await unlock(alice, s1[6]);
  assert.deepEqual([short6.error, short6.credits, short6.balance], ['insufficient_credits', 6, 4]);
  assert.deepEqual(await balance(alice), { balance: 4, free_balance: 4 });
  await q("SELECT public.ledger_grant($1, 100, 'grant:manual test-cinema-unlocks')", [await userId(alice)]);
  const seventh = await unlock(alice, s1[6]);
  assert.equal(seventh.balance_after, 98);
  assert.deepEqual(await balance(alice), { balance: 98, free_balance: 0 });
  assert.equal((await q('SELECT free_delta FROM public.ledger_entries WHERE reason=$1', [`unlock:cinema:${s1[6]}`]))[0].free_delta, -4);

  // Consent, identity and account state gates.
  assert.equal((await unlock(alice, s2[0], null)).error, 'consent_required');
  assert.equal((await unlock(alice, s2[0], 'bad wording!')).error, 'consent_required');
  assert.equal((await unlock('invalid', s2[0])).error, 'not_authenticated');
  assert.equal((await unlock(randomUUID(), s2[0])).error, 'not_authenticated');
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [bob, randomUUID(), { username: `u_${bob.replaceAll('-', '').slice(0, 20)}`, display_name: 'Bob' }]);
  for (const status of ['restricted', 'suspended', 'banned']) {
    await q('UPDATE public.cinema_memberships SET account_status=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)', [bob, status]);
    assert.equal((await unlock(bob, film)).error, 'account_not_active');
  }
  await q("UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [bob]);
  await q("SELECT public.freeze_account($1, 'test freeze', NULL)", [await userId(carol)]);
  assert.equal((await unlock(carol, film)).error, 'account_frozen');
  assert.deepEqual(await balance(carol), { balance: 10, free_balance: 10 });
  const gone = await person();
  await q('DELETE FROM auth.users WHERE id=$1', [gone]);
  assert.equal((await unlock(gone, film)).error, 'not_authenticated');

  // Concurrent unlocks of one title by one viewer debit exactly once.
  const burst = await race(Array.from({ length: 6 }, () => (client) => unlock(bob, film, CONSENT, client)));
  assert.equal(burst.filter((r) => r.ok && r.idempotent === false).length, 1);
  assert.equal(burst.filter((r) => r.ok && r.idempotent === true).length, 5);
  assert.equal(await ledgerRows(bob, 'unlock:%'), 1);
  assert.deepEqual(await balance(bob), { balance: 4, free_balance: 4 });

  // Attempts that reach the ledger are bounded at 20 a minute; replays are not attempts.
  const dave = await person();
  await q("SELECT public.ledger_grant($1, 300, 'grant:manual test-cinema-unlocks')", [await userId(dave)]);
  for (let i = 0; i < 20; i++) assert.equal((await unlock(dave, s2[i])).ok, true, `attempt ${i}`);
  const limited = await unlock(dave, s2[20]);
  assert.equal(limited.error, 'rate_limited');
  assert.ok(limited.retry_after_seconds >= 1 && limited.retry_after_seconds <= 60);
  assert.equal((await unlock(dave, s2[0])).idempotent, true);
  assert.equal(await ledgerRows(dave, 'unlock:%'), 20);
  await q("UPDATE public.cinema_unlock_rate_limits SET window_started_at = now() - interval '61 seconds' WHERE user_id=$1", [await userId(dave)]);
  assert.equal((await unlock(dave, s2[20])).ok, true);

  // Playback: entitled and ready, or a typed refusal. The token is minted elsewhere.
  assert.equal((await playback(alice, s2[1])).error, 'locked');
  assert.equal((await playback(alice, s1[5])).error, 'not_ready');
  assert.equal((await playback(alice, series)).error, 'content_not_found');
  const uid = 'Z'.repeat(32);
  await q("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid) VALUES($1,(SELECT id FROM public.users WHERE auth_id=$2),$3,100,$4,'ready',$5)", [s1[5], creator, randomUUID(), 'f'.repeat(64), uid]);
  assert.deepEqual(await playback(alice, s1[5]), { access: 'unlocked', stream_uid: uid });
  assert.equal((await playback(bob, s1[5])).error, 'locked');
  await q("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid) VALUES($1,(SELECT id FROM public.users WHERE auth_id=$2),$3,100,$4,'ready',$5)", [s1[0], creator, randomUUID(), 'e'.repeat(64), 'Y'.repeat(32)]);
  assert.equal((await playback(bob, s1[0])).access, 'free');

  // Takedown reversal returns credits to the source they came from, once, and is audited.
  const reversed = await value("SELECT public.reverse_cinema_unlocks($1, 'Operator Test', 'takedown: rights claim') AS value", [s1[5]]);
  assert.deepEqual(reversed, { ok: true, unlocks_reversed: 1, credits_returned: 6 });
  assert.deepEqual(await balance(alice), { balance: 104, free_balance: 6 });
  assert.deepEqual(await entitlement(alice, s1[5]), { access: 'locked', credits: 6 });
  assert.deepEqual(await value("SELECT public.reverse_cinema_unlocks($1, 'Operator Test', 'again') AS value", [s1[5]]), { ok: true, unlocks_reversed: 0, credits_returned: 0 });
  assert.equal((await value("SELECT public.reverse_cinema_unlocks($1, '', 'x') AS value", [s1[5]])).code, 'OPERATOR_AND_REASON_REQUIRED');
  assert.equal((await value("SELECT public.reverse_cinema_unlocks($1, 'op', 'x') AS value", [randomUUID()])).code, 'CONTENT_NOT_FOUND');
  const back = await unlock(alice, s1[5]);
  assert.equal(back.idempotent, false);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.cinema_unlocks WHERE content_id=$1', [s1[5]]), 2);
  await assert.rejects(q("UPDATE public.cinema_unlock_reversals SET reason='edited'"), /append-only/);
  await assert.rejects(q('DELETE FROM public.cinema_unlock_reversals'), /append-only/);
  await assert.rejects(q('DELETE FROM public.cinema_content WHERE id=$1', [s1[5]]));

  // After the sign-up grant expires, a reversal returns Pack Credits, never Free ones.
  const erin = await person();
  assert.equal((await unlock(erin, s2[2])).balance_after, 4);
  await q("SELECT public.expire_free_credits(now() + interval '91 days', 1000)");
  assert.deepEqual(await balance(erin), { balance: 0, free_balance: 0 });
  await value("SELECT public.reverse_cinema_unlocks($1, 'Operator Test', 'takedown') AS value", [s2[2]]);
  assert.deepEqual(await balance(erin), { balance: 6, free_balance: 0 });

  // Invariants and grants.
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_balances()'), 0);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_free_credits()'), 0);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.credit_balances WHERE free_balance < 0 OR free_balance > balance'), 0);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of ['cinema_prices', 'cinema_unlocks', 'cinema_unlock_rate_limits', 'cinema_unlock_reversals']) {
      assert.equal(await value(`SELECT has_table_privilege($1, 'public.${table}', 'SELECT') AS value`, [role]), false, `${role} ${table}`);
    }
    for (const fn of ['public.ledger_unlock(uuid,uuid,integer,text)', 'public.cinema_unlock_price(uuid)']) {
      assert.equal(await value("SELECT has_function_privilege($1, $2, 'EXECUTE') AS value", [role, fn]), false, `${role} ${fn}`);
    }
    const allowed = role === 'service_role';
    for (const fn of ['public.unlock_cinema_content(text,uuid,text)', 'public.cinema_entitlement(text,uuid)', 'public.read_cinema_playback(text,uuid)', 'public.reverse_cinema_unlocks(uuid,text,text)']) {
      assert.equal(await value("SELECT has_function_privilege($1, $2, 'EXECUTE') AS value", [role, fn]), allowed, `${role} ${fn}`);
    }
  }
  await q('BEGIN'); await q('SET LOCAL ROLE service_role');
  assert.equal((await unlock(alice, s2[3])).ok, true);
  await q('ROLLBACK');
  console.log('Cinema unlock checks passed: free episodes, unlock money path, replay, concurrency, gates, rate limit, playback, reversal, expiry, invariants and grants.');
} finally { await c.end(); }
