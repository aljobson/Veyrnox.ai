#!/usr/bin/env node
// 0208: chat folders. A folder groups chats; deleting one keeps its chats. Runs against the full migration
// replay (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const q = async (sql, args = []) => (await c.query(sql, args)).rows;
const one = async (sql, args = []) => (await q(sql, args))[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;

async function user() {
    const auth = randomUUID();
    await q('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return { auth, id: (await one('SELECT id FROM public.users WHERE auth_id = $1', [auth])).id };
}
const refusedAs = async (role, sql, args) => {
    await c.query('SAVEPOINT r');
    try { await c.query(`SET LOCAL ROLE ${role}`); await c.query(sql, args); assert.fail(`${role} was allowed: ${sql}`); }
    catch (err) { assert.equal(err.code, '42501', err.message); }
    finally { await c.query('ROLLBACK TO SAVEPOINT r'); }
};
const model = async (id) => {
    await q(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, active)
             VALUES ($1, $1, 'openrouter-chat', 'test/model', 'text', 1, 0.0004, true)`, [id]);
    return id;
};

const thread = (u, m) => rpc('public.chat_create_thread($1, $2)', [u.auth, m]);
const folders = (u) => rpc('public.chat_list_folders($1)', [u.auth]);
const createFolder = (u, name) => rpc('public.chat_create_folder($1, $2)', [u.auth, name]);
const renameFolder = (u, id, name) => rpc('public.chat_rename_folder($1, $2, $3)', [u.auth, id, name]);
const deleteFolder = (u, id) => rpc('public.chat_delete_folder($1, $2)', [u.auth, id]);
const move = (u, t, f) => rpc('public.chat_move_thread($1, $2, $3)', [u.auth, t, f]);
const listed = async (u) => (await rpc('public.chat_list_threads($1)', [u.auth])).threads;

try {
    // The migration is safe to apply twice.
    const sql = await readFile(new URL('../packages/db/schema/supabase/0208_chat_folders.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(sql); await c.query(sql); await c.query('ROLLBACK');

    await c.query('BEGIN');
    const a = await user(); const b = await user();
    const m = await model(`chat-folders-${randomUUID().slice(0, 8)}`);

    // ── Create, list, rename ──
    assert.deepEqual(await folders(a), { ok: true, folders: [] });
    const work = await createFolder(a, '  Work  ');
    assert.equal(work.ok, true);
    assert.equal(work.folder.name, 'Work', 'the name is trimmed');
    assert.equal(work.folder.count, 0);
    const home = await createFolder(a, 'Home');
    const list = (await folders(a)).folders;
    assert.deepEqual(list.map((f) => f.name), ['Home', 'Work'], 'listed by name');
    assert.equal((await renameFolder(a, work.folder.id, 'Client work')).folder.name, 'Client work');

    // ── Names ──
    for (const bad of ['', '   ', 'x'.repeat(61)]) {
        assert.equal((await createFolder(a, bad)).code, 'INVALID_INPUT', JSON.stringify(bad.slice(0, 8)));
    }
    assert.equal((await createFolder(a, 'x'.repeat(60))).ok, true, '60 characters is allowed');
    assert.equal((await createFolder(a, 'HOME')).code, 'FOLDER_EXISTS', 'names are unique per person, ignoring case');
    assert.equal((await renameFolder(a, work.folder.id, 'home')).code, 'FOLDER_EXISTS');
    assert.equal((await renameFolder(a, work.folder.id, 'Client work')).ok, true, 'renaming to the same name is fine');
    assert.equal((await createFolder(b, 'Home')).ok, true, 'another person may use the same name');

    // ── A person can have fifty ──
    for (let i = 0; i < 47; i++) assert.equal((await createFolder(a, `Folder ${i}`)).ok, true);
    assert.equal((await folders(a)).folders.length, 50);
    assert.equal((await createFolder(a, 'One too many')).code, 'FOLDER_LIMIT');

    // ── Moving chats ──
    const t1 = (await thread(a, m)).thread.id; const t2 = (await thread(a, m)).thread.id;
    assert.equal((await listed(a)).find((t) => t.id === t1).folder_id, null, 'new chats are unfiled');
    assert.equal((await move(a, t1, work.folder.id)).ok, true);
    assert.equal((await move(a, t2, work.folder.id)).ok, true);
    assert.equal((await listed(a)).find((t) => t.id === t1).folder_id, work.folder.id);
    assert.equal((await folders(a)).folders.find((f) => f.id === work.folder.id).count, 2, 'the count follows the chats');
    assert.equal((await move(a, t1, home.folder.id)).ok, true, 'moving between folders');
    assert.equal((await move(a, t1, null)).ok, true, 'null unfiles');
    assert.equal((await listed(a)).find((t) => t.id === t1).folder_id, null);

    // ── Nobody else's ──
    const theirs = (await createFolder(b, 'Private')).folder.id;
    const theirThread = (await thread(b, m)).thread.id;
    assert.equal((await move(a, t1, theirs)).code, 'FOLDER_NOT_FOUND', 'cannot file into another person\'s folder');
    assert.equal((await move(a, theirThread, work.folder.id)).code, 'THREAD_NOT_FOUND', 'cannot move another person\'s chat');
    assert.equal((await renameFolder(a, theirs, 'Mine now')).code, 'FOLDER_NOT_FOUND');
    assert.equal((await deleteFolder(a, theirs)).code, 'FOLDER_NOT_FOUND');
    assert.equal((await folders(b)).folders.find((f) => f.id === theirs).name, 'Private', 'their folder is untouched');
    assert.equal((await move(a, randomUUID(), null)).code, 'THREAD_NOT_FOUND');
    assert.equal((await move(a, t1, randomUUID())).code, 'FOLDER_NOT_FOUND');
    assert.equal((await move({ auth: randomUUID() }, t1, null)).code, 'THREAD_NOT_FOUND', 'an unknown person');

    // ── Deleting a folder keeps its chats ──
    assert.equal((await deleteFolder(a, work.folder.id)).ok, true);
    const after = await listed(a);
    assert.equal(after.length, 1 + 0 + 1, 'both of this person\'s chats are still there');
    assert.equal(after.find((t) => t.id === t2).folder_id, null, 'and unfiled');
    assert.equal((await folders(a)).folders.some((f) => f.id === work.folder.id), false);
    assert.equal((await deleteFolder(a, work.folder.id)).code, 'FOLDER_NOT_FOUND', 'a second delete finds nothing');

    // ── Deleting a chat leaves its folder ──
    assert.equal((await move(a, t1, home.folder.id)).ok, true);
    assert.equal((await rpc('public.chat_delete_thread($1, $2)', [a.auth, t1])).ok, true);
    assert.equal((await folders(a)).folders.find((f) => f.id === home.folder.id).count, 0);

    // ── The folders go with the account, as the chats do. A user with a ledger history cannot be deleted at all in this
    // database (the ledger link restricts it), so check the rule each table declares rather than deleting a user. ──
    const cascade = async (table, col) => (await one(
        `SELECT confdeltype::text AS t FROM pg_constraint WHERE conrelid = $1::regclass AND contype = 'f'
           AND confrelid = 'public.users'::regclass AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = $1::regclass AND attname = $2)]`,
        [table, col])).t;
    assert.equal(await cascade('public.chat_folders', 'user_id'), 'c');
    assert.equal(await cascade('public.chat_threads', 'user_id'), 'c', 'the same rule the chats use');

    // ── Browser roles reach nothing ──
    for (const role of ['anon', 'authenticated']) {
        await refusedAs(role, 'SELECT * FROM public.chat_folders', []);
        await refusedAs(role, 'SELECT public.chat_list_folders($1)', [a.auth]);
        await refusedAs(role, 'SELECT public.chat_create_folder($1, $2)', [a.auth, 'x']);
        await refusedAs(role, 'SELECT public.chat_rename_folder($1, $2, $3)', [a.auth, home.folder.id, 'x']);
        await refusedAs(role, 'SELECT public.chat_delete_folder($1, $2)', [a.auth, home.folder.id]);
        await refusedAs(role, 'SELECT public.chat_move_thread($1, $2, $3)', [a.auth, t2, null]);
    }
    const flags = await one(`SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced FROM pg_class c
                             WHERE c.oid = 'public.chat_folders'::regclass`);
    assert.deepEqual([flags.rls, flags.forced], [true, true]);
    await c.query('ROLLBACK');

    console.log('chat folders: ok');
} finally {
    await c.query('ROLLBACK').catch(() => {});
    await c.end();
}
