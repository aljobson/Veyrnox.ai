// Disposable local Postgres only. No production credentials or fixtures.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url || !['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c=new pg.Client({connectionString:url});await c.connect();
const actors=Array.from({length:3},()=>randomUUID());
const q=async(sql,args=[]) => (await c.query(sql,args)).rows;
const value=async(sql,args=[]) => (await q(sql,args))[0]?.value;
const draft=(patch={})=>({content_type:'SERIES',parent_id:null,position:null,title:'Private story',synopsis:'A new story',language:'en',ai_disclosures:[],...patch});
const save=(actor,key,body=draft(),id=null,revision=0,client=c)=>client.query('SELECT public.save_cinema_draft($1,$2,$3,$4,$5) AS value',[actor,key,id,revision,body]).then(r=>r.rows[0].value);
const list=(actor,parent=null)=>value('SELECT public.list_own_cinema_content($1,$2) AS value',[actor,parent]);
const role=(actor,r)=>q('UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',[actor,r]);
async function race(tasks) { return Promise.all(tasks.map(async task=>{ const peer=new pg.Client({connectionString:url});await peer.connect();try{return await task(peer);}finally{await peer.end();} })); }
try {
  const migration=await readFile(new URL('../packages/db/schema/supabase/0134_cinema_content_drafts.sql',import.meta.url),'utf8');await c.query('BEGIN');await c.query(migration);await c.query(migration);await c.query('ROLLBACK'); // idempotency proof, rolled back so later migrations' function bodies stay in force
  for(const actor of actors) {
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[actor,`${actor}@example.invalid`]);
    await value('SELECT public.create_cinema_profile($1,$2,$3) AS value',[actor,randomUUID(),{username:`d_${actor.replaceAll('-','').slice(0,20)}`,display_name:'Draft author'}]);
  }
  const balances=()=>q('SELECT u.auth_id,b.balance,b.free_balance FROM public.users u JOIN public.credit_balances b ON b.user_id=u.id WHERE u.auth_id=ANY($1::text[]) ORDER BY u.auth_id',[actors]);
  const before=await balances();
  for(const r of ['viewer','administrator','moderator']) { await role(actors[0],r);assert.equal((await save(actors[0],randomUUID())).error,'creator_required');assert.equal((await list(actors[0])).error,'creator_required'); }
  await role(actors[0],'creator');await role(actors[1],'creator');
  assert.equal((await list('invalid')).error,'creator_required');
  assert.equal((await save('invalid',randomUUID())).error,'creator_required');
  const key=randomUUID();const a=await save(actors[0],key);assert.equal(a.revision,1);assert.equal((await save(actors[0],key)).id,a.id);
  assert.equal((await save(actors[0],key,draft({title:'Changed'}))).error,'idempotency_conflict');
  assert.equal((await list(actors[1])).content.length,0);assert.equal((await list(actors[1],a.id)).error,'content_not_found');
  assert.equal((await save(actors[1],randomUUID(),draft(),a.id,1)).error,'content_not_found');
  const season=draft({content_type:'SEASON',parent_id:a.id,position:1});
  assert.equal((await save(actors[1],randomUUID(),season)).error,'content_not_found');
  const b=await save(actors[0],randomUUID(),season);assert.ok(b.id);
  const episode=draft({content_type:'EPISODE',parent_id:b.id,position:1,ai_disclosures:['generated_script']});
  const e=await save(actors[0],randomUUID(),episode);assert.ok(e.id);
  assert.equal((await list(actors[0],b.id)).content[0].id,e.id);
  assert.equal((await save(actors[0],randomUUID(),draft({content_type:'EPISODE',parent_id:a.id,position:2}))).error,'invalid_parent');
  const duplicates=await race([0,1].map(()=>client=>save(actors[0],randomUUID(),{...episode,position:2},null,0,client)));
  assert.equal(duplicates.filter(x=>x.id).length,1);assert.equal(duplicates.filter(x=>x.error==='position_taken').length,1);
  const edits=await race([0,1].map(i=>client=>save(actors[0],randomUUID(),draft({title:`Edit ${i}`}),a.id,1,client)));
  assert.equal(edits.filter(x=>x.revision===2).length,1);assert.equal(edits.filter(x=>x.error==='revision_conflict').length,1);
  const editKey=randomUUID(), edited=draft({title:'Final draft'});
  assert.equal((await save(actors[0],editKey,edited,a.id,2)).revision,3);
  assert.equal((await save(actors[0],editKey,edited,a.id,2)).idempotent,true);
  assert.equal((await save(actors[0],randomUUID(),draft({content_type:'FILM'}),a.id,3)).error,'structure_locked');
  assert.equal((await save(actors[0],randomUUID(),{...episode,position:3},e.id,1)).error,'structure_locked');
  for(const patch of [{creator_id:actors[1]},{lifecycle_status:'PUBLISHED'},{visibility:'PUBLIC'},{stream_video_uid:'fake'},{ai_disclosures:['unknown']},{ai_disclosures:[null]},{ai_disclosures:['cloned_voice','cloned_voice']},{title:' '},{language:'EN'},{content_type:'SEASON',parent_id:a.id,position:null},{content_type:'SEASON',parent_id:a.id,position:'1'}]) assert.equal((await save(actors[0],randomUUID(),draft(patch))).error,'invalid_draft',JSON.stringify(patch));
  for(const status of ['restricted','suspended','banned']) {
    await q('UPDATE public.cinema_memberships SET account_status=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',[actors[0],status]);
    assert.equal((await save(actors[0],key)).error,'account_not_active');assert.equal((await list(actors[0])).error,'account_not_active');
  }
  await q("UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actors[0]]);
  await role(actors[0],'viewer');assert.equal((await save(actors[0],editKey,edited,a.id,2)).error,'creator_required');await role(actors[0],'creator');
  // Bounded sibling lists: seed 100 roots for a separate creator in this disposable DB.
  await q("INSERT INTO public.cinema_content(creator_id,content_type,title,language) SELECT (SELECT id FROM public.users WHERE auth_id=$1),'SHORT','Draft '||n,'en' FROM generate_series(1,100) n",[actors[1]]);
  assert.equal((await save(actors[1],randomUUID())).error,'draft_limit_reached');assert.equal((await list(actors[1])).content.length,100);
  const secured=await q("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('cinema_content','cinema_content_mutations')");assert.equal(secured.length,2);assert.ok(secured.every(x=>x.relrowsecurity&&x.relforcerowsecurity));
  for(const r of ['anon','authenticated','service_role']) {
    for(const sql of ['SELECT * FROM public.cinema_content','TRUNCATE public.cinema_content','SELECT * FROM public.cinema_content_mutations',...(r==='service_role'?[]:["SELECT public.list_own_cinema_content('invalid',null)","SELECT public.save_cinema_draft('invalid',null,null,0,'{}')"])]) {
      await q('BEGIN');await q(`SET LOCAL ROLE ${r}`);await assert.rejects(c.query(sql),e=>e.code==='42501');await q('ROLLBACK');
    }
  }
  // Service callers can only use the narrow RPC, with ownership still checked.
  await q('BEGIN');await q('SET LOCAL ROLE service_role');assert.equal((await list(actors[1],a.id)).error,'content_not_found');await q('ROLLBACK');
  assert.deepEqual(await balances(),before);
  // Auth deletion revokes access immediately, but the support deletion workflow
  // removes the Cinema profile separately (public users retain financial records).
  await q('DELETE FROM auth.users WHERE id=$1',[actors[0]]);
  assert.equal((await list(actors[0])).error,'creator_required');
  assert.equal((await save(actors[0],key)).error,'creator_required');
  await q('DELETE FROM public.cinema_profiles WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',[actors[0]]);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.cinema_content WHERE id=ANY($1::uuid[])',[[a.id,b.id,e.id]]),0);
  console.log('Cinema draft checks passed: hierarchy, isolation, roles/status, replay, concurrent edits/creates, quotas, RLS/grants, deletion and unchanged credits.');
} finally { await c.end(); }
