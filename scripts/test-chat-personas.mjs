#!/usr/bin/env node
// 0216 (ADR-0072): chat personas. Runs against the full migration replay (ledger-tests.yml). Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const c = new pg.Client({ connectionString: url });
await c.connect();
const one = async (sql, args = []) => (await c.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await one(`SELECT ${sql} AS r`, args)).r;
async function user() {
    const auth = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, now())', [auth, `${auth}@example.invalid`]);
    return auth;
}
const save = (auth, id, name, text = 'Be brief.', model = null, thinking = false, web = false) =>
    rpc('public.chat_save_persona($1, $2, $3, $4, $5, $6, $7)', [auth, id, name, text, model, thinking, web]);
const list = async (auth) => (await rpc('public.chat_list_personas($1)', [auth])).personas;

try {
    const migration = await readFile(new URL('../packages/db/schema/supabase/0216_chat_personas.sql', import.meta.url), 'utf8');
    await c.query('BEGIN'); await c.query(migration); await c.query(migration); await c.query('ROLLBACK'); // safe to apply twice

    await c.query('BEGIN');
    const a = await user(), b = await user();
    const text = (await one(`SELECT id FROM public.model_catalog WHERE modality = 'text' AND provider = 'openrouter-chat' AND active LIMIT 1`))?.id
        ?? (await one(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, active)
            VALUES ('persona-test-model', 'p', 'openrouter-chat', 'test/model', 'text', 1, 0.0020, true) RETURNING id`)).id;

    // Create, list, change.
    const made = await save(a, null, '  Editor  ', '  Tighten my writing.  ', text, true, false);
    assert.equal(made.ok, true, JSON.stringify(made));
    assert.deepEqual([made.persona.name, made.persona.instructions, made.persona.model_id, made.persona.thinking, made.persona.web], ['Editor', 'Tighten my writing.', text, true, false], 'trimmed and stored');
    assert.deepEqual((await list(a)).map((p) => p.name), ['Editor']);
    const changed = await save(a, made.persona.id, 'Editor', 'Cut every adverb.', null, false, true);
    assert.deepEqual([changed.ok, changed.persona.instructions, changed.persona.model_id, changed.persona.web], [true, 'Cut every adverb.', null, true]);
    assert.equal((await list(a)).length, 1, 'a change is not a new persona');

    // Names are unique per person, ignoring case, and renaming into a taken name is refused.
    assert.equal((await save(a, null, 'EDITOR')).code, 'PERSONA_EXISTS');
    const second = await save(a, null, 'Coach');
    assert.equal((await save(a, second.persona.id, 'editor')).code, 'PERSONA_EXISTS');
    assert.equal((await save(b, null, 'Editor')).ok, true, 'another person may use the same name');

    // Isolation: nobody can read, change or delete another person's persona.
    assert.deepEqual((await list(b)).map((p) => p.name), ['Editor']);
    assert.notEqual((await list(b))[0].id, made.persona.id);
    assert.equal((await save(b, made.persona.id, 'Hijack')).code, 'PERSONA_NOT_FOUND');
    assert.equal((await rpc('public.chat_delete_persona($1, $2)', [b, made.persona.id])).code, 'PERSONA_NOT_FOUND');
    assert.equal((await list(a)).find((p) => p.id === made.persona.id).instructions, 'Cut every adverb.', 'unchanged by the attempt');
    assert.equal((await list(randomUUID())).length, 0, 'an unknown account has none');
    assert.equal((await save(randomUUID(), null, 'X')).code, 'USER_NOT_FOUND');

    // Input rules.
    for (const [name, instr, label] of [['', 'x', 'empty name'], ['x'.repeat(61), 'x', 'long name'], ['ok', '', 'empty instructions'], ['ok', '   ', 'blank instructions'], ['ok', 'x'.repeat(4001), 'long instructions']]) {
        assert.equal((await save(a, null, name, instr)).code, 'INVALID_INPUT', label);
    }
    assert.equal((await save(a, null, 'ok', 'x'.repeat(4000))).ok, true, '4,000 characters is allowed');
    assert.equal((await rpc('public.chat_save_persona($1, NULL, $2, $3, NULL, NULL, false)', [a, 'nulls', 'x'])).code, 'INVALID_INPUT', 'null flags refused');
    assert.equal((await save(a, null, 'Ghost', 'x', 'no-such-model')).code, 'MODEL_NOT_FOUND');
    await c.query(`UPDATE public.model_catalog SET active = false WHERE id = $1`, [text]);
    assert.equal((await save(a, null, 'Off', 'x', text)).code, 'MODEL_NOT_FOUND', 'an inactive model cannot be the default');
    await c.query(`UPDATE public.model_catalog SET active = true WHERE id = $1`, [text]);

    // Twenty at most; a change at the cap still works, and deleting makes room.
    const have = (await list(a)).length;
    for (let i = have; i < 20; i += 1) assert.equal((await save(a, null, `P${i}`)).ok, true);
    assert.equal((await save(a, null, 'One too many')).code, 'PERSONA_LIMIT');
    assert.equal((await save(a, made.persona.id, 'Editor', 'Still editable at the cap.')).ok, true);
    assert.equal((await rpc('public.chat_delete_persona($1, $2)', [a, second.persona.id])).ok, true);
    assert.equal((await save(a, null, 'Room again')).ok, true);

    // A retired model leaves the persona, with no default, rather than breaking it.
    const tmp = (await one(`INSERT INTO public.model_catalog (id, name, provider, provider_endpoint, modality, credits_5s, provider_cost_per_unit, active)
        VALUES ($1, 'tmp', 'openrouter-chat', 'test/model', 'text', 1, 0.0020, true) RETURNING id`, [`persona-tmp-${randomUUID().slice(0, 6)}`])).id;
    const pinned = await save(b, null, 'Pinned', 'x', tmp);
    await c.query('DELETE FROM public.model_catalog WHERE id = $1', [tmp]);
    assert.equal((await list(b)).find((p) => p.id === pinned.persona.id).model_id, null);

    // Reachable only through the functions, by the service role.
    const rls = await one(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.chat_personas'::regclass`);
    assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
    const grants = await c.query(`SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'chat_personas' AND grantee IN ('anon','authenticated','PUBLIC','service_role')`);
    assert.equal(grants.rowCount, 0);
    for (const sig of ['chat_list_personas(text)', 'chat_save_persona(text,uuid,text,text,text,boolean,boolean)', 'chat_delete_persona(text,uuid)']) {
        const r = await one(`SELECT has_function_privilege('anon', 'public.${sig}', 'EXECUTE') AS anon, has_function_privilege('authenticated', 'public.${sig}', 'EXECUTE') AS auth,
            has_function_privilege('service_role', 'public.${sig}', 'EXECUTE') AS svc`);
        assert.deepEqual(r, { anon: false, auth: false, svc: true }, sig);
    }

    // It goes with the account.
    // An unconfirmed account has no ledger rows (the signup grant waits for confirmation), so it can be deleted; the ledger is append-only.
    const gone = randomUUID();
    await c.query('INSERT INTO auth.users(id, email, email_confirmed_at) VALUES ($1, $2, NULL)', [gone, `${gone}@example.invalid`]);
    assert.equal((await save(gone, null, 'Temp')).ok, true);
    await c.query('DELETE FROM public.users WHERE auth_id = $1', [gone]);
    assert.equal((await one(`SELECT count(*)::int AS n FROM public.chat_personas WHERE name = 'Temp'`)).n, 0);
    await c.query('ROLLBACK');
    console.log('chat personas: ok');
} finally {
    await c.end();
}
