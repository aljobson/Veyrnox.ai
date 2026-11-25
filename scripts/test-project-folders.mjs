#!/usr/bin/env node
// Run after replay-migrations on a throwaway LOCAL PostgreSQL only.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL must identify a throwaway local test database');
const url = new URL(connectionString);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) {
    throw new Error('Project-folder tests refuse remote databases and non-test database names');
}

const db = new pg.Client({ connectionString });
await db.connect();
let passed = 0;
const check = async (name, run) => { await run(); passed++; console.log(`ok ${passed} - ${name}`); };
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
const actor = async (id) => {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [id || '']);
    await db.query('SET LOCAL ROLE authenticated');
};
const admin = () => db.query('RESET ROLE');
const rejects = async (sql, args, code) => {
    await db.query('SAVEPOINT expected_rejection');
    try { await assert.rejects(db.query(sql, args), error => error.code === code, `${sql} should reject with ${code}`); }
    finally { await db.query('ROLLBACK TO SAVEPOINT expected_rejection'); }
};

try {
    await db.query('BEGIN');
    await db.query('GRANT USAGE ON SCHEMA auth TO authenticated');
    const owner = randomUUID(), otherOwner = randomUUID(), viewer = randomUUID();
    for (const id of [owner, otherOwner, viewer]) {
        await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [id, `folders-${id}@example.invalid`]);
    }
    const workspace = await scalar('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1', [owner]);
    const otherWorkspace = await scalar('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1', [otherOwner]);
    const org = await scalar('SELECT organisation_id FROM public.workspaces WHERE id=$1', [workspace]);
    await db.query("INSERT INTO public.organisation_members VALUES($1,$2,'VIEWER'),($1,$3,'ADMIN')", [org, viewer, otherOwner]);
    let root, child, grandchild, fourth, otherFolder, project;

    await check('creates a four-level tree and rejects a fifth level', async () => {
        await actor(owner);
        root = (await scalar('SELECT public.create_project_folder($1,NULL,$2,$3)', [workspace, 'Clients', 'folder-root-001'])).folder.id;
        child = (await scalar('SELECT public.create_project_folder($1,$2,$3,$4)', [workspace, root, 'Acme', 'folder-child-001'])).folder.id;
        grandchild = (await scalar('SELECT public.create_project_folder($1,$2,$3,$4)', [workspace, child, 'Campaign', 'folder-grand-001'])).folder.id;
        fourth = (await scalar('SELECT public.create_project_folder($1,$2,$3,$4)', [workspace, grandchild, 'Social', 'folder-fourth-001'])).folder.id;
        await rejects('SELECT public.create_project_folder($1,$2,$3,$4)', [workspace, fourth, 'Too deep', 'folder-fifth-001'], 'PT409');
        assert.equal(Number(await scalar('SELECT count(*) FROM public.project_folders WHERE workspace_id=$1', [workspace])), 4);
    });

    await check('create replay is idempotent and changed payload conflicts', async () => {
        const replay = await scalar('SELECT public.create_project_folder($1,NULL,$2,$3)', [workspace, 'Clients', 'folder-root-001']);
        assert.equal(replay.folder.id, root); assert.equal(replay.idempotent, true);
        await rejects('SELECT public.create_project_folder($1,NULL,$2,$3)', [workspace, 'Changed', 'folder-root-001'], 'PT409');
        await rejects('SELECT public.create_project_folder($1,NULL,$2,$3)', [workspace, 'Clients', 'folder-name-conflict-001'], 'PT409');
    });

    await check('viewer can read folders but cannot create, rename, delete or move', async () => {
        await actor(viewer);
        assert.equal(Number(await scalar('SELECT count(*) FROM public.project_folders WHERE workspace_id=$1', [workspace])), 4);
        await rejects('SELECT public.create_project_folder($1,NULL,$2,$3)', [workspace, 'No', 'folder-viewer-create'], 'PT404');
        await rejects('SELECT public.mutate_project_folder($1,1,$2,false)', [root, 'No'], 'PT404');
        await rejects('SELECT public.mutate_project_folder($1,1,NULL,true)', [root], 'PT404');
        await rejects("INSERT INTO public.project_folders(workspace_id,name) VALUES($1,'No')", [workspace], '42501');
    });

    await check('same-workspace constraints reject a cross-workspace parent', async () => {
        await actor(otherOwner);
        otherFolder = (await scalar('SELECT public.create_project_folder($1,NULL,$2,$3)', [otherWorkspace, 'Other', 'folder-other-001'])).folder.id;
        await actor(owner);
        await rejects('SELECT public.create_project_folder($1,$2,$3,$4)', [workspace, otherFolder, 'Escape', 'folder-cross-parent'], 'PT404');
    });

    await check('moves a project into a folder and back with optimistic conflicts', async () => {
        await actor(owner);
        project = (await scalar('SELECT public.create_project($1,$2,$3)', [workspace, 'Launch reel', 'folder-project-001'])).project.id;
        const moved = await scalar('SELECT public.move_project_to_folder($1,1,$2)', [project, child]);
        assert.equal(moved.folder_id, child); assert.equal(moved.version, 2);
        await rejects('SELECT public.move_project_to_folder($1,1,NULL)', [project], 'PT409');
        const unfiled = await scalar('SELECT public.move_project_to_folder($1,2,NULL)', [project]);
        assert.equal(unfiled.folder_id, null); assert.equal(unfiled.version, 3);
        await rejects('SELECT public.move_project_to_folder($1,3,$2)', [project, otherFolder], 'PT404');
    });

    await check('non-empty deletion is guarded and empty deletion is version-safe', async () => {
        await actor(owner);
        await scalar('SELECT public.move_project_to_folder($1,3,$2)', [project, fourth]);
        await rejects('SELECT public.mutate_project_folder($1,1,NULL,true)', [fourth], 'PT409');
        await scalar('SELECT public.move_project_to_folder($1,4,NULL)', [project]);
        await rejects('SELECT public.mutate_project_folder($1,2,NULL,true)', [fourth], 'PT409');
        const removed = await scalar('SELECT public.mutate_project_folder($1,1,NULL,true)', [fourth]);
        assert.equal(removed.id, fourth);
    });

    await check('folder writes are audited and private idempotency rows stay hidden', async () => {
        await actor(owner);
        const renamed = await scalar('SELECT public.mutate_project_folder($1,1,$2,false)', [grandchild, 'Campaign 2']);
        assert.equal(renamed.version, 2);
        const actions = (await rows("SELECT action FROM public.audit_events WHERE actor_id=$1 AND action LIKE 'PROJECT_FOLDER_%' ORDER BY created_at,id", [owner])).map(row => row.action);
        for (const action of ['PROJECT_FOLDER_CREATED', 'PROJECT_FOLDER_RENAMED', 'PROJECT_FOLDER_DELETED', 'PROJECT_FOLDER_MOVED']) assert.ok(actions.includes(action), action);
        await rejects('SELECT count(*) FROM private.project_folder_requests', [], '42501');
    });

    await check('old idempotency rows are pruned on the next serialized create', async () => {
        await admin();
        await db.query("INSERT INTO private.project_folder_requests(actor_id,request_key,payload,folder_id,created_at) VALUES($1,'folder-old-request',$2,$3,now()-interval '31 days')", [owner, { workspace, parent: null, name: 'Old' }, randomUUID()]);
        await actor(owner);
        await scalar('SELECT public.create_project_folder($1,NULL,$2,$3)', [workspace, 'Archive', 'folder-archive-001']);
        await admin();
        assert.equal(Number(await scalar("SELECT count(*) FROM private.project_folder_requests WHERE request_key='folder-old-request'")), 0);
    });

    await check('per-actor write throttling executes before mutation', async () => {
        await admin();
        const current = Number(await scalar("SELECT count(*) FROM public.audit_events WHERE actor_id=$1 AND created_at>now()-interval '1 minute'", [owner]));
        for (let i=current; i<30; i++) {
            await db.query("INSERT INTO public.audit_events(request_id,actor_id,organisation_id,action,resource_id) VALUES($1,$2,$3,'PROJECT_FOLDER_RENAMED',$4)", [randomUUID(), owner, org, randomUUID()]);
        }
        await actor(owner);
        await rejects('SELECT public.mutate_project_folder($1,2,$2,false)', [grandchild, 'Rate limited'], 'PT429');
        assert.equal(await scalar('SELECT name FROM public.project_folders WHERE id=$1', [grandchild]), 'Campaign 2');
    });

    await check('workspace cap is enforced under the workspace lock', async () => {
        await admin();
        const count = Number(await scalar('SELECT count(*) FROM public.project_folders WHERE workspace_id=$1', [workspace]));
        for (let i=count; i<200; i++) await db.query('INSERT INTO public.project_folders(workspace_id,name) VALUES($1,$2)', [workspace, `Bulk ${i}`]);
        // Use a second administrator so the owner's deliberate throttle fixture cannot mask the cap.
        await actor(otherOwner);
        await rejects('SELECT public.create_project_folder($1,NULL,$2,$3)', [workspace, 'Over cap', 'folder-over-cap-001'], 'PT429');
        assert.equal(Number(await scalar('SELECT count(*) FROM public.project_folders WHERE workspace_id=$1', [workspace])), 200);
    });

    await check('folder tables force RLS and helper functions are not browser-callable', async () => {
        await admin();
        const tableRows = await rows("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('public.project_folders'::regclass,'private.project_folder_requests'::regclass)");
        assert.equal(tableRows.length, 2); assert.ok(tableRows.every(row => row.relrowsecurity && row.relforcerowsecurity));
        for (const fn of ['private.check_project_folder_write_limit(uuid)', 'private.audit_project_folder_change(uuid,uuid,text)', 'private.clear_project_folder_on_delete()']) {
            assert.equal(await scalar("SELECT has_function_privilege('authenticated',$1,'EXECUTE')", [fn]), false, fn);
            assert.equal(await scalar("SELECT has_function_privilege('anon',$1,'EXECUTE')", [fn]), false, fn);
        }
    });
} finally {
    await db.query('ROLLBACK');
    await db.end();
}
console.log(`${passed} project-folder integration checks passed (fixtures rolled back)`);
