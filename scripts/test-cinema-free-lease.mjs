#!/usr/bin/env node
// Cinema free-viewing ceiling reserves the FULL authorized lease up front
// (assessment F-15, ADR-0307). A viewer who sends no heartbeats is still
// charged the title's whole runtime, so the monthly ceiling binds on the
// up-front reservation, not on voluntary client accounting. Heartbeats are
// analytics and never add to the ceiling. Full replayed chain; throwaway
// LOCAL database only, everything rolls back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const call = (sql, args) => c.query(`SELECT ${sql} AS value`, args).then((r) => r.rows[0].value);
const draft = (patch = {}) => ({ content_type: 'SERIES', parent_id: null, position: null, title: 'Lease story', synopsis: 'Episodes', language: 'en', ai_disclosures: [], ...patch });
const save = (actor, body) => value('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value', [actor, randomUUID(), null, 0, body]).then((r) => { assert.ok(r.id, JSON.stringify(r)); return r.id; });
const start = (actor, content) => call('public.start_cinema_playback($1,$2)', [actor, content]);
const beat = (actor, content, seconds = 30) => call('public.record_cinema_play($1,$2,$3)', [actor, content, seconds]);
const metered = (actor, content) => call('public.cinema_metered_entitlement($1,$2)', [actor, content]);
const userId = (actor) => value('SELECT id AS value FROM public.users WHERE auth_id=$1', [actor]);
const counted = (actor) => value('SELECT public.cinema_free_month_seconds((SELECT id FROM public.users WHERE auth_id=$1), now()) AS value', [actor]);
const startRows = (actor) => value("SELECT COALESCE(sum(f.seconds),0)::int AS value FROM public.cinema_free_plays f JOIN public.users u ON u.id=f.user_id WHERE u.auth_id=$1 AND f.source='start'", [actor]);
async function person() {
  const actor = randomUUID();
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [actor, `${actor}@example.invalid`]);
  return actor;
}

try {
  const CEILING = await value("SELECT value FROM public.cinema_prices WHERE key='free_ceiling_minutes'");
  const creator = await person();
  await value('SELECT public.create_cinema_profile($1,$2,$3) AS value', [creator, randomUUID(), { username: `l_${creator.replaceAll('-', '').slice(0, 20)}`, display_name: 'Creator' }]);
  await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)", [creator]);
  const series = await save(creator, draft());
  const season = await save(creator, draft({ content_type: 'SEASON', parent_id: series, position: 1 }));
  const free = await save(creator, draft({ content_type: 'EPISODE', parent_id: season, position: 1 }));
  const free2 = await save(creator, draft({ content_type: 'EPISODE', parent_id: season, position: 2 }));
  await q("UPDATE public.cinema_content SET lifecycle_status='PUBLISHED', visibility='PUBLIC' WHERE id=ANY($1::uuid[])", [[series, season, free, free2]]);
  const uid = {};
  for (const [name, content, duration] of [['free', free, 120], ['free2', free2, 90]]) {
    uid[name] = randomUUID().replaceAll('-', '');
    await q("INSERT INTO public.cinema_uploads(content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,duration_seconds) VALUES($1,(SELECT id FROM public.users WHERE auth_id=$2),$3,100,$4,'ready',$5,$6)",
      [content, creator, randomUUID(), 'f'.repeat(64), uid[name], duration]);
  }

  // 1. A play start reserves the whole runtime up front — not a single minute.
  const viewer = await person();
  assert.deepEqual(await start(viewer, free), { access: 'free', stream_uid: uid.free });
  assert.deepEqual(await q("SELECT seconds, source FROM public.cinema_free_plays f JOIN public.users u ON u.id=f.user_id WHERE u.auth_id=$1", [viewer]),
    [{ seconds: 120, source: 'start' }], 'the full 120s runtime is reserved at start');
  assert.equal(await counted(viewer), 120, 'the ceiling counts the full lease immediately');

  // 2. The leak is closed: a viewer who sends NO heartbeat is still charged the runtime.
  //    (Before the fix only 60s would have been counted here.)
  assert.equal(await counted(viewer), 120);

  // 3. Heartbeats are analytics: they never add to the ceiling.
  const h = await beat(viewer, free, 60);
  assert.equal(await counted(viewer), 120, 'a heartbeat does not move the counted ceiling');
  assert.ok(h.ok === true || h.recorded === false, JSON.stringify(h));

  // 4. A second title's start adds its own runtime.
  assert.deepEqual(await start(viewer, free2), { access: 'free', stream_uid: uid.free2 });
  assert.equal(await counted(viewer), 210, '120 + 90');

  // 5. The ceiling binds on the up-front leases. Seed start rows to one 60s short,
  //    then a 120s title reserves only the 60s left and the account is then locked.
  const edge = await person();
  const eUser = await userId(edge);
  await q(`INSERT INTO public.cinema_free_plays(user_id,content_id,seconds,source) SELECT $1,$2,60,'start' FROM generate_series(1,$3::int)`, [eUser, free, CEILING - 1]);
  assert.equal(await counted(edge), (CEILING - 1) * 60);
  assert.deepEqual(await start(edge, free), { access: 'free', stream_uid: uid.free });
  assert.equal(await startRows(edge), CEILING * 60, 'the crossing play is cut to the 60s that remained');
  assert.deepEqual(await metered(edge, free), { access: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.deepEqual(await start(edge, free), { error: 'locked', credits: 0, reason: 'free_ceiling' });
  assert.equal(await startRows(edge), CEILING * 60, 'not one second past the ceiling');

  // 6. Concurrent starts cannot pass the ceiling (advisory lock).
  const crowd = await person();
  const cUser = await userId(crowd);
  await q(`INSERT INTO public.cinema_free_plays(user_id,content_id,seconds,source) SELECT $1,$2,60,'start' FROM generate_series(1,$3::int)`, [cUser, free, CEILING - 1]);
  const starts = await Promise.all(Array.from({ length: 4 }, async () => {
    const peer = new pg.Client({ connectionString: url }); await peer.connect();
    try { return (await peer.query('SELECT public.start_cinema_playback($1,$2) AS value', [crowd, free])).rows[0].value; }
    finally { await peer.end(); }
  }));
  assert.equal(starts.filter((r) => r.access === 'free').length, 1, 'exactly one concurrent start was granted');
  assert.equal(starts.filter((r) => r.reason === 'free_ceiling').length, 3);
  assert.equal(await startRows(crowd), CEILING * 60, 'concurrent starts cannot pass the ceiling');

  console.log('cinema free-lease enforcement: ok');
} finally { await c.end(); }
