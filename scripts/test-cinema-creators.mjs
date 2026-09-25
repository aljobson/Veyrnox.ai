// Isolated migration replay database only; never uses production credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if (!url || !['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c=new pg.Client({connectionString:url}); await c.connect();
const actors=Array.from({length:6},()=>randomUUID());
const q=async(sql,args=[]) => (await c.query(sql,args)).rows;
const value=async(sql,args=[]) => (await q(sql,args))[0]?.value;
const invoke=(name,args,casts)=>value(`SELECT public.${name}(${casts.map((t,i)=>`$${i+1}::${t}`).join(',')}) AS value`,args);
const apply=(auth,key,text='I create original science fiction short films.')=>invoke('apply_cinema_creator',[auth,key,text],['text','uuid','text']);
const reviewArgs=(actor,app,key,decision='approved',time=Math.floor(Date.now()/1000))=>[actor,'aal2',time,key,app,decision,'Reviewed original work',randomUUID()];
const review=(...args)=>invoke('review_cinema_creator',reviewArgs(...args),['text','text','bigint','uuid','uuid','text','text','uuid']);
async function concurrentReviews(app) {
  return Promise.all([actors[3],actors[4]].map(async actor=>{
    const peer=new pg.Client({connectionString:url});await peer.connect();
    try { return (await peer.query('SELECT public.review_cinema_creator($1,$2,$3,$4,$5,$6,$7,$8) AS value',reviewArgs(actor,app,randomUUID()))).rows[0].value; }
    finally {await peer.end();}
  }));
}
try {
  const migration=await readFile(new URL('../packages/db/schema/supabase/0133_cinema_creator_applications.sql',import.meta.url),'utf8');
  await c.query(migration);await c.query(migration);
  for(let i=0;i<actors.length;i++) {
    await c.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[actors[i],`${actors[i]}@example.invalid`]);
    await invoke('create_cinema_profile',[actors[i],randomUUID(),{username:`c_${actors[i].replaceAll('-','').slice(0,20)}`,display_name:`Creator ${i}`}],['text','uuid','jsonb']);
  }
  const balances=await q('SELECT u.auth_id,b.balance,b.free_balance FROM public.users u JOIN public.credit_balances b ON b.user_id=u.id WHERE u.auth_id=ANY($1::text[]) ORDER BY u.auth_id',[actors]);
  const key=randomUUID(), a=await apply(actors[0],key);
  assert.equal(a.status,'pending');assert.equal(a.idempotent,false);
  assert.equal((await apply(actors[0],key)).id,a.id);
  assert.equal((await apply(actors[0],key,'Different creative application text.')).error,'idempotency_conflict');
  assert.equal((await apply(actors[0],randomUUID())).error,'application_exists');
  const own=await invoke('read_own_cinema_application',[actors[1]],['text']);assert.equal(own.application,null);
  assert.equal((await review(actors[1],a.id,randomUUID())).error,'not_authorized');
  // General admin does not imply Cinema permission.
  await c.query('UPDATE public.users SET is_admin=true WHERE auth_id=$1',[actors[1]]);
  assert.equal((await review(actors[1],a.id,randomUUID())).error,'not_authorized');
  for(const actor of [actors[3],actors[4]]) await c.query("UPDATE public.cinema_memberships SET role='administrator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actor]);
  for(const role of ['viewer','creator','moderator']) {
    await c.query('UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',[actors[1],role]);
    assert.equal((await review(actors[1],a.id,randomUUID())).error,'not_authorized');
  }
  assert.equal((await review(actors[3],a.id,randomUUID(),'approved',Math.floor(Date.now()/1000)-301)).error,'not_authorized');
  assert.equal((await review(actors[3],a.id,randomUUID(),'approved',Math.floor(Date.now()/1000)+60)).error,'not_authorized');
  const rkey=randomUUID();assert.equal((await review(actors[3],a.id,rkey)).status,'approved');
  assert.equal((await review(actors[3],a.id,rkey)).idempotent,true);
  assert.equal((await review(actors[3],a.id,rkey,'rejected')).error,'idempotency_conflict');
  assert.equal((await review(actors[4],a.id,randomUUID())).error,'already_reviewed');
  assert.equal(await value('SELECT m.role AS value FROM public.cinema_memberships m JOIN public.users u ON u.id=m.user_id WHERE u.auth_id=$1',[actors[0]]),'creator');
  const b=await apply(actors[2],randomUUID());
  const race=await concurrentReviews(b.id);
  assert.equal(race.filter(x=>x.status==='approved').length,1);assert.equal(race.filter(x=>x.error==='already_reviewed').length,1);
  const d=await apply(actors[5],randomUUID());
  await c.query("UPDATE public.cinema_memberships SET role='administrator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actors[5]]);
  assert.equal((await review(actors[5],d.id,randomUUID())).error,'self_review_forbidden');
  // All non-active statuses deny owner profile reads, replay and applications.
  for(const status of ['restricted','suspended','banned']) {
    await c.query('UPDATE public.cinema_memberships SET account_status=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',[actors[0],status]);
    assert.equal((await invoke('read_own_cinema_profile',[actors[0]],['text'])).error,'account_not_active');
    assert.equal((await invoke('create_cinema_profile',[actors[0],randomUUID(),{username:'other_name',display_name:'Name'}],['text','uuid','jsonb'])).error,'account_not_active');
    assert.equal((await apply(actors[0],key)).error,'account_not_active');
    assert.equal((await invoke('read_own_cinema_application',[actors[0]],['text'])).error,'account_not_active');
  }
  await c.query("UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actors[3]]);
  assert.equal((await review(actors[3],a.id,rkey)).error,'not_authorized');
  // Tables and RPCs deny browser access, including privileged mutation calls.
  for(const role of ['anon','authenticated','service_role']) {
    await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);
    await assert.rejects(c.query('SELECT * FROM public.cinema_creator_applications'),e=>e.code==='42501');await c.query('ROLLBACK');
    await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);
    await assert.rejects(c.query('TRUNCATE public.cinema_creator_reviews'),e=>e.code==='42501');await c.query('ROLLBACK');
    if(role!=='service_role') {
      await c.query('BEGIN');await c.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(c.query('SELECT public.apply_cinema_creator($1,$2,$3)',[actors[1],randomUUID(),'A sufficiently long statement.']),e=>e.code==='42501');await c.query('ROLLBACK');
    }
  }
  await assert.rejects(c.query('UPDATE public.cinema_creator_reviews SET reason=$1 WHERE application_id=$2',['Changed',a.id]),/append only/);
  await assert.rejects(c.query('DELETE FROM public.cinema_creator_reviews WHERE application_id=$1',[a.id]),/append only/);
  assert.equal(await value('SELECT count(*)::int AS value FROM public.cinema_creator_reviews WHERE application_id=ANY($1::uuid[])',[[a.id,b.id]]),2);
  assert.deepEqual(await q('SELECT u.auth_id,b.balance,b.free_balance FROM public.users u JOIN public.credit_balances b ON b.user_id=u.id WHERE u.auth_id=ANY($1::text[]) ORDER BY u.auth_id',[actors]),balances);
  console.log('Cinema creator database checks passed: isolation, roles, status, MFA freshness, replay, concurrency, audit immutability and unchanged balances.');
} finally { await c.end(); }
