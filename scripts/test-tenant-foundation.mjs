#!/usr/bin/env node
// Run after replay-migrations on a throwaway LOCAL PostgreSQL only.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
    throw new Error('Tenant tests refuse remote databases and non-test database names');
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
const rejects = async (sql, args, code) => {
    await db.query('SAVEPOINT rejection');
    try { await assert.rejects(db.query(sql, args), error => error.code === code); }
    finally { await db.query('ROLLBACK TO SAVEPOINT rejection'); }
};
try {
    await db.query('BEGIN');
    // Only the standalone Supabase fixture needs this grant.
    await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');
    const owner = randomUUID(), stranger = randomUUID(), viewer = randomUUID(), editor = randomUUID(), anonymous = randomUUID();
    for (const id of [owner, stranger, viewer, editor]) {
        await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [id, `tenant-${id}@example.invalid`]);
    }
    await db.query('INSERT INTO auth.users(id,email,is_anonymous) VALUES($1,NULL,true)', [anonymous]);
    const workspace = await scalar('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1', [owner]);
    const org = await scalar('SELECT organisation_id FROM public.workspaces WHERE id=$1', [workspace]);
    await db.query("INSERT INTO public.organisation_members VALUES($1,$2,'VIEWER'),($1,$3,'EDITOR')", [org, viewer, editor]);
    let project;
    await check('existing signup provisions one personal organisation and default workspace', async () => {
        assert.ok(workspace);
        await db.query('SELECT private.provision_personal_tenant($1)', [owner]);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.organisations WHERE owner_id=$1', [owner])), 1);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.organisations WHERE owner_id=$1', [anonymous])), 0);
    });
    await check('project creation is attributed to JWT subject and atomically audited', async () => {
        await actor(owner);
        const result = await scalar('SELECT public.create_project($1,$2,$3)', [workspace, 'Private project', 'create-project-1']);
        project = result.project.id;
        assert.equal(result.project.owner_id, owner);
        assert.equal(result.idempotent, false);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.audit_events WHERE resource_id=$1', [project])), 1);
    });
    await check('matching replay returns the same project without another audit or insert', async () => {
        const result = await scalar('SELECT public.create_project($1,$2,$3)', [workspace, 'Private project', 'create-project-1']);
        assert.equal(result.project.id, project);
        assert.equal(result.idempotent, true);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.audit_events WHERE resource_id=$1', [project])), 1);
        await rejects('SELECT public.create_project($1,$2,$3)', [workspace, 'Changed', 'create-project-1'], 'PT409');
    });
    await check('cross-tenant project reads, writes and create selectors cannot escape membership', async () => {
        await actor(stranger);
        assert.equal((await rows('SELECT * FROM public.projects WHERE id=$1', [project])).length, 0);
        assert.equal((await rows('SELECT * FROM public.workspaces WHERE id=$1', [workspace])).length, 0);
        await rejects('SELECT public.mutate_project($1,1,$2,false)', [project, 'Stolen'], 'PT404');
        await rejects('SELECT public.create_project($1,$2,$3)', [workspace, 'Stolen', 'cross-tenant-key'], 'PT404');
    });
    await check('viewer can read but cannot edit, create or elevate membership', async () => {
        await actor(viewer);
        assert.equal((await rows('SELECT * FROM public.projects WHERE id=$1', [project])).length, 1);
        await rejects('SELECT public.mutate_project($1,1,$2,false)', [project, 'Changed'], 'PT404');
        await rejects('SELECT public.create_project($1,$2,$3)', [workspace, 'New', 'viewer-project-key'], 'PT404');
        await rejects("UPDATE public.organisation_members SET role='OWNER' WHERE organisation_id=$1 AND user_id=$2", [org, viewer], '42501');
        assert.equal((await rows('SELECT * FROM public.audit_events')).length, 0);
    });
    await check('editor updates metadata but cannot transfer ownership or delete another owner project', async () => {
        await actor(editor);
        const updated = await scalar('SELECT public.mutate_project($1,1,$2,false)', [project, 'Edited']);
        assert.equal(updated.version, 2);
        assert.equal(updated.owner_id, owner);
        await rejects('UPDATE public.projects SET owner_id=$1 WHERE id=$2', [editor, project], '42501');
        await rejects('SELECT public.mutate_project($1,2,NULL,true)', [project], 'PT403');
        await rejects('SELECT public.mutate_project($1,1,$2,false)', [project, 'Stale'], 'PT409');
    });
    await check('project role can restrict inherited editor access', async () => {
        await admin();
        await db.query("INSERT INTO public.project_members VALUES($1,$2,'VIEWER')", [project, editor]);
        await actor(editor);
        await rejects('SELECT public.mutate_project($1,2,$2,false)', [project, 'Forbidden'], 'PT404');
    });
    await check('removing organisation membership immediately overrides existing project grants', async () => {
        await admin();
        await db.query('DELETE FROM public.organisation_members WHERE organisation_id=$1 AND user_id=$2', [org, editor]);
        await actor(editor);
        assert.equal((await rows('SELECT * FROM public.projects WHERE id=$1', [project])).length, 0);
        await rejects('SELECT public.mutate_project($1,2,$2,false)', [project, 'Forbidden'], 'PT404');
    });
    await check('audit rows cannot be forged or rewritten even by a privileged writer', async () => {
        await actor(owner);
        await rejects("INSERT INTO public.audit_events(request_id,organisation_id,action,resource_id) VALUES($1,$2,'PROJECT_CREATED',$3)", [randomUUID(),org,project], '42501');
        await admin();
        await rejects('DELETE FROM public.audit_events WHERE resource_id=$1', [project], '42501');
        await db.query('SAVEPOINT audited_change');
        await actor(owner);
        await db.query('SELECT public.mutate_project($1,2,$2,false)', [project, 'Rollback me']);
        await db.query('ROLLBACK TO SAVEPOINT audited_change');
        await actor(owner);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.audit_events WHERE resource_id=$1', [project])), 2);
        assert.equal(await scalar('SELECT version FROM public.projects WHERE id=$1', [project]), 2);
    });
    await check('soft deletion hides the project and denies replay resurrection', async () => {
        await actor(owner);
        await db.query('SELECT public.mutate_project($1,2,NULL,true)', [project]);
        assert.equal((await rows('SELECT * FROM public.projects WHERE id=$1', [project])).length, 0);
        await rejects('SELECT public.create_project($1,$2,$3)', [workspace, 'Private project', 'create-project-1'], 'PT404');
    });
    await check('unauthenticated/anonymous roles cannot invoke mutation or provisioning', async () => {
        await actor(null);
        await rejects('SELECT public.create_project($1,$2,$3)', [workspace, 'None', 'anonymous-create'], 'PT401');
        await rejects('SELECT private.provision_personal_tenant($1)', [stranger], '42501');
        await admin();
        await db.query('SET LOCAL ROLE anon');
        await rejects('SELECT public.create_project($1,$2,$3)', [workspace, 'None', 'anonymous-create'], '42501');
    });
    await check('all new tables enforce RLS and private definer functions have an empty search path', async () => {
        await admin();
        const tableRows = await rows("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('public.organisations'::regclass,'public.organisation_members'::regclass,'public.workspaces'::regclass,'public.workspace_members'::regclass,'public.projects'::regclass,'public.project_members'::regclass,'public.audit_events'::regclass,'private.api_requests'::regclass)");
        assert.equal(tableRows.length, 8);
        assert.ok(tableRows.every(t => t.relrowsecurity && t.relforcerowsecurity));
        const functions = await rows("SELECT proname,proconfig FROM pg_proc WHERE pronamespace='private'::regnamespace AND prosecdef");
        assert.ok(functions.every(f => f.proconfig.includes('search_path=""')));
    });
    await check('project creation rate limit is enforced in the database; matching replay still works', async () => {
        await actor(stranger);
        const ownWorkspace = await scalar('SELECT id FROM public.workspaces LIMIT 1');
        for (let i=0; i<30; i++) await db.query('SELECT public.create_project($1,$2,$3)', [ownWorkspace, `Project ${i}`, `rate-project-${i}`]);
        await rejects('SELECT public.create_project($1,$2,$3)', [ownWorkspace, 'Over limit', 'rate-project-over'], 'PT429');
        const replay = await scalar('SELECT public.create_project($1,$2,$3)', [ownWorkspace, 'Project 0', 'rate-project-0']);
        assert.equal(replay.idempotent, true);
    });
} finally {
    await db.query('ROLLBACK');
    await db.end();
}
console.log(`${passed} tenant foundation integration checks passed (fixtures rolled back)`);
