#!/usr/bin/env node
// The caps 0248 puts on the tenant write functions a signed-in user can call
// directly with the publishable key (audit 2026-10-09, P-05). Fixtures are
// seeded as a privileged writer to reach each cap without 1,000 round trips,
// then the wrapper is called as the user. Throwaway LOCAL database only;
// everything is rolled back.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyProjectDocument } from '../lib/projectDocument.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
    throw new Error('Tenant cap tests refuse remote databases and non-test database names');
}
const db = new pg.Client({ connectionString });
await db.connect();
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok ${passed} - ${name}`); };
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
const actor = async (id) => {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [id || '']);
    await db.query('SET LOCAL ROLE authenticated');
};
const admin = () => db.query('RESET ROLE');
const rejects = async (sql, args, code, detail) => {
    await db.query('SAVEPOINT rejection');
    try {
        await assert.rejects(db.query(sql, args), (error) => error.code === code && (detail === undefined || error.detail === detail), `${code} ${detail || ''}`);
    } finally { await db.query('ROLLBACK TO SAVEPOINT rejection'); }
};
const save = 'SELECT public.save_project_document($1,$2,$3,$4,$5)';

try {
    await db.query('BEGIN');
    await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');
    const owner = randomUUID();
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [owner, `caps-${owner}@example.invalid`]);
    const workspace = await scalar('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1', [owner]);
    const org = await scalar('SELECT organisation_id FROM public.workspaces WHERE id=$1', [workspace]);

    await check('a workspace holds at most 200 live projects; a removed one frees its slot', async () => {
        await admin();
        // 199 seeded directly, the 200th through the wrapper, the 201st refused.
        await db.query(
            'INSERT INTO public.projects(workspace_id, owner_id, name) SELECT $1, $2, $3 || g FROM generate_series(1, 199) g',
            [workspace, owner, 'Seeded project '],
        );
        await actor(owner);
        const two = await scalar('SELECT public.create_project($1,$2,$3)', [workspace, 'Project 200', 'caps-create-200']);
        assert.equal(two.idempotent, false);
        await rejects('SELECT public.create_project($1,$2,$3)', [workspace, 'Project 201', 'caps-create-201'], 'PT429', 'workspace_projects');
        // A replay of the 200th still answers idempotently: the cap sits after the replay probe.
        const again = await scalar('SELECT public.create_project($1,$2,$3)', [workspace, 'Project 200', 'caps-create-200']);
        assert.equal(again.idempotent, true);
        // Removing one makes room for exactly one more.
        await scalar('SELECT public.mutate_project($1,$2,$3,$4)', [two.project.id, two.project.version, null, true]);
        const next = await scalar('SELECT public.create_project($1,$2,$3)', [workspace, 'Project 201', 'caps-create-201b']);
        assert.equal(next.idempotent, false);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.projects WHERE workspace_id=$1 AND deleted_at IS NULL', [workspace])), 200);
    });

    await check('a project holds at most 1,000 document revisions', async () => {
        await admin();
        const project = await scalar('INSERT INTO public.projects(workspace_id, owner_id, name) VALUES($1,$2,$3) RETURNING id', [workspace, owner, 'Revisions']);
        const doc = emptyProjectDocument(project);
        // 999 seeded directly; the 1,000th saves through the wrapper; the 1,001st is refused.
        await db.query(
            `INSERT INTO public.project_document_versions(project_id, revision, document, actor_id, restored_from, expected_revision, request_key)
             SELECT $1, g, $2::jsonb, $3, NULL, g - 1, 'seed-revision-' || g FROM generate_series(1, 999) g`,
            [project, JSON.stringify(doc), owner],
        );
        await actor(owner);
        const r = await scalar(save, [project, 999, { ...doc, brief: 'Revision 1000' }, 'caps-save-1000', null]);
        assert.equal(r.revision, 1000);
        await rejects(save, [project, 1000, { ...doc, brief: 'Revision 1001' }, 'caps-save-1001', null], 'PT429', 'project_revisions');
        // A restore is a revision too, so it is refused at the cap as well.
        await rejects(save, [project, 1000, null, 'caps-restore-1001', 5], 'PT429', 'project_revisions');
        // The replay of the 1,000th still answers idempotently.
        const again = await scalar(save, [project, 999, { ...doc, brief: 'Revision 1000' }, 'caps-save-1000', null]);
        assert.equal(again.idempotent, true);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1', [project])), 1000);
    });

    await check('an actor saves at most 2,000 document revisions in a rolling day, across projects', async () => {
        await admin();
        const project = await scalar('INSERT INTO public.projects(workspace_id, owner_id, name) VALUES($1,$2,$3) RETURNING id', [workspace, owner, 'Daily']);
        const doc = emptyProjectDocument(project);
        // Seed saves in the last day but not the last minute (the per-minute
        // rate limit is test-tenant-foundation's business): 1,998 from today,
        // plus one older than a day and one other action, which must not count.
        const seed = (n, action, age) => db.query(
            `INSERT INTO public.audit_events(request_id, actor_id, organisation_id, action, resource_id, created_at)
             SELECT gen_random_uuid(), $1, $2, $4, $3, now() - $5::interval - (g || ' seconds')::interval
             FROM generate_series(1, $6::int) g`,
            [owner, org, project, action, age, n],
        );
        await seed(1998, 'PROJECT_DOCUMENT_SAVED', '2 hours');
        await seed(1, 'PROJECT_DOCUMENT_SAVED', '25 hours');
        await seed(1, 'PROJECT_CREATED', '2 hours');
        await actor(owner);
        // 1,998 count, so the 1,999th save of the day goes through (the audit
        // row it writes is the 1,999th).
        const r = await scalar(save, [project, 0, { ...doc, brief: 'Save 1999' }, 'caps-daily-1999', null]);
        assert.equal(r.revision, 1);
        // One more seeded row makes 2,000 in the day: the next save is refused.
        await admin();
        await seed(1, 'PROJECT_DOCUMENT_RESTORED', '3 hours');
        await actor(owner);
        await rejects(save, [project, 1, { ...doc, brief: 'Save 2001' }, 'caps-daily-2001', null], 'PT429', 'daily_document_saves');
        // The replay of an earlier save still answers idempotently at the cap.
        const again = await scalar(save, [project, 0, { ...doc, brief: 'Save 1999' }, 'caps-daily-1999', null]);
        assert.equal(again.idempotent, true);
    });

    await check('the per-actor day index exists for the daily count', async () => {
        await admin();
        assert.equal(Number(await scalar("SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND indexname='audit_events_actor_time'")), 1);
    });
} finally {
    await db.query('ROLLBACK');
    await db.end();
}
console.log(`${passed} tenant write cap checks passed (fixtures rolled back)`);
