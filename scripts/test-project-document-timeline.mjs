#!/usr/bin/env node
// Project document v2 (0255, ADR-0080 slice 3): a document may carry the browser editor's timeline. Proves the SQL contract on the
// replayed chain: v1 keeps saving, v2 needs the timeline key, a timeline is bounded in SQL (shape, counts, size) while the Worker
// validates every number, restore round-trips a v2 revision, and 0254's caps are still in the function body. Throwaway LOCAL
// database only; everything is rolled back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyProjectDocument, withTimeline } from '../lib/projectDocument.js';
import { FPS, emptyTimeline, addMedia, addVideoClip, addText, setTransition } from '../app/veyrnox/_lib/editorTimeline.mjs';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
    throw new Error('Document timeline tests refuse remote databases and non-test database names');
}
const db = new pg.Client({ connectionString });
await db.connect();
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok ${passed} - ${name}`); };
const value = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
const actor = async id => { await db.query('RESET ROLE'); await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [id || '']); await db.query('SET LOCAL ROLE authenticated'); };
const rejects = async (sql, args, code) => {
    await db.query('SAVEPOINT rejection');
    try { await assert.rejects(db.query(sql, args), e => e.code === code, code); } finally { await db.query('ROLLBACK TO SAVEPOINT rejection'); }
};
const save = 'SELECT public.save_project_document($1,$2,$3,$4,$5)';
const vid = (id, seconds) => ({ id, kind: 'video', frames: seconds * FPS, name: `${id}.mp4`, hasAudio: true, width: 1280, height: 720 });
function timeline() {
    let tl = emptyTimeline();
    tl = addMedia(tl, vid('j-abc', 4)); tl = addMedia(tl, vid('l-1', 6));
    tl = addVideoClip(tl, 'j-abc'); tl = addVideoClip(tl, 'l-1'); tl = setTransition(tl, 'v2', 30); tl = addText(tl, { text: 'Hello', start: 30, len: 60 });
    return JSON.parse(JSON.stringify(tl));
}
const owner = randomUUID();
try {
    await db.query('BEGIN');
    await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [owner, `tl-${owner}@example.invalid`]);
    const workspace = await value('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1', [owner]);
    await actor(owner);
    const project = (await value('SELECT public.create_project($1,$2,$3)', [workspace, 'Timeline test', 'create-tl-test'])).project.id;
    const v1 = { ...emptyProjectDocument(project), brief: 'A brief' };
    const v2 = withTimeline(v1, timeline());

    await check('a v1 document still saves, and a v2 with a timeline saves and round-trips the timeline unchanged', async () => {
        assert.equal((await value(save, [project, 0, v1, 'tl-key-1', null])).revision, 1);
        const r = await value(save, [project, 1, v2, 'tl-key-2', null]);
        assert.equal(r.revision, 2);
        assert.deepEqual(r.document.timeline, v2.timeline);
        assert.equal(r.document.schema_version, 2);
    });
    await check('a v2 with timeline null saves; a replay of the same request is idempotent', async () => {
        const r = await value(save, [project, 2, withTimeline(v1, null), 'tl-key-3', null]);
        assert.equal(r.revision, 3); assert.equal(r.document.timeline, null);
        assert.equal((await value(save, [project, 2, withTimeline(v1, null), 'tl-key-3', null])).idempotent, true);
    });
    await check('the SQL contract bounds the shape: no timeline key, a v1 with one, an old timeline version, too many clips, an unknown key, a bad aspect', async () => {
        const bad = [
            { ...v1, schema_version: 2 },
            { ...v1, timeline: null },
            withTimeline(v1, { ...timeline(), schemaVersion: 1 }),
            withTimeline(v1, { ...timeline(), video: new Array(11).fill(timeline().video[0]) }),
            withTimeline(v1, { ...timeline(), extra: 1 }),
            withTimeline(v1, { ...timeline(), aspect: '4:3' }),
            withTimeline(v1, { ...timeline(), fps: 25 }),
            withTimeline(v1, { ...timeline(), media: Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`m${i}`, vid(`m${i}`, 1)])) }),
            withTimeline(v1, 'not an object'),
            { ...v2, schema_version: 3 },
        ];
        for (const doc of bad) await rejects(save, [project, 3, doc, randomUUID(), null], 'PT400');
    });
    await check('direct saves reject missing required fields without adding history or audit rows', async () => {
        const missingVersion = { ...v1 }; delete missingVersion.schema_version;
        const bad = [missingVersion, { ...v1, schema_version: null }];
        for (const key of ['schemaVersion', 'fps', 'seq', 'aspect', 'media', 'video', 'audio', 'text']) {
            const incomplete = timeline(); delete incomplete[key];
            bad.push(withTimeline(v1, incomplete));
        }
        for (const [key, invalid] of [['seq', 'bad'], ['media', []], ['video', {}], ['audio', null], ['text', 1]]) {
            bad.push(withTimeline(v1, { ...timeline(), [key]: invalid }));
        }
        const beforeHistory = await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1', [project]);
        await db.query('RESET ROLE');
        const beforeAudit = await value('SELECT count(*) FROM public.audit_events WHERE resource_id=$1', [project]);
        for (const doc of bad.filter(doc => doc.schema_version === 2)) {
            assert.equal(await value('SELECT private.project_timeline_within_bounds($1)', [doc.timeline]), false);
        }
        await actor(owner);
        for (const doc of bad) await rejects(save, [project, 3, doc, randomUUID(), null], 'PT400');
        assert.equal(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1', [project]), beforeHistory);
        await db.query('RESET ROLE');
        assert.equal(await value('SELECT count(*) FROM public.audit_events WHERE resource_id=$1', [project]), beforeAudit);
        await actor(owner);
    });
    await check('restore of a v2 revision appends a new version carrying the timeline', async () => {
        const r = await value(save, [project, 3, null, 'tl-restore', 2]);
        assert.equal(r.revision, 4); assert.equal(r.restored_from, 2);
        assert.deepEqual(r.document.timeline, v2.timeline);
    });
    await check('the function body still carries the 0254 write caps', async () => {
        await db.query('RESET ROLE');
        const src = await value("SELECT pg_get_functiondef('private.save_project_document(uuid,integer,jsonb,text,integer)'::regprocedure)");
        for (const needle of ['project_revisions', 'daily_document_saves', 'LIMIT_REACHED', 'project_timeline_within_bounds']) assert.ok(src.includes(needle), needle);
    });
    await check('the bounds helper is callable by nobody from the API', async () => {
        for (const role of ['anon', 'authenticated', 'service_role']) {
            assert.equal(await value("SELECT has_function_privilege($1, 'private.project_timeline_within_bounds(jsonb)', 'EXECUTE')", [role]), false, role);
        }
    });
    console.log(`\n${passed} checks passed`);
} finally {
    await db.query('ROLLBACK').catch(() => {});
    await db.end();
}
