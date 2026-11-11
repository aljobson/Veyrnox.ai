/**
 * Music proof-slice acceptance tests (0250).
 *
 * The suite is skipped unless DATABASE_URL points at a disposable database
 * with the normal migration chain. Everything runs in one rolled-back
 * transaction so fixtures and function replacements never leak to siblings.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const DATABASE_URL = process.env.DATABASE_URL;

describe('music pair foundation (0250)', { skip: !DATABASE_URL && 'DATABASE_URL not set' }, () => {
  let client;
  let pool;

  before(async () => {
    const pg = (await import('pg')).default;
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    client = await pool.connect();
    await client.query('BEGIN');
    const sql = await readFile(new URL('./schema/supabase/0457_music_pair_foundation.sql', import.meta.url), 'utf8');
    const draftSql = await readFile(new URL('./schema/supabase/0458_music_custom_drafts.sql', import.meta.url), 'utf8');
    const workspaceSql = await readFile(new URL('./schema/supabase/0459_music_private_workspaces.sql', import.meta.url), 'utf8');
    const lineageSql = await readFile(new URL('./schema/supabase/0460_music_version_lineage.sql', import.meta.url), 'utf8');
    await client.query(sql);
    await client.query(sql);
    await client.query(draftSql);
    await client.query(draftSql);
    await client.query(workspaceSql);
    await client.query(workspaceSql);
    await client.query(lineageSql);
    await client.query(lineageSql);
  });

  after(async () => {
    if (client) { await client.query('ROLLBACK'); client.release(); }
    if (pool) await pool.end();
  });

  const one = async (sql: string, params: unknown[] = []) => (await client.query(sql, params)).rows[0];

  async function user(packCredits = 0) {
    const authId = randomUUID();
    const row = await one('SELECT public.signup_grant($1, $2) AS id', [authId, `${authId}@test.veyrnox.ai`]);
    if (packCredits > 0) {
      const granted = (await one(
        "SELECT public.ledger_grant($1, $2, 'grant:topup') AS r",
        [row.id, packCredits],
      )).r;
      assert.equal(granted.ok, true);
    }
    return { authId, id: row.id as string };
  }

  async function quote(authId: string, prompt = 'slow harbour lights') {
    return (await one('SELECT public.music_create_quote($1,$2,$3,$4) AS r', [authId, prompt, 'Harbour', 'ace-step'])).r;
  }

  it('charges once and creates exactly two independently linked jobs', async () => {
    const owner = await user(100);
    const beforeBalance = Number((await one('SELECT balance FROM public.credit_balances WHERE user_id=$1', [owner.id])).balance);
    const q = await quote(owner.authId);
    assert.equal(q.ok, true);
    assert.equal(q.balance, beforeBalance);
    assert.equal(q.balance_after, beforeBalance - q.total_credits);
    assert.equal(q.affordable, true);
    const key = `music.${randomUUID()}`;
    const first = (await one('SELECT public.music_submit_pair($1,$2,$3) AS r', [owner.authId, q.quote_id, key])).r;
    assert.equal(first.ok, true);
    assert.equal(first.job_ids.length, 2);
    assert.equal(new Set(first.job_ids).size, 2);
    assert.equal(first.balance_after, beforeBalance - q.total_credits);

    const replay = (await one('SELECT public.music_submit_pair($1,$2,$3) AS r', [owner.authId, q.quote_id, key])).r;
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.job_ids, first.job_ids);
    assert.equal(replay.balance_after, first.balance_after);
    assert.equal(Number((await one(
      'SELECT count(*) AS n FROM public.music_generation_candidates WHERE generation_request_id=$1',
      [first.request_id],
    )).n), 2);
  });

  it('does not reveal another account generation', async () => {
    const owner = await user(100);
    const stranger = await user();
    const q = await quote(owner.authId, 'private pulse');
    const made = (await one('SELECT public.music_submit_pair($1,$2,$3) AS r', [owner.authId, q.quote_id, `music.${randomUUID()}`])).r;
    const hidden = (await one('SELECT public.music_get_generation($1,$2) AS r', [stranger.authId, made.request_id])).r;
    assert.deepEqual(hidden, { ok: false, code: 'NOT_FOUND' });
  });

  it('autosaves custom lyrics with optimistic conflicts and owner isolation', async () => {
    const owner = await user();
    const stranger = await user();
    const initial = (await one('SELECT public.music_get_custom_draft($1) AS r', [owner.authId])).r;
    assert.equal(initial.ok, true);
    assert.equal(initial.draft.revision, 0);
    assert.equal(initial.draft.lyrics, '');

    const saved = (await one(
      'SELECT public.music_save_custom_draft($1,$2,$3,$4,$5,$6) AS r',
      [owner.authId, 0, 'ace-step', '[Verse]\nCafé lights ✨', 'Warm piano', 'Harbour Frame'],
    )).r;
    assert.equal(saved.ok, true);
    assert.equal(saved.draft.revision, 1);
    assert.equal(saved.draft.lyrics, '[Verse]\nCafé lights ✨');

    const conflict = (await one(
      'SELECT public.music_save_custom_draft($1,$2,$3,$4,$5,$6) AS r',
      [owner.authId, 0, 'ace-step', 'stale edit', '', ''],
    )).r;
    assert.equal(conflict.ok, false);
    assert.equal(conflict.code, 'REVISION_CONFLICT');
    assert.equal(conflict.draft.revision, 1);
    assert.equal(conflict.draft.lyrics, saved.draft.lyrics);

    const hidden = (await one('SELECT public.music_get_custom_draft($1) AS r', [stranger.authId])).r;
    assert.equal(hidden.ok, true);
    assert.equal(hidden.draft.revision, 0);
    assert.equal(hidden.draft.lyrics, '');
  });

  it('creates private workspaces idempotently and moves owned songs atomically', async () => {
    const owner = await user();
    const stranger = await user();
    const listed = (await one('SELECT public.music_list_workspaces($1) AS r', [owner.authId])).r;
    assert.equal(listed.ok, true);
    assert.equal(listed.workspaces.length, 1);
    assert.equal(listed.workspaces[0].is_default, true);
    const defaultId = listed.workspaces[0].id;

    const key = `workspace.${randomUUID()}`;
    const created = (await one('SELECT public.music_create_workspace($1,$2,$3) AS r', [owner.authId, 'Film cues', key])).r;
    assert.equal(created.ok, true);
    assert.equal(created.idempotent, false);
    const replay = (await one('SELECT public.music_create_workspace($1,$2,$3) AS r', [owner.authId, 'Film cues', key])).r;
    assert.equal(replay.ok, true);
    assert.equal(replay.idempotent, true);
    assert.equal(replay.workspace.id, created.workspace.id);

    const songA = await one('INSERT INTO public.music_songs(user_id,title) VALUES ($1,$2) RETURNING id,workspace_id,revision', [owner.id, 'Owner A']);
    const songB = await one('INSERT INTO public.music_songs(user_id,title) VALUES ($1,$2) RETURNING id,workspace_id,revision', [owner.id, 'Owner B']);
    const foreign = await one('INSERT INTO public.music_songs(user_id,title) VALUES ($1,$2) RETURNING id,workspace_id,revision', [stranger.id, 'Foreign']);
    assert.equal(songA.workspace_id, defaultId);

    const moveKey = `move.${randomUUID()}`;
    const moveItems = JSON.stringify([{ id: songA.id, revision: 0 }, { id: songB.id, revision: 0 }]);
    const moved = (await one('SELECT public.music_move_songs($1,$2,$3::jsonb,$4) AS r', [
      owner.authId,
      created.workspace.id,
      moveItems,
      moveKey,
    ])).r;
    assert.equal(moved.ok, true);
    assert.equal(moved.moved, 2);
    assert.ok(moved.songs.every((song: { workspace_id: string; revision: number }) => song.workspace_id === created.workspace.id && song.revision === 1));
    const moveReplay = (await one('SELECT public.music_move_songs($1,$2,$3::jsonb,$4) AS r', [
      owner.authId, created.workspace.id, moveItems, moveKey,
    ])).r;
    assert.equal(moveReplay.ok, true);
    assert.equal(moveReplay.idempotent, true);
    assert.equal(moveReplay.moved, 2);

    const stale = (await one('SELECT public.music_move_songs($1,$2,$3::jsonb,$4) AS r', [
      owner.authId, defaultId, JSON.stringify([{ id: songA.id, revision: 0 }]), `move.${randomUUID()}`,
    ])).r;
    assert.deepEqual(stale, { ok: false, code: 'REVISION_CONFLICT' });
    const mixedOwner = (await one('SELECT public.music_move_songs($1,$2,$3::jsonb,$4) AS r', [
      owner.authId,
      defaultId,
      JSON.stringify([{ id: songA.id, revision: 1 }, { id: foreign.id, revision: 0 }]),
      `move.${randomUUID()}`,
    ])).r;
    assert.deepEqual(mixedOwner, { ok: false, code: 'NOT_FOUND' });
    assert.equal((await one('SELECT workspace_id FROM public.music_songs WHERE id=$1', [songA.id])).workspace_id, created.workspace.id);
  });

  it('browser roles cannot execute service mutation functions', async () => {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await one(
        "SELECT has_function_privilege($1,'public.music_submit_pair(TEXT,UUID,TEXT)','EXECUTE') AS p",
        [role],
      )).p, false);
    }
    assert.equal((await one(
      "SELECT has_function_privilege('service_role','public.music_submit_pair(TEXT,UUID,TEXT)','EXECUTE') AS p",
    )).p, true);
    assert.equal((await one(
      "SELECT has_function_privilege('authenticated','public.music_save_custom_draft(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT)','EXECUTE') AS p",
    )).p, false);
    assert.equal((await one(
      "SELECT has_function_privilege('service_role','public.music_save_custom_draft(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT)','EXECUTE') AS p",
    )).p, true);
    assert.equal((await one(
      "SELECT has_function_privilege('authenticated','public.music_move_songs(TEXT,UUID,JSONB,TEXT)','EXECUTE') AS p",
    )).p, false);
    assert.equal((await one(
      "SELECT has_function_privilege('service_role','public.music_move_songs(TEXT,UUID,JSONB,TEXT)','EXECUTE') AS p",
    )).p, true);
    assert.equal((await one(
      "SELECT has_table_privilege('authenticated','public.music_version_sources','INSERT') AS p",
    )).p, false);
    assert.equal((await one(
      "SELECT has_table_privilege('service_role','public.music_version_sources','INSERT') AS p",
    )).p, true);
  });
});
