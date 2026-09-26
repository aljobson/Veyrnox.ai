#!/usr/bin/env node
// Project media quarantine and inspection (0141, ADR-0056).
// Destructive fixtures are confined to a throwaway local test database.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const connectionString = process.env.DATABASE_URL;
const url = new URL(connectionString);
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) throw Error('Local test database required');
const db = new pg.Client({connectionString}); await db.connect();
const query = (sql,args=[])=>db.query(sql,args);
const value = async(sql,args=[])=>Object.values((await query(sql,args)).rows[0])[0];
const rows = async(sql,args=[])=>(await query(sql,args)).rows;
const actor = async(id)=>{
  await query('RESET ROLE');
  await query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id||'']);
  await query('SET LOCAL ROLE authenticated');
};
const asService = async()=>{ await query('RESET ROLE'); await query('SET LOCAL ROLE service_role'); };
// FORCE ROW LEVEL SECURITY applies to the table owner too, and a local
// service_role has no BYPASSRLS the way Supabase's does. Privileged reads and
// direct-write probes therefore run unrestricted, which is also the only way a
// blocked UPDATE raises the trigger's error instead of quietly matching no rows.
const asSuper = async()=>{ await query('RESET ROLE'); };
const rejects = async(sql,args,code)=>{
  await query('SAVEPOINT denied');
  try { await assert.rejects(query(sql,args),e=>e.code===code,`expected ${code}`); }
  finally { await query('ROLLBACK TO SAVEPOINT denied'); }
};
const reserve = 'SELECT public.reserve_project_asset($1,$2,$3,$4)';
const inspect = 'SELECT public.record_project_asset_inspection($1,$2,$3,$4,$5,$6,$7)';
let count=0;
const check=async(name,fn)=>{await fn();console.log(`ok ${++count} - ${name}`);};
const owner=randomUUID(),editor=randomUUID(),viewer=randomUUID(),billing=randomUUID(),stranger=randomUUID();
let project,org,workspace;
try {
  await query('BEGIN');
  await query('GRANT USAGE ON SCHEMA auth TO authenticated');
  for(const id of [owner,editor,viewer,billing,stranger])
    await query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id,`asset-${id}@example.invalid`]);
  workspace=await value('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1',[owner]);
  org=await value('SELECT organisation_id FROM public.workspaces WHERE id=$1',[workspace]);
  await query("INSERT INTO public.organisation_members VALUES($1,$2,'EDITOR'),($1,$3,'VIEWER'),($1,$4,'BILLING')",[org,editor,viewer,billing]);
  await actor(owner);
  project=(await value('SELECT public.create_project($1,$2,$3)',[workspace,'Asset test','create-asset-test'])).project.id;

  await check('reserve is atomic with its audit event, and replays idempotently',async()=>{
    const first=await value(reserve,[project,'video/mp4',5_000_000,'asset-key-1']);
    assert.equal(first.state,'quarantined');
    assert.equal(first.idempotent,false);
    const again=await value(reserve,[project,'video/mp4',5_000_000,'asset-key-1']);
    assert.equal(again.idempotent,true);
    assert.equal(again.asset_id,first.asset_id);
    assert.equal(Number(await value('SELECT count(*) FROM public.project_assets WHERE project_id=$1',[project])),1);
    assert.equal(Number(await value("SELECT count(*) FROM public.audit_events WHERE resource_id=$1 AND action='PROJECT_ASSET_RESERVED'",[project])),1);
    // Same key, different claim, is a conflict rather than a second asset.
    await rejects(reserve,[project,'image/png',5_000_000,'asset-key-1'],'PT409');
  });

  await check('the key is opaque, server-derived and carries no client input',async()=>{
    const r=await value(reserve,[project,'image/png',1234,'asset-key-shape']);
    assert.equal(r.r2_key,`org/${org}/project/${project}/asset/${r.asset_id}/v1.png`);
    // Nothing the caller supplied appears in it: not the media type verbatim,
    // not the idempotency key, not a filename.
    assert.ok(!r.r2_key.includes('asset-key-shape'));
    assert.ok(!r.r2_key.includes('image/png'));
  });

  await check('the allowlist and per-type ceiling are enforced in the database, not only the app',async()=>{
    await rejects(reserve,[project,'application/zip',100,'asset-key-zip'],'PT400');
    await rejects(reserve,[project,'text/html',100,'asset-key-html'],'PT400');
    // 20 MiB cap for images, 100 MiB for video.
    await rejects(reserve,[project,'image/png',20*1024*1024+1,'asset-key-big'],'PT400');
    await rejects(reserve,[project,'video/mp4',104857601,'asset-key-huge'],'PT400');
    await rejects(reserve,[project,'video/mp4',0,'asset-key-zero'],'PT400');
    await rejects(reserve,[project,'video/mp4',100,'short'],'PT400');
  });

  await check('only writing roles may reserve; viewers, billing and strangers cannot',async()=>{
    for(const who of [viewer,billing,stranger]){
      await actor(who);
      await rejects(reserve,[project,'image/png',100,`asset-key-${who.slice(0,8)}`],'PT404');
    }
    await actor(editor);
    const r=await value(reserve,[project,'image/png',100,'asset-key-editor']);
    assert.equal(r.state,'quarantined');
    await actor(owner);
  });

  await check('a client cannot settle its own asset: inspection is service_role only',async()=>{
    const r=await value(reserve,[project,'video/mp4',2048,'asset-key-verdict']);
    await actor(owner);
    await rejects(inspect,[r.asset_id,'video/mp4',2048,1000,640,480,null],'42501');
    // And the row is untouched.
    await asSuper();
    assert.equal(await value('SELECT state FROM public.project_assets WHERE id=$1',[r.asset_id]),'quarantined');
  });

  await check('the server settles an asset once, and the verdict is final',async()=>{
    await actor(owner);
    const r=await value(reserve,[project,'video/mp4',4096,'asset-key-settle']);
    await asService();
    const pass=await value(inspect,[r.asset_id,'video/mp4',4096,2000,1280,720,null]);
    assert.equal(pass.state,'inspected');
    assert.equal(pass.idempotent,false);
    // Replaying the identical verdict is a no-op, not a second audit event.
    const replay=await value(inspect,[r.asset_id,'video/mp4',4096,2000,1280,720,null]);
    assert.equal(replay.idempotent,true);
    // A different verdict cannot overwrite it.
    await rejects(inspect,[r.asset_id,null,null,null,null,null,'malware_found'],'PT409');
    await asSuper();
    assert.equal(Number(await value("SELECT count(*) FROM public.audit_events WHERE resource_id=$1 AND action='PROJECT_ASSET_INSPECTED'",[project])),1);
    assert.equal(await value('SELECT state FROM public.project_assets WHERE id=$1',[r.asset_id]),'inspected');
  });

  await check('a rejection records why, and needs exactly one of a type or a reason',async()=>{
    await actor(owner);
    const r=await value(reserve,[project,'image/png',99,'asset-key-reject']);
    await asService();
    // Neither, or both, is a malformed verdict.
    await rejects(inspect,[r.asset_id,null,null,null,null,null,null],'PT400');
    await rejects(inspect,[r.asset_id,'image/png',99,null,null,null,'type_mismatch'],'PT400');
    const bad=await value(inspect,[r.asset_id,null,null,null,null,null,'type_mismatch']);
    assert.equal(bad.state,'rejected');
    assert.equal(bad.reject_reason,'type_mismatch');
    await asSuper();
    assert.equal(Number(await value("SELECT count(*) FROM public.audit_events WHERE resource_id=$1 AND action='PROJECT_ASSET_REJECTED'",[project])),1);
  });

  await check('the origin is immutable and the state machine is one-way, even for service_role',async()=>{
    await actor(owner);
    const r=await value(reserve,[project,'video/mp4',7000,'asset-key-immutable']);
    await asSuper();
    await rejects('DELETE FROM public.project_assets WHERE id=$1',[r.asset_id],'42501');
    await rejects('UPDATE public.project_assets SET r2_key=$2 WHERE id=$1',[r.asset_id,`org/${org}/project/${project}/asset/${r.asset_id}/v1.mp4x`],'42501');
    await rejects('UPDATE public.project_assets SET project_id=$2 WHERE id=$1',[r.asset_id,project],'42501');
    await rejects("UPDATE public.project_assets SET state='quarantined' WHERE id=$1",[r.asset_id],'42501');
    // A settled row cannot be reopened.
    await asService();
    await value(inspect,[r.asset_id,'video/mp4',7000,500,320,240,null]);
    await asSuper();
    await rejects("UPDATE public.project_assets SET state='rejected',reject_reason='changed_mind' WHERE id=$1",[r.asset_id],'42501');
  });

  await check('an incomplete verdict cannot be inserted at all',async()=>{
    await asSuper();
    // inspected with no sniffed type, and quarantined carrying a reason, both
    // violate project_assets_verdict_complete.
    await rejects(`INSERT INTO public.project_assets(project_id,r2_key,state,declared_type,declared_bytes,actor_id,request_key,inspected_at)
      VALUES($1,$2,'inspected','video/mp4',10,$3,'direct-insert-1',now())`,
      [project,`org/${org}/project/${project}/asset/${randomUUID()}/v1.mp4`,owner],'23514');
    await rejects(`INSERT INTO public.project_assets(project_id,r2_key,state,declared_type,declared_bytes,actor_id,request_key,reject_reason)
      VALUES($1,$2,'quarantined','video/mp4',10,$3,'direct-insert-2','why')`,
      [project,`org/${org}/project/${project}/asset/${randomUUID()}/v1.mp4`,owner],'23514');
    // And a key that is not the derived shape is refused by the CHECK.
    await rejects(`INSERT INTO public.project_assets(project_id,r2_key,declared_type,declared_bytes,actor_id,request_key)
      VALUES($1,'uploads/whatever.mp4','video/mp4',10,$2,'direct-insert-3')`,[project,owner],'23514');
  });

  await check('reads are project-scoped, and billing cannot see creative media',async()=>{
    await actor(owner);
    const mine=await value(reserve,[project,'image/png',500,'asset-key-read']);
    // A project member who may not write may still read.
    await actor(viewer);
    assert.equal((await rows('SELECT id FROM public.project_assets WHERE id=$1',[mine.asset_id])).length,1);
    // Billing holds organisation membership and still sees nothing.
    await actor(billing);
    assert.equal((await rows('SELECT id FROM public.project_assets WHERE id=$1',[mine.asset_id])).length,0);
    // Another tenant sees nothing at all.
    await actor(stranger);
    assert.equal((await rows('SELECT id FROM public.project_assets WHERE id=$1',[mine.asset_id])).length,0);
    assert.equal((await rows('SELECT id FROM public.project_assets')).length,0);
    await actor(owner);
  });

  await check('the request key is never readable by a client',async()=>{
    await actor(owner);
    await rejects('SELECT request_key FROM public.project_assets WHERE project_id=$1',[project],'42501');
  });

  console.log(`# ${count} checks passed`);
} finally {
  await query('RESET ROLE');
  await query('ROLLBACK');
  await db.end();
}
