#!/usr/bin/env node
// v3 independent timeline saves: throwaway local DB only, all fixtures rolled back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyProjectDocument, withTimeline } from '../lib/projectDocument.js';
import { emptySequence, addSequenceMarker, addSequenceText, updateSequenceTrack } from '../app/veyrnox/_lib/editorSequence.mjs';
import { groupSelection } from '../app/veyrnox/_lib/editorSelection.mjs';
import { insertGraphic } from '../app/veyrnox/_lib/editorPresets.mjs';
const connectionString = process.env.DATABASE_URL, url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) throw new Error('Multitrack tests require a throwaway local test DB.');
const db = new pg.Client({ connectionString }); await db.connect();
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const actor = async id => { await db.query('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [id || '']); await db.query('SET LOCAL ROLE authenticated'); };
const rejects = async (args, code) => { await db.query('SAVEPOINT rejection'); try { await assert.rejects(db.query('SELECT public.save_project_document($1,$2,$3,$4,$5)', args), e => e.code === code); } finally { await db.query('ROLLBACK TO SAVEPOINT rejection'); } };
const owner = randomUUID(), other = randomUUID();
try {
    await db.query('BEGIN'); await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');
    for (const id of [owner, other]) await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [id, `multi-${id}@example.invalid`]);
    const workspace = await value('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1', [owner]); await actor(owner);
    const project = (await value('SELECT public.create_project($1,$2,$3)', [workspace, 'Multitrack test', 'create-multi-test'])).project.id;
    let tl = addSequenceText(insertGraphic(emptySequence(), 'star', '#32d6c5', 30), { text: 'Caption\nTwo lines', start: 60, len: 30, caption: true });
    tl = groupSelection(tl, [{ track: 'video', id: tl.video[0].id }, { track: 'text', id: tl.text[0].id }]);
    tl = addSequenceMarker(updateSequenceTrack(tl, 'audio-0', { solo: true }), 30, 'Review cut');
    const doc = withTimeline(emptyProjectDocument(project), tl);
    const saved = await value('SELECT public.save_project_document($1,0,$2,$3,NULL)', [project, doc, 'multi-key-1']);
    assert.equal(saved.revision, 1); assert.deepEqual(saved.document, doc); console.log('ok 1 - v3 timed graphics and captions save without changing the document');
    const replay = await value('SELECT public.save_project_document($1,0,$2,$3,NULL)', [project, doc, 'multi-key-1']); assert.equal(replay.idempotent, true);
    await rejects([project, 1, { ...doc, brief: 'changed' }, 'multi-key-1', null], 'PT409'); console.log('ok 2 - replay is idempotent and a changed payload conflicts');
    const marker = tl.markers[0];
    const invalid = [{ ...doc, schema_version: 2 }, { ...doc, timeline: null }, ...['seq','tracks','media','video','audio','text','markers'].map(key => ({ ...doc, timeline: { ...tl, [key]: 'invalid' } })), { ...doc, timeline: { ...tl, seq: 'not-a-number' } }, { ...doc, timeline: { ...tl, video: [{ ...tl.video[0], start: 17999, len: 90 }] } }, ...[{ ...marker, frame: -1 }, { ...marker, frame: 1.5 }, { ...marker, label: '' }, { ...marker, color: 'red' }, { ...marker, extra: true }].map(marker => ({ ...doc, timeline: { ...tl, markers: [marker] } })), { ...doc, timeline: { ...tl, markers: [marker, marker] } }];
    for (const bad of invalid) await rejects([project, 1, bad, randomUUID(), null], 'PT400');
    assert.equal(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1', [project]), '1'); console.log('ok 3 - malformed direct saves return typed errors and append nothing');
    await actor(other); await rejects([project, 1, doc, 'multi-other', null], 'PT404'); await actor(owner); console.log('ok 4 - another tenant cannot save this project');
    await value('SELECT public.save_project_document($1,1,$2,$3,NULL)', [project, emptyProjectDocument(project), 'multi-v1-save']);
    const restore = await value('SELECT public.save_project_document($1,2,NULL,$2,1)', [project, 'multi-restore']); assert.equal(restore.revision, 3); assert.deepEqual(restore.document, doc); console.log('ok 5 - restore appends a new revision with all independent timing');
    await db.query('RESET ROLE'); for (const role of ['anon','authenticated','service_role']) for (const name of ['private.project_timeline_within_bounds(jsonb)','private.project_timeline_v2_within_bounds(jsonb)']) assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE')", [role, name]), false);
    console.log('ok 6 - neither internal bounds helper is exposed to API roles');
} finally { await db.query('ROLLBACK').catch(() => {}); await db.end(); }
