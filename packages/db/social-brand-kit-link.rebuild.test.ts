// Run against a disposable localhost DB built with migrate.mjs plus the Supabase
// migrations (replay-migrations.mjs). No shared or production database is accepted.
import { after, before, beforeEach, afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('Publish brand kit link and schema v2 (0441/0442)', { skip: !process.env.DATABASE_URL }, () => {
  let db: pg.Client;
  const value = async (sql: string, args: unknown[] = []) => (await db.query(sql, args)).rows[0].value;
  const link = (auth: string, brand: string, workspace: string | null) => value('SELECT public.set_social_brand_kit_link($1,$2,$3) value', [auth, brand, workspace]);
  const read = (auth: string, brand: string) => value('SELECT public.get_social_brand_kit($1,$2) value', [auth, brand]);
  const kit = () => ({ schemaVersion: 2, name: 'Brand', palette: ['#123456'], fonts: ['Arial'], textStyles: [], assets: [], voice: 'Warm and clear', hashtags: ['brand'], logo: null });
  before(async () => {
    const target = new URL(process.env.DATABASE_URL!);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) && !target.search);
    assert.match(target.pathname, /^\/(rebuild_check|[a-z0-9_]+_test)$/);
    db = new pg.Client({ connectionString: target.href }); await db.connect();
    for (const file of ['0441_social_brand_kit_link.sql', '0442_editor_brand_kit_v2.sql']) {
      const sql = await readFile(new URL(`./schema/supabase/${file}`, import.meta.url), 'utf8');
      await db.query(sql); await db.query(sql);
    }
  });
  beforeEach(async () => { await db.query('BEGIN'); await db.query('GRANT USAGE ON SCHEMA auth TO authenticated'); });
  afterEach(async () => { await db.query('ROLLBACK'); });
  after(async () => { if (db) await db.end(); });
  async function user() {
    const auth = randomUUID(), email = `brand-kit-${auth}@example.invalid`;
    await db.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())', [auth, email]);
    const id = await value('SELECT public.provision_user($1,$2) value', [auth, email]);
    await db.query('SELECT private.provision_personal_tenant($1)', [auth]);
    const workspace = await value('SELECT w.id value FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1', [auth]);
    const org = await value('SELECT organisation_id value FROM public.workspaces WHERE id=$1', [workspace]);
    const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [auth])).brand_id;
    return { auth, id, workspace, org, brand };
  }
  async function assetFor(person: Awaited<ReturnType<typeof user>>, type: string) {
    await asTenant(person.auth);
    const project = (await value('SELECT public.create_project($1,$2,$3) value', [person.workspace, 'Logo', randomUUID()])).project.id;
    await db.query('RESET ROLE');
    const id = randomUUID();
    await db.query(`INSERT INTO public.project_assets(id,project_id,r2_key,state,declared_type,declared_bytes,sniffed_type,byte_size,actor_id,request_key,inspected_at)
      VALUES($1,$2,$3,'inspected',$4,100,$4,100,$5,$6,now())`, [id, project, `org/${person.org}/project/${project}/asset/${id}/v1.png`, type, person.auth, randomUUID()]);
    return { projectId: project, assetId: id, name: 'Logo', credit: '', usage: '', url: '' };
  }
  async function asTenant(auth: string) {
    await db.query('RESET ROLE');
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [auth]);
    await db.query('SET LOCAL ROLE authenticated');
  }
  async function rejected(sql: string, args: unknown[], code: string) {
    await db.query('SAVEPOINT rejection');
    try { await assert.rejects(db.query(sql, args), (e: { code: string }) => e.code === code); }
    finally { await db.query('ROLLBACK TO SAVEPOINT rejection'); }
  }
  it('owner links own editable workspace, repeats safely, refuses foreign workspace and unlinks', async () => {
    const owner = await user(), stranger = await user();
    assert.equal((await link(owner.auth, owner.brand, stranger.workspace)).code, 'WORKSPACE_NOT_FOUND');
    for (let n = 0; n < 2; n++) assert.deepEqual(await link(owner.auth, owner.brand, owner.workspace), { ok: true, linked: true });
    assert.equal(await value('SELECT count(*)::int value FROM public.social_brand_kit_links WHERE brand_id=$1', [owner.brand]), 1);
    assert.equal((await read(owner.auth, owner.brand)).empty, true);
    for (let n = 0; n < 2; n++) assert.deepEqual(await link(owner.auth, owner.brand, null), { ok: true, linked: false });
    assert.equal((await read(owner.auth, owner.brand)).linked, false);
  });
  it('brand members read only presentation data and cannot change the link', async () => {
    const owner = await user(), member = await user();
    await db.query("INSERT INTO public.social_brand_members(brand_id,user_id,role,invited_by) VALUES($1,$2,'viewer',$3)", [owner.brand, member.id, owner.id]);
    const asset = { projectId: randomUUID(), assetId: randomUUID(), name: 'Logo', credit: 'Creator', usage: 'Licensed', url: 'https://example.com/licence' };
    await db.query('INSERT INTO public.workspace_editor_brand_kits(workspace_id,version,kit,actor_id) VALUES($1,1,$2,$3)', [owner.workspace, { ...kit(), assets: [asset], logo: { projectId: asset.projectId, assetId: asset.assetId } }, owner.auth]);
    await link(owner.auth, owner.brand, owner.workspace);
    const data = await read(member.auth, owner.brand);
    assert.equal(data.kit.hasLogo, true); assert.equal(data.kit.voice, 'Warm and clear'); assert.deepEqual(data.kit.hashtags, ['brand']);
    assert.doesNotMatch(JSON.stringify(data), /workspaceId|workspaceName|projectId|assetId/);
    const ownerKit = await read(owner.auth, owner.brand);
    assert.equal(ownerKit.workspaceId, owner.workspace);
    assert.equal(typeof ownerKit.workspaceName, 'string');
    assert.equal((await link(member.auth, owner.brand, null)).code, 'FORBIDDEN');
    await db.query('DELETE FROM public.workspace_editor_brand_kits WHERE workspace_id=$1', [owner.workspace]);
    const empty = await read(member.auth, owner.brand);
    assert.equal(empty.empty, true);
    assert.doesNotMatch(JSON.stringify(empty), /workspaceId|workspaceName|projectId|assetId/);
  });
  it('revokes presentation access when the linking authority loses edit access', async () => {
    const owner = await user(), workspaceOwner = await user();
    await db.query("INSERT INTO public.organisation_members VALUES($1,$2,'VIEWER')", [workspaceOwner.org, owner.auth]);
    await db.query("INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES($1,$2,'EDITOR')", [workspaceOwner.workspace, owner.auth]);
    await link(owner.auth, owner.brand, workspaceOwner.workspace);
    assert.equal((await read(owner.auth, owner.brand)).linked, true);
    for (const role of ['VIEWER', 'REVIEWER']) {
      await db.query('UPDATE public.workspace_members SET role=$1 WHERE workspace_id=$2 AND user_id=$3', [role, workspaceOwner.workspace, owner.auth]);
      const data = await read(owner.auth, owner.brand);
      assert.deepEqual(data, { ok: true, linked: false, stale: true, canLink: true });
    }
    await db.query("UPDATE public.workspace_members SET role='EDITOR' WHERE workspace_id=$1 AND user_id=$2", [workspaceOwner.workspace, owner.auth]);
    await db.query('DELETE FROM public.workspace_members WHERE workspace_id=$1 AND user_id=$2', [workspaceOwner.workspace, owner.auth]);
    assert.equal((await read(owner.auth, owner.brand)).stale, true);
    await db.query("INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES($1,$2,'EDITOR')", [workspaceOwner.workspace, owner.auth]);
    await db.query('DELETE FROM public.organisation_members WHERE organisation_id=$1 AND user_id=$2', [workspaceOwner.org, owner.auth]);
    assert.equal((await read(owner.auth, owner.brand)).stale, true);
  });
  it('deleted workspace or organisation returns no workspace data', async () => {
    const owner = await user(); await link(owner.auth, owner.brand, owner.workspace);
    await db.query('UPDATE public.workspaces SET deleted_at=now() WHERE id=$1', [owner.workspace]);
    assert.deepEqual(await read(owner.auth, owner.brand), { ok: true, linked: false, stale: true, canLink: true });
    await db.query('UPDATE public.workspaces SET deleted_at=NULL WHERE id=$1', [owner.workspace]);
    await db.query('UPDATE public.organisations SET deleted_at=now() WHERE id=$1', [owner.org]);
    assert.deepEqual(await read(owner.auth, owner.brand), { ok: true, linked: false, stale: true, canLink: true });
  });
  it('schema validation matches Unicode tags, bounds and logo membership', async () => {
    const valid = (candidate: object) => value('SELECT private.editor_brand_kit_valid($1) value', [candidate]);
    assert.equal(await valid({ ...kit(), hashtags: ['#日本語', 'café', 'Ⅷ', '𐐀', 'a'.repeat(60)], voice: 'a'.repeat(500) }), true);
    for (const fields of [{ voice: 'x'.repeat(501) }, { voice: 'a\nb' }, { hashtags: ['🙂'] }, { hashtags: ['e\u0301'] }, { hashtags: ['#'] }, { hashtags: ['a'.repeat(61)] }, { hashtags: Array(31).fill('tag') }, { logo: { projectId: randomUUID(), assetId: randomUUID() } }]) assert.equal(await valid({ ...kit(), ...fields }), false);
  });
  it('existing v1 rows read as stored, flagged v2-capable, and are not rewritten', async () => {
    const owner = await user();
    const legacy = { schemaVersion: 1, name: 'Legacy', palette: ['#123456'], fonts: ['Arial'], textStyles: [], assets: [] };
    await db.query('INSERT INTO public.workspace_editor_brand_kits(workspace_id,version,kit,actor_id) VALUES($1,1,$2,$3)', [owner.workspace, legacy, owner.auth]);
    await link(owner.auth, owner.brand, owner.workspace);
    const published = await read(owner.auth, owner.brand);
    assert.equal(published.kit.voice, ''); assert.deepEqual(published.kit.hashtags, []); assert.equal(published.kit.hasLogo, false);
    await asTenant(owner.auth);
    const readKit = await value('SELECT public.read_editor_brand_kit($1) value', [owner.workspace]);
    assert.deepEqual(readKit.kit, legacy); assert.equal(readKit.v2, true);
    assert.equal(await value("SELECT (kit->>'schemaVersion')::int value FROM public.workspace_editor_brand_kits WHERE workspace_id=$1", [owner.workspace]), 1);
  });
  it('tenant save normalizes tags, upgrades v1 reads, preserves idempotency and rejects stale versions', async () => {
    const owner = await user(); await asTenant(owner.auth);
    const legacy = { schemaVersion: 1, name: 'Legacy', palette: ['#123456'], fonts: ['Arial'], textStyles: [], assets: [] };
    const save = (version: number, data: object, key: string) => value('SELECT public.save_editor_brand_kit($1,$2,$3,$4) value', [owner.workspace, version, data, key]);
    const saved = await save(0, legacy, 'brand-legacy-key');
    assert.deepEqual(saved.kit, { ...legacy, schemaVersion: 2, logo: null, voice: '', hashtags: [] });
    assert.equal((await save(0, legacy, 'brand-legacy-key')).idempotent, true);
    assert.deepEqual((await value('SELECT public.read_editor_brand_kit($1) value', [owner.workspace])).kit, saved.kit);
    const next = await save(1, { ...kit(), hashtags: ['#Brand', '日本語'] }, 'brand-v2-save-key');
    assert.deepEqual(next.kit.hashtags, ['Brand', '日本語']);
    await rejected('SELECT public.save_editor_brand_kit($1,1,$2,$3)', [owner.workspace, kit(), 'brand-conflict-key'], 'PT409');
  });
  it('logos require inspected images in this workspace, not video or another workspace', async () => {
    const owner = await user(), other = await user();
    const image = await assetFor(owner, 'image/png'), video = await assetFor(owner, 'video/mp4'), foreign = await assetFor(other, 'image/png');
    await asTenant(owner.auth);
    for (const asset of [video, foreign]) await rejected('SELECT public.save_editor_brand_kit($1,0,$2,$3)', [owner.workspace, { ...kit(), assets: [asset], logo: { projectId: asset.projectId, assetId: asset.assetId } }, randomUUID()], 'PT404');
    const saved = await value('SELECT public.save_editor_brand_kit($1,0,$2,$3) value', [owner.workspace, { ...kit(), assets: [image], logo: { projectId: image.projectId, assetId: image.assetId } }, randomUUID()]);
    assert.equal(saved.kit.logo.assetId, image.assetId);
  });
  it('v1 mobile saves preserve omitted v2 fields, prune a removed logo and honor explicit clearing', async () => {
    const owner = await user(), image = await assetFor(owner, 'image/png');
    await asTenant(owner.auth);
    const logo = { projectId: image.projectId, assetId: image.assetId };
    const save = (version: number, data: object, key = randomUUID()) => value('SELECT public.save_editor_brand_kit($1,$2,$3,$4) value', [owner.workspace, version, data, key]);
    const v2 = { ...kit(), assets: [image], logo, voice: 'Keep this voice', hashtags: ['#Brand', '日本語'] };
    await save(0, v2);
    const legacy = { schemaVersion: 1, name: 'Mobile edit', palette: ['#ffffff'], fonts: ['Arial'], textStyles: [], assets: [image] };
    const saved = await save(1, legacy, 'brand-mobile-save-key');
    assert.equal(saved.version, 2); assert.deepEqual(saved.kit.logo, logo);
    assert.equal(saved.kit.voice, v2.voice); assert.deepEqual(saved.kit.hashtags, ['Brand', '日本語']);
    assert.equal((await save(1, legacy, 'brand-mobile-save-key')).idempotent, true);
    const removed = await save(2, { ...legacy, assets: [] });
    assert.equal(removed.kit.logo, null); assert.equal(removed.kit.voice, v2.voice);
    assert.deepEqual(removed.kit.hashtags, ['Brand', '日本語']);
    const cleared = await save(3, { ...legacy, logo: null, voice: '', hashtags: [] });
    assert.equal(cleared.kit.logo, null); assert.equal(cleared.kit.voice, ''); assert.deepEqual(cleared.kit.hashtags, []);
  });
  it('counts preserved v2 fields toward the SQL size cap', async () => {
    const owner = await user(), image = await assetFor(owner, 'image/png');
    await asTenant(owner.auth);
    const v2 = { ...kit(), voice: 'v'.repeat(500), hashtags: Array.from({ length: 30 }, (_, i) => String(i).padStart(2, '0') + 'x'.repeat(58)) };
    await value('SELECT public.save_editor_brand_kit($1,0,$2,$3) value', [owner.workspace, v2, randomUUID()]);
    const largeAsset = { ...image, name: 'n'.repeat(120), credit: 'c'.repeat(120), usage: 'u'.repeat(240), url: 'https://example.com/' + 'x'.repeat(970) };
    const legacy = { schemaVersion: 1, name: 'Mobile', palette: ['#ffffff'], fonts: ['Arial'], textStyles: [], assets: Array(7).fill(largeAsset) };
    assert.ok(await value('SELECT octet_length($1::jsonb::text) value', [legacy]) < 12288);
    assert.ok(await value('SELECT octet_length($1::jsonb::text) value', [{ ...legacy, voice: v2.voice, hashtags: v2.hashtags }]) > 12288);
    await rejected('SELECT public.save_editor_brand_kit($1,1,$2,$3)', [owner.workspace, legacy, randomUUID()], 'PT400');
    assert.equal((await value('SELECT public.read_editor_brand_kit($1) value', [owner.workspace])).version, 1);
  });
  it('keeps editor validator internal and editor readers/writers authenticated-only', async () => {
    const validator = 'private.editor_brand_kit_valid(jsonb)';
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') value", [role, validator]), false);
    for (const signature of ['private.read_editor_brand_kit(uuid)', 'private.save_editor_brand_kit(uuid,integer,jsonb,text)', 'public.read_editor_brand_kit(uuid)', 'public.save_editor_brand_kit(uuid,integer,jsonb,text)']) {
      assert.equal(await value("SELECT has_function_privilege('authenticated',$1,'EXECUTE') value", [signature]), true);
      for (const role of ['anon', 'service_role']) assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') value", [role, signature]), false);
    }
  });
  it('locks table and Publish functions away from anon/authenticated', async () => {
    const functions = ['public.set_social_brand_kit_link(text,uuid,uuid)', 'public.get_social_brand_kit(text,uuid)', 'private.social_kit_workspace_role(uuid,uuid)'];
    for (const signature of functions) {
      for (const role of ['anon', 'authenticated']) assert.equal(await value("SELECT has_function_privilege($1,$2,'EXECUTE') value", [role, signature]), false);
      assert.equal(await value("SELECT has_function_privilege('service_role',$1,'EXECUTE') value", [signature]), true);
      assert.match(String(await value('SELECT proconfig value FROM pg_proc WHERE oid=$1::regprocedure', [signature])), /search_path=/);
    }
    assert.equal(await value("SELECT relrowsecurity AND relforcerowsecurity value FROM pg_class WHERE oid='public.social_brand_kit_links'::regclass"), true);
    for (const role of ['anon', 'authenticated']) {
      for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) assert.equal(await value("SELECT has_table_privilege($1,'public.social_brand_kit_links',$2) value", [role, privilege]), false);
      await db.query(`SET LOCAL ROLE ${role}`);
      await rejected('SELECT public.get_social_brand_kit($1,$2)', [randomUUID(), randomUUID()], '42501');
      await rejected('SELECT public.set_social_brand_kit_link($1,$2,NULL)', [randomUUID(), randomUUID()], '42501');
      await rejected('SELECT * FROM public.social_brand_kit_links', [], '42501');
      await db.query('RESET ROLE');
    }
  });
});
