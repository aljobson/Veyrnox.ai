#!/usr/bin/env node
// ADR-0246: throwaway local DB only; all fixtures and grants roll back together.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyProjectDocument, withTimeline } from '../lib/projectDocument.js';
import { jsonbTextBytes, validOddlingsProjectDocument } from '../lib/projectOddlingsDocument.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required (throwaway local test DB only).');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname))
    throw new Error('Oddlings tests require a throwaway local test DB.');
const db = new pg.Client({ connectionString });
await db.connect();
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const actor = async id => {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [id]);
    await db.query('SET LOCAL ROLE authenticated');
};
// Always send JSON text: passing a lone surrogate as raw text to pg would repair it.
const saveSql = 'SELECT public.save_project_document($1,$2,$3::jsonb,$4,$5)';
const argsFor = (project, expected, doc, key = randomUUID(), restore = null) => [project, expected, doc === null ? null : JSON.stringify(doc), key, restore];
const save = (...args) => value(saveSql, argsFor(...args));
const count = project => value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1', [project]);
const rejects = async (args, code, label) => {
    const before = await count(args[0]);
    await db.query('SAVEPOINT rejection');
    try {
        await assert.rejects(db.query(saveSql, args), e => code === '22' ? e.code?.startsWith('22') : e.code === code, label);
    } finally { await db.query('ROLLBACK TO SAVEPOINT rejection'); }
    assert.equal(await count(args[0]), before, `${label}: no revision appended`);
};
const passport = (n = 0) => ({ id: `oddling-${n}`, savedAt: 1792500000000, name: 'Pip', picks: { oddling_name: 'Pip', hair: 'fluffy' }, motionId: 'wave' });
const document = project => ({ ...emptyProjectDocument(project), schema_version: 4, oddlings: { version: 1, items: [passport()], draft: { savedAt: 1, picks: { hair: 'soft' } } } });
const manyPicks = (n, text = 'soft') => Object.fromEntries(Array.from({ length: n }, (_, i) => [`pick_${String.fromCharCode(97 + Math.floor(i / 26), 97 + i % 26)}`, text]));
const owner = randomUUID(), other = randomUUID();
try {
    await db.query('BEGIN');
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');
    for (const id of [owner, other]) await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [id, `oddlings-${id}@example.invalid`]);
    const workspace = await value('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1', [owner]);
    await actor(owner);
    const create = async name => (await value('SELECT public.create_project($1,$2,$3)', [workspace, name, randomUUID()])).project.id;
    const project = await create('Oddlings test'), doc = document(project);
    const saved = await save(project, 0, doc, 'oddlings-first');
    assert.equal(saved.revision, 1); assert.deepEqual(saved.document, doc);
    assert.deepEqual(await value('SELECT document FROM public.project_document_versions WHERE project_id=$1 AND revision=1', [project]), doc);
    const replay = await save(project, 0, doc, 'oddlings-first');
    assert.equal(replay.idempotent, true); assert.equal(replay.revision, 1);
    await rejects(argsFor(project, 0, { ...doc, brief: 'changed' }, 'oddlings-first'), 'PT409', 'changed replay');
    assert.equal(await count(project), '1');
    console.log('ok 1 - owner round-trip and idempotency');

    const invalid = [
        ['extra top-level key', d => { d.extra = true; }],
        ['missing oddlings', d => { delete d.oddlings; }],
        ['version 2', d => { d.oddlings.version = 2; }],
        ['25 items', d => { d.oddlings.items = Array.from({ length: 25 }, (_, i) => passport(i)); }],
        ['duplicate id', d => { d.oddlings.items.push(passport()); }],
        ['item extra key', d => { d.oddlings.items[0].extra = true; }],
        ['bad id', d => { d.oddlings.items[0].id = 'bad/id'; }],
        ['bad pick key', d => { d.oddlings.items[0].picks = { Hair: 'soft' }; }],
        ['long pick', d => { d.oddlings.items[0].picks.hair = 'a'.repeat(161); }],
        ['non-string pick', d => { d.oddlings.items[0].picks.hair = 1; }],
        ['65 picks', d => { d.oddlings.items[0].picks = manyPicks(65); }],
        ['bad draft', d => { d.oddlings.draft = { savedAt: 0, picks: {}, extra: true }; }],
        ['other project', d => { d.project_id = randomUUID(); }],
        ['over byte limit', d => { d.oddlings.items = Array.from({ length: 24 }, (_, i) => ({ ...passport(i), picks: manyPicks(64, '界'.repeat(160)) })); }],
        ['v2 carrying oddlings', d => { d.schema_version = 2; d.timeline = null; }],
        ['missing item field', d => { delete d.oddlings.items[0].motionId; }],
        ['missing draft', d => { delete d.oddlings.draft; }],
        ['extra collection field', d => { d.oddlings.extra = true; }],
        ['null item', d => { d.oddlings.items = [null]; }],
        ['non-array items', d => { d.oddlings.items = {}; }],
        ['null picks', d => { d.oddlings.items[0].picks = null; }],
        ['empty name', d => { d.oddlings.items[0].name = ''; }],
        ['long name', d => { d.oddlings.items[0].name = 'a'.repeat(41); }],
        ['emoji name units', d => { d.oddlings.items[0].name = 'a'.repeat(39) + '😀'; }],
        ['emoji pick units', d => { d.oddlings.items[0].picks.hair = '😀'.repeat(81); }],
        ['emoji brief units', d => { d.brief = '😀'.repeat(3001); }],
        ['bad motion', d => { d.oddlings.items[0].motionId = 'Wave'; }],
        ...[-1, 1e14 + 1, 0.5, '1', null].flatMap(savedAt => [
            [`item timestamp ${savedAt}`, d => { d.oddlings.items[0].savedAt = savedAt; }],
            [`draft timestamp ${savedAt}`, d => { d.oddlings.draft = { savedAt, picks: {} }; }],
        ]),
        ['control in brief', d => { d.brief = 'line\nbreak'; }],
        ['control in name', d => { d.oddlings.items[0].name = 'Pip\t'; }],
        ['control in pick', d => { d.oddlings.items[0].picks.hair = '\u0001'; }],
        ['control in key', d => { d.oddlings.items[0].picks = { 'hair\n': 'soft' }; }],
    ];
    for (const [label, edit] of invalid) {
        const bad = structuredClone(doc); edit(bad);
        assert.equal(validOddlingsProjectDocument(bad, project), false, label);
        await rejects(argsFor(project, 1, bad), 'PT400', label);
    }
    console.log('ok 2 - malformed direct saves return PT400 and append nothing');

    await actor(other);
    await rejects(argsFor(project, 1, doc), 'PT404', 'another account');
    assert.equal(await count(project), '0');
    assert.equal(await value('SELECT count(*) FROM public.projects WHERE id=$1', [project]), '0');
    await actor(owner);
    await rejects(argsFor(project, 1, withTimeline(emptyProjectDocument(project), null)), 'PT409', 'v2 onto v4');
    const editor = await create('Existing brief work');
    assert.equal((await save(editor, 0, emptyProjectDocument(editor))).revision, 1);
    await rejects(argsFor(editor, 1, document(editor)), 'PT409', 'v4 onto v1');
    console.log('ok 3 - RLS isolates reads/writes and kind changes conflict in both directions');

    const next = structuredClone(doc); next.oddlings.items.push(passport(1));
    assert.equal((await save(project, 1, next)).revision, 2);
    const stale = structuredClone(doc); stale.oddlings.items.push(passport(2));
    await rejects(argsFor(project, 1, stale), 'PT409', 'second save at same expected revision');
    assert.deepEqual(await value('SELECT document FROM public.project_document_versions WHERE project_id=$1 ORDER BY revision DESC LIMIT 1', [project]), next);
    const restored = await save(project, 2, null, 'oddlings-restore', 1);
    assert.equal(restored.revision, 3); assert.deepEqual(restored.document, doc);
    assert.equal(restored.restored_from, 1);
    console.log('ok 4 - stale save preserves the first edit; restore appends revision 3');

    for (const surrogate of ['abc\uD83D', '\uDE00abc']) {
        const bad = structuredClone(doc); bad.oddlings.items[0].name = surrogate;
        await rejects(argsFor(project, 3, bad), '22', 'invalid Unicode input');
    }
    const emoji = structuredClone(doc); emoji.oddlings.items[0].name = 'a'.repeat(38) + '😀';
    const paired = await save(project, 3, emoji);
    assert.equal(paired.revision, 4); assert.deepEqual(paired.document, emoji);
    assert.equal(await value('SELECT octet_length(document::text) FROM public.project_document_versions WHERE project_id=$1 AND revision=4', [project]), jsonbTextBytes(emoji));
    console.log('ok 5 - PostgreSQL refuses lone surrogate JSON; a valid pair round-trips');

    const sizedProject = await create('Size boundary'), exact = document(sizedProject);
    exact.oddlings.items[0].name = 'Pip 😀';
    exact.oddlings.items[0].picks = manyPicks(64, '界'.repeat(145) + '😀😀');
    exact.brief = 'x'.repeat(32768 - jsonbTextBytes(exact));
    const over = { ...exact, brief: exact.brief + 'x' };
    for (const [candidate, bytes] of [[exact, 32768], [over, 32769]]) {
        assert.equal(jsonbTextBytes(candidate), bytes);
        assert.equal(await value('SELECT octet_length($1::jsonb::text)', [JSON.stringify(candidate)]), bytes);
        assert.equal(validOddlingsProjectDocument(candidate, sizedProject), bytes === 32768);
    }
    assert.equal((await save(sizedProject, 0, exact)).revision, 1);
    await rejects(argsFor(sizedProject, 1, over), 'PT400', '32769-byte document');
    for (let i = 0; i < 5; i++) {
        const random = document(sizedProject);
        random.oddlings.items = Array.from({ length: 1 + Math.floor(Math.random() * 24) }, (_, n) => ({
            ...passport(n), savedAt: Math.floor(Math.random() * 1e14), name: 'Pip 😀',
            picks: manyPicks(1 + Math.floor(Math.random() * 4), '界😀'.repeat(1 + Math.floor(Math.random() * 10))),
        }));
        assert.equal(validOddlingsProjectDocument(random, sizedProject), true);
        assert.equal(await value('SELECT octet_length($1::jsonb::text)', [JSON.stringify(random)]), jsonbTextBytes(random));
    }
    console.log('ok 6 - JS/jsonb byte parity, exact 32768/32769 boundaries and five random collections');

    await db.query('RESET ROLE');
    for (const role of ['anon', 'authenticated', 'service_role'])
        for (const helper of ['private.project_oddling_picks_within_bounds(jsonb)', 'private.project_oddlings_within_bounds(jsonb)'])
            assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE')", [role, helper]), false, `${role}: ${helper}`);
    console.log('ok 7 - both internal bounds helpers are inaccessible to API roles');
} finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
}
