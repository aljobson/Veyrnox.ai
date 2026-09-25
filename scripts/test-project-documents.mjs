#!/usr/bin/env node
// Destructive fixtures are confined to a throwaway local test database.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { emptyProjectDocument } from '../lib/projectDocument.js';
const connectionString = process.env.DATABASE_URL;
const url = new URL(connectionString);
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(url.pathname)) throw Error('Local test database required');
const db = new pg.Client({connectionString}); await db.connect();
const query = (sql,args=[])=>db.query(sql,args);
const value = async(sql,args=[])=>Object.values((await query(sql,args)).rows[0])[0];
const actor = async(id,client=db)=>{
  await client.query('RESET ROLE');
  await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[id||'']);
  await client.query('SET LOCAL ROLE authenticated');
};
const rejects = async(sql,args,code)=>{
  await query('SAVEPOINT denied');
  try { await assert.rejects(query(sql,args),e=>e.code===code); }
  finally { await query('ROLLBACK TO SAVEPOINT denied'); }
};
const rpc='SELECT public.save_project_document($1,$2,$3,$4,$5)';
let count=0;
const check=async(name,fn)=>{await fn();console.log(`ok ${++count} - ${name}`);};
const owner=randomUUID(),other=randomUUID(),editor=randomUUID(),viewer=randomUUID();
let project,org,doc;
try {
  await query('BEGIN');
  await query('GRANT USAGE ON SCHEMA auth TO authenticated');
  for(const id of [owner,other,editor,viewer]) await query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[id,`doc-${id}@example.invalid`]);
  const workspace=await value('SELECT w.id FROM public.workspaces w JOIN public.organisations o ON o.id=w.organisation_id WHERE o.owner_id=$1',[owner]);
  org=await value('SELECT organisation_id FROM public.workspaces WHERE id=$1',[workspace]);
  await query("INSERT INTO public.organisation_members VALUES($1,$2,'EDITOR'),($1,$3,'VIEWER')",[org,editor,viewer]);
  await actor(owner);
  project=(await value('SELECT public.create_project($1,$2,$3)',[workspace,'Document test','create-doc-test'])).project.id;
  doc=emptyProjectDocument(project); doc.brief='First brief';
  await check('first save and audit are atomic; replay creates no duplicate',async()=>{
    let r=await value(rpc,[project,0,doc,'document-key-1',null]);assert.equal(r.revision,1);
    r=await value(rpc,[project,0,doc,'document-key-1',null]);assert.equal(r.idempotent,true);
    assert.equal(Number(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),1);
    assert.equal(Number(await value("SELECT count(*) FROM public.audit_events WHERE resource_id=$1 AND action='PROJECT_DOCUMENT_SAVED'",[project])),1);
    await rejects(rpc,[project,0,{...doc,brief:'Different'},'document-key-1',null],'PT409');
  });
  await check('canonical schema, identity and direct write protections',async()=>{
    for(const bad of [{...doc,project_id:other},{...doc,extra:true},{...doc,canvas:{...doc.canvas,frame_rate:23}},{...doc,brief:'x'.repeat(6001)}, {...doc,canvas:{aspect_ratio:'1:1'}}, {...doc,schema_version:2}])
      await rejects(rpc,[project,1,bad,randomUUID(),null],'PT400');
    await rejects('UPDATE public.project_document_versions SET document=$1 WHERE project_id=$2',[doc,project],'42501');
    await rejects('SELECT request_key FROM public.project_document_versions WHERE project_id=$1',[project],'42501');
    await query('RESET ROLE');
    await rejects('DELETE FROM public.project_document_versions WHERE project_id=$1',[project],'42501');
    await actor(owner);
  });
  await check('cross-tenant and viewer write denial; viewer read allowed',async()=>{
    await actor(other);
    assert.equal(Number(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),0);
    await rejects(rpc,[project,1,doc,'stranger-save',null],'PT404');
    await actor(viewer);
    assert.equal(Number(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),1);
    await rejects(rpc,[project,1,doc,'viewer-save',null],'PT404');
  });
  await check('editor can save; stale edits fail; restore appends without replacing history',async()=>{
    await actor(editor);
    const changed={...doc,brief:'Second brief'};
    assert.equal((await value(rpc,[project,1,changed,'editor-save',null])).revision,2);
    await rejects(rpc,[project,1,doc,'stale-save',null],'PT409');
    const restored=await value(rpc,[project,2,null,'restore-save',1]);
    assert.equal(restored.revision,3);assert.equal(restored.document.brief,'First brief');assert.equal(restored.restored_from,1);
    assert.equal((await value(rpc,[project,2,null,'restore-save',1])).idempotent,true);
    await rejects(rpc,[project,2,null,'restore-save',2],'PT409');
    await rejects(rpc,[project,3,null,'missing-restore',99],'PT404');
    assert.equal(await value('SELECT document->>\'brief\' FROM public.project_document_versions WHERE project_id=$1 AND revision=2',[project]),'Second brief');
  });
  await check('revocation denies reads and idempotent replay immediately',async()=>{
    await query('RESET ROLE');await query('DELETE FROM public.organisation_members WHERE organisation_id=$1 AND user_id=$2',[org,editor]);
    await actor(editor);
    assert.equal(Number(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),0);
    await rejects(rpc,[project,2,null,'restore-save',1],'PT404');
  });
  await query('RESET ROLE');
  await query("INSERT INTO public.organisation_members VALUES($1,$2,'EDITOR')",[org,editor]);
  await query('COMMIT');
  await check('two concurrent saves of the same revision cannot overwrite each other',async()=>{
    const clients=[new pg.Client({connectionString}),new pg.Client({connectionString})];
    try {
      await Promise.all(clients.map(c=>c.connect()));
      const results=await Promise.all(clients.map(async(c,i)=>{
        await c.query('BEGIN');await actor(i===0?owner:editor,c);
        try {const r=await c.query(rpc,[project,3,{...doc,brief:`Concurrent ${i}`},`concurrent-${i}`,null]);await c.query('COMMIT');return r.rows[0].save_project_document.revision;}
        catch(e){await c.query('ROLLBACK');return e.code;}
      }));
      assert.deepEqual(results.sort(),[4,'PT409']);
    } finally {await Promise.all(clients.map(c=>c.end()));}
  });
  await query('BEGIN');await actor(owner);
  await check('document writes share the actor rate limit without partial history',async()=>{
    await query('SAVEPOINT rate_window');
    await query('RESET ROLE');
    await query("INSERT INTO public.audit_events(request_id,actor_id,organisation_id,action,resource_id) SELECT gen_random_uuid(),$1,$2,'PROJECT_DOCUMENT_SAVED',$3 FROM generate_series(1,30)",[owner,org,project]);
    await actor(owner);
    await rejects(rpc,[project,4,doc,'rate-denied-save',null],'PT429');
    assert.equal(Number(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),4);
    await query('ROLLBACK TO SAVEPOINT rate_window');
  });
  await check('project deletion hides all history and blocks further saves',async()=>{
    await value('SELECT public.mutate_project($1,1,NULL,true)',[project]);
    assert.equal(Number(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),0);
    await rejects(rpc,[project,4,doc,'deleted-save',null],'PT404');
  });
  await check('historical document attribution does not block Auth deletion',async()=>{
    await query('RESET ROLE');await query('DELETE FROM auth.users WHERE id=$1',[owner]);
    assert.equal(Number(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),4);
    await actor(owner);
    assert.equal(Number(await value('SELECT count(*) FROM public.project_document_versions WHERE project_id=$1',[project])),0);
  });
  await query('RESET ROLE');await query('COMMIT');
  console.log(`${count} project document integration checks passed`);
} finally {await query('ROLLBACK').catch(()=>{});await db.end();}
