// Disposable local Postgres only. No production credentials or fixtures.
// Exercises migration 0147 (ADR-0059): submission readiness, the review
// queue and decisions, publication cascading to seasons and episodes, public
// reads with per-viewer access, withdrawal and suspension reversing Unlocks,
// idempotency, self-review, grants and append-only audits.
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
const RIGHTS = 'rights-2026-09-26';
const now = () => Math.floor(Date.now() / 1000);
const draft = (patch = {}) => ({ content_type: 'SERIES', parent_id: null, position: null, title: 'Published story', synopsis: 'Public', language: 'en', ai_disclosures: ['generated_script'], ...patch });
const save = (actor, body) => value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [actor, randomUUID(), null, 0, body]).then((r) => { assert.ok(r.id, JSON.stringify(r)); return r.id; });
const upload = (creator, content, ready = true) => q("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,duration_seconds) VALUES($1,(SELECT id FROM public.users WHERE auth_id=$2),$3,100,$4,$5,$6,90)", [content, creator, randomUUID(), randomUUID().replaceAll('-', '').padEnd(64, 'a'), ready ? 'ready' : 'processing', randomUUID().replaceAll('-', '')]);
const submit = (actor, content, key = randomUUID(), rights = RIGHTS) => value('SELECT public.submit_cinema_title($1,$2,$3,$4) AS value', [actor, key, content, rights]);
const withdraw = (actor, content, key = randomUUID(), reason = 'Changed my mind') => value('SELECT public.withdraw_cinema_title($1,$2,$3,$4) AS value', [actor, key, content, reason]);
const queue = (actor, mfa = now()) => value('SELECT public.list_cinema_submissions($1,$2,$3) AS value', [actor, 'aal2', mfa]);
const review = (actor, sub, decision, key = randomUUID(), note = null, mfa = now()) => value('SELECT public.review_cinema_submission($1,$2,$3,$4,$5,$6,$7,$8,$9) AS value', [actor, 'aal2', mfa, key, sub, decision, 'Reviewed', note, randomUUID()]);
const suspend = (actor, content, key = randomUUID()) => value('SELECT public.suspend_cinema_title($1,$2,$3,$4,$5,$6,$7) AS value', [actor, 'aal2', now(), key, content, 'Rights complaint upheld', randomUUID()]);
const status = (content) => value('SELECT lifecycle_status || \'/\' || visibility AS value FROM public.cinema_content WHERE id=$1', [content]);
const catalogue = (limit = 24, before = null, category = null) => value('SELECT public.list_public_cinema_titles($1,$2,$3) AS value', [limit, before, category]);
const readTitle = (actor, content) => value('SELECT public.read_public_cinema_title($1,$2) AS value', [actor, content]);
const own = (actor, parent = null) => value('SELECT public.list_own_cinema_content($1,$2) AS value', [actor, parent]);
async function person(role = null) {
  const actor = randomUUID();
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [actor, `${actor}@example.invalid`]);
  if (role) {
    await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [actor, randomUUID(), { username: `p_${actor.replaceAll('-', '').slice(0, 20)}`, display_name: role }]);
    await q('UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)', [actor, role]);
  }
  return actor;
}
try {
  const migration = await readFile(new URL('../packages/db/schema/supabase/0147_cinema_publication.sql', import.meta.url), 'utf8');
  // Idempotency proof inside a rolled-back transaction, so the re-apply cannot
  // reinstate this file's function bodies over later migrations for the rest of the run.
  await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK');

  const creator = await person('creator'), admin = await person('administrator'), viewer = await person(), stranger = await person('creator');
  const series = await save(creator, draft());
  const season = await save(creator, draft({ content_type: 'SEASON', parent_id: series, position: 1 }));
  const eps = [];
  for (let i = 1; i <= 7; i++) eps.push(await save(creator, draft({ content_type: 'EPISODE', parent_id: season, position: i })));
  const film = await save(creator, draft({ content_type: 'FILM', title: 'Feature', categories: ['action', 'sci-fi'] }));
  // Categories (0148): bounded, known, root-only, and required before review.
  assert.equal((await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), null, 0, draft({ categories: ['romance', 'nope'] })])).error, 'invalid_category');
  assert.equal((await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), null, 0, draft({ categories: ['romance', 'drama', 'comedy'] })])).error, 'invalid_draft');
  assert.equal((await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), null, 0, draft({ content_type: 'EPISODE', parent_id: season, position: 99, categories: ['romance'] })])).error, 'invalid_draft');
  assert.deepEqual(await value('SELECT public.list_cinema_categories() AS value').then((r) => r.slice(0, 2).map((c) => c.slug)), ['romance', 'drama']);

  // A title needs a category before review; then readiness: every episode needs a finished upload.
  assert.equal((await submit(creator, series)).error, 'category_required');
  assert.equal((await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), series, 1, draft({ categories: ['thriller', 'drama'] })])).revision, 2);
  assert.equal((await submit(creator, series)).error, 'video_not_ready');
  const empty = await save(creator, draft({ title: 'Empty', categories: ['comedy'] }));
  assert.equal((await submit(creator, empty)).error, 'no_episodes');
  for (const e of eps.slice(0, 6)) await upload(creator, e);
  await upload(creator, eps[6], false);
  assert.deepEqual(await submit(creator, series), { error: 'video_not_ready', missing: 1 });
  await q("UPDATE public.cinema_uploads SET state='ready' WHERE content_id=$1", [eps[6]]);
  assert.equal((await submit(creator, season)).error, 'content_not_found', 'only roots are submitted');
  assert.equal((await submit(stranger, series)).error, 'content_not_found');
  assert.equal((await submit(viewer, series)).error, 'creator_required');
  assert.equal((await submit(creator, series, randomUUID(), 'bad wording!')).error, 'invalid_submission');

  // Submit: cascades to UNDER_REVIEW, records rights, idempotent on the key, locks edits.
  const key = randomUUID();
  const sub = await submit(creator, series, key);
  assert.deepEqual([sub.status, sub.idempotent, sub.content_id], ['pending', false, series]);
  assert.equal((await submit(creator, series, key)).idempotent, true);
  assert.equal((await submit(creator, film, key)).error, 'idempotency_conflict');
  assert.equal((await submit(creator, series)).error, 'already_submitted');
  for (const id of [series, season, eps[0]]) assert.equal(await status(id), 'UNDER_REVIEW/PRIVATE');
  assert.equal(await value('SELECT rights_version AS value FROM public.cinema_content WHERE id=$1', [eps[3]]), RIGHTS);
  assert.equal((await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), series, 1, draft({ title: 'Edit' })])).error, 'draft_locked');
  assert.equal((await readTitle(viewer, series)).error, 'title_not_found', 'not public while under review');
  assert.equal((await catalogue(50)).some((t) => t.id === series), false);

  // Queue: administrators only, fresh MFA, with counts; self-review refused.
  assert.equal((await queue(creator)).error, 'not_authorized');
  assert.equal((await queue(admin, now() - 600)).error, 'not_authorized');
  const pending = (await queue(admin)).submissions;
  const row = pending.find((s) => s.id === sub.id);
  assert.deepEqual([row.content_type, row.episode_count, row.duration_seconds, row.rights_version, row.prior_actions], ['SERIES', 7, 630, RIGHTS, 0]);
  const adminCreator = await person('creator');
  const ownTitle = await save(adminCreator, draft({ content_type: 'SHORT', title: 'Mine', categories: ['comedy'] }));
  await upload(adminCreator, ownTitle);
  const ownSub = await submit(adminCreator, ownTitle);
  await q("UPDATE public.cinema_memberships SET role='administrator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [adminCreator]);
  assert.equal((await review(adminCreator, ownSub.id, 'approved')).error, 'self_review_forbidden');
  assert.equal((await review(creator, sub.id, 'approved')).error, 'not_authorized');
  assert.equal((await review(admin, randomUUID(), 'approved')).error, 'submission_not_found');

  // Reject returns the whole title to DRAFT with a creator-visible note; resubmission works.
  const rkey = randomUUID();
  const rejected = await review(admin, sub.id, 'rejected', rkey, ' Add subtitles to episode 2. ');
  assert.deepEqual([rejected.status, rejected.idempotent], ['rejected', false]);
  assert.deepEqual(await review(admin, sub.id, 'rejected', rkey, 'Add subtitles to episode 2.'), { id: sub.id, status: 'rejected', idempotent: true });
  assert.equal((await review(admin, sub.id, 'approved', rkey)).error, 'idempotency_conflict');
  assert.equal((await review(admin, sub.id, 'approved')).error, 'already_reviewed');
  assert.equal(await status(eps[2]), 'DRAFT/PRIVATE');
  const mine = (await own(creator)).content.find((x) => x.id === series);
  assert.deepEqual([mine.lifecycle_status, mine.review_note, mine.video_ready], ['DRAFT', 'Add subtitles to episode 2.', false]);
  assert.equal((await own(creator, season)).content.every((x) => x.video_ready), true);
  const sub2 = await submit(creator, series);
  assert.equal(sub2.status, 'pending');
  assert.equal(await value('SELECT review_note AS value FROM public.cinema_content WHERE id=$1', [series]), null, 'a new submission clears the note');

  // Approve publishes everything under the title; the public reads see it, with per-viewer access.
  const approved = await review(admin, sub2.id, 'approved');
  assert.equal(approved.status, 'approved');
  for (const id of [series, season, ...eps]) assert.equal(await status(id), 'PUBLISHED/PUBLIC');
  const list = await catalogue();
  const entry = list.find((t) => t.id === series);
  assert.deepEqual([entry.title, entry.episode_count, entry.username.startsWith('p_'), entry.duration_seconds], ['Published story', 7, true, null]);
  assert.equal(list.some((t) => t.id === film), false, 'the film is still a draft');
  assert.deepEqual(entry.categories, ['drama', 'thriller']);
  assert.equal((await catalogue(50, null, 'thriller')).some((t) => t.id === series), true);
  assert.equal((await catalogue(50, null, 'comedy')).some((t) => t.id === series), false);
  assert.deepEqual((await readTitle(null, series)).categories, ['drama', 'thriller']);
  const anon = await readTitle(null, series);
  assert.equal(anon.seasons[0].episodes.length, 7);
  assert.deepEqual([anon.seasons[0].episodes[0].access, anon.seasons[0].episodes[5].access, anon.seasons[0].episodes[5].credits, anon.seasons[0].episodes[0].duration_seconds], ['free', 'locked', 6, 90]);
  assert.equal(Object.hasOwn(anon, 'creator_id'), false);
  assert.equal((await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [viewer, eps[5], 'unlock-2026-09-26'])).access, 'unlocked');
  const seen = await readTitle(viewer, series);
  assert.equal(seen.seasons[0].episodes[5].access, 'unlocked');
  assert.equal((await submit(creator, series)).error, 'already_published');
  assert.ok(['draft_locked', 'invalid_parent'].includes((await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), eps[0], 1, draft({ content_type: 'EPISODE', parent_id: season, position: 1, title: 'Edit' })])).error), 'a published episode cannot be edited');

  // Pagination: newest first, cursor by published_at.
  await upload(creator, film);
  const filmSub = await submit(creator, film);
  await review(admin, filmSub.id, 'approved');
  const page = await catalogue(1);
  assert.equal(page[0].id, film);
  assert.equal((await catalogue(1, page[0].published_at))[0].id, series);
  assert.equal((await readTitle(null, film)).access, 'locked');
  assert.equal((await readTitle(null, film)).duration_seconds, 90);

  // Withdrawal of a published title returns it to draft and reverses the viewer's Unlock.
  const before = await value('SELECT balance AS value FROM public.credit_balances WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)', [viewer]);
  assert.equal((await withdraw(stranger, series)).error, 'content_not_found');
  assert.equal((await withdraw(creator, series, randomUUID(), 'no')).error, 'invalid_withdrawal');
  const wkey = randomUUID();
  const w = await withdraw(creator, series, wkey);
  assert.deepEqual([w.status, w.unlocks_reversed, w.credits_returned, w.idempotent], ['DRAFT', 1, 6, false]);
  assert.equal((await withdraw(creator, series, wkey)).idempotent, true);
  assert.equal((await withdraw(creator, series)).error, 'not_withdrawable');
  assert.equal(await status(eps[5]), 'DRAFT/PRIVATE');
  assert.equal(await value('SELECT balance AS value FROM public.credit_balances WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)', [viewer]), before + 6);
  assert.equal((await readTitle(viewer, series)).error, 'title_not_found');
  assert.equal((await value("SELECT count(*)::int AS value FROM public.cinema_moderation_actions WHERE content_id=$1 AND action='withdraw' AND was_published", [series])), 1);
  // Withdrawing a title under review just cancels the submission.
  const sub3 = await submit(creator, series);
  assert.equal((await withdraw(creator, series)).unlocks_reversed, 0);
  assert.equal(await value('SELECT status AS value FROM public.cinema_submissions WHERE id=$1', [sub3.id]), 'withdrawn');
  assert.equal(await status(series), 'DRAFT/PRIVATE');

  // Suspension: administrator takedown, terminal for the creator, reverses Unlocks.
  const sub4 = await submit(creator, series);
  await review(admin, sub4.id, 'approved');
  assert.equal((await value('SELECT public.unlock_cinema_content($1,$2,$3) AS value', [viewer, eps[6], 'unlock-2026-09-26'])).access, 'unlocked');
  assert.equal((await suspend(creator, series)).error, 'not_authorized');
  const skey = randomUUID();
  const s = await suspend(admin, series, skey);
  assert.deepEqual([s.status, s.unlocks_reversed, s.credits_returned], ['SUSPENDED', 1, 6]);
  assert.equal((await suspend(admin, series, skey)).idempotent, true);
  assert.equal((await suspend(admin, series)).error, 'already_suspended');
  for (const id of [series, season, eps[6]]) assert.equal(await status(id), 'SUSPENDED/PRIVATE');
  assert.equal((await submit(creator, series)).error, 'suspended');
  assert.equal((await withdraw(creator, series)).error, 'not_withdrawable');
  assert.equal((await value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [creator, randomUUID(), series, 1, draft({ title: 'Edit' })])).error, 'draft_locked');
  assert.equal((await readTitle(null, series)).error, 'title_not_found');
  assert.equal((await catalogue()).some((t) => t.id === series), false);

  // Invariants, append-only audits, grants.
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_balances()'), 0);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.reconcile_free_credits()'), 0);
  await assert.rejects(q("UPDATE public.cinema_submission_reviews SET reason='x'"), /append-only/);
  await assert.rejects(q('DELETE FROM public.cinema_moderation_actions'), /append-only/);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of ['cinema_submissions', 'cinema_submission_reviews', 'cinema_moderation_actions']) {
      assert.equal(await value(`SELECT has_table_privilege($1, 'public.${table}', 'SELECT') AS value`, [role]), false, `${role} ${table}`);
    }
    for (const fn of ['public.cinema_title_rows(uuid)', 'public.cinema_close_title(uuid,text,text,text,boolean)']) {
      assert.equal(await value("SELECT has_function_privilege($1, $2, 'EXECUTE') AS value", [role, fn]), false, `${role} ${fn}`);
    }
    const allowed = role === 'service_role';
    for (const fn of ['public.submit_cinema_title(text,uuid,uuid,text)', 'public.withdraw_cinema_title(text,uuid,uuid,text)', 'public.list_cinema_submissions(text,text,bigint)',
      'public.review_cinema_submission(text,text,bigint,uuid,uuid,text,text,text,uuid)', 'public.suspend_cinema_title(text,text,bigint,uuid,uuid,text,uuid)',
      'public.list_public_cinema_titles(integer,timestamptz,text)', 'public.read_public_cinema_title(text,uuid)']) {
      assert.equal(await value("SELECT has_function_privilege($1, $2, 'EXECUTE') AS value", [role, fn]), allowed, `${role} ${fn}`);
    }
  }
  await q('BEGIN'); await q('SET LOCAL ROLE service_role');
  assert.equal(Array.isArray(await catalogue()), true);
  await q('ROLLBACK');
  console.log('Cinema publication checks passed: readiness, submission, queue, self-review, reject/resubmit, approve cascade, public reads and access, pagination, withdrawal and suspension reversing Unlocks, invariants and grants.');
} finally { await c.end(); }
