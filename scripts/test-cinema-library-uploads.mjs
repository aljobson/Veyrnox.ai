// Disposable local database only. Never contacts Cloudflare or production.
// Migration 0248: a Cinema video reserved from the creator's own finished Library job.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(sql,args=[])=>(await c.query(sql,args)).rows;
const val=async(sql,args=[])=>(await q(sql,args))[0]?.value;
const actors=[randomUUID(),randomUUID()];
const draft=(actor,type='SHORT')=>val('SELECT public.save_cinema_draft($1,$2,null,0,$3) AS value',[actor,randomUUID(),{content_type:type,parent_id:null,position:null,title:'Library upload test',synopsis:'',language:'en',ai_disclosures:[]}]);
const reserve=(actor,content,job,key=randomUUID())=>val('SELECT public.reserve_cinema_library_upload($1,$2,$3,$4) AS value',[actor,content,job,key]);
const attach=(id,uid)=>val('SELECT public.attach_cinema_library_upload($1,$2) AS value',[id,uid]);
const read=(actor,content)=>val('SELECT public.read_cinema_upload($1,$2) AS value',[actor,content]);
const userId=actor=>val('SELECT id AS value FROM public.users WHERE auth_id=$1',[actor]);
// A finished Library job with one stored asset, as the generation path leaves it.
async function job(actor,{mime='video/mp4',size=5000,state='STORED',expires=null}={}) {
  const user=await userId(actor);
  await q('SELECT public.ledger_grant($1,100,$2)',[user,'grant:test_fixture']);
  const debit=await val("SELECT public.ledger_debit($1,$2,4,'debit:generation','seedance-2.0-fast','{}'::jsonb) AS value",[user,randomUUID()]);
  assert.equal(debit.ok,true);
  await q('UPDATE public.jobs SET state=$2 WHERE id=$1',[debit.job_id,state]);
  await q('INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes,expires_at) VALUES($1,$2,$3,$4,$5)',[debit.job_id,`assets/${randomUUID()}.bin`,mime,size,expires]);
  return debit.job_id;
}
try {
  const migration=await readFile(new URL('../packages/db/schema/supabase/0248_cinema_library_uploads.sql',import.meta.url),'utf8');
  await q('BEGIN');await c.query(migration);await c.query(migration);await q('ROLLBACK');
  for(const actor of actors){await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[actor,`${actor}@example.invalid`]);await val('SELECT public.create_cinema_profile($1,$2,$3) AS value',[actor,randomUUID(),{username:`l_${actor.replaceAll('-','').slice(0,20)}`,display_name:'Library test'}]);await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actor]);}
  const [owner,other]=actors,content=(await draft(owner)).id,video=await job(owner),secondVideo=await job(owner);

  // Ownership and source checks: another person's job, an unfinished job, an image and an expired asset all refuse.
  assert.equal((await reserve(other,content,video)).error,'upload_not_allowed');
  assert.equal((await reserve(owner,content,await job(other))).error,'source_not_found');
  assert.equal((await reserve(owner,content,await job(owner,{state:'DEBITED'}))).error,'source_not_found');
  assert.equal((await reserve(owner,content,await job(owner,{expires:new Date(Date.now()-60000)}))).error,'source_not_found');
  assert.equal((await reserve(owner,content,randomUUID())).error,'source_not_found');
  assert.equal((await reserve(owner,content,await job(owner,{mime:'image/png'}))).error,'source_not_video');
  assert.equal((await reserve(owner,(await draft(owner,'SERIES')).id,video)).error,'upload_not_allowed');
  assert.equal(await val('SELECT count(*)::int AS value FROM public.cinema_uploads WHERE content_id=$1',[content]),0);
  // From here on nothing generates: a reservation moves no Credits.
  const balances=await q('SELECT user_id,balance FROM public.credit_balances ORDER BY user_id');

  // One claim, provenance recorded, object key returned to the service role only.
  const key=randomUUID(),row=await reserve(owner,content,video,key);
  assert.equal(row.claimed,true);assert.equal(row.server_mediated,true);assert.equal(row.source_job_id,video);assert.equal(row.file_size,5000);
  assert.match(row.r2_key,/^assets\//);assert.equal(row.mime_type,'video/mp4');assert.equal(row.state,'provisioning');
  // Idempotent on (draft, job): the same key, or a new key, returns the same row without a second claim.
  for(const again of [await reserve(owner,content,video,key),await reserve(owner,content,video)]) {assert.equal(again.id,row.id);assert.equal(again.claimed,false);}
  // Another job for the same draft is a different video: refused until the first is removed.
  assert.equal((await reserve(owner,content,secondVideo)).error,'upload_exists');
  // The same key with other arguments conflicts.
  assert.equal((await reserve(owner,(await draft(owner)).id,video,key)).error,'idempotency_conflict');
  // No transfer grant exists for a Library copy, before or after Stream knows about it.
  assert.equal((await val('SELECT public.claim_cinema_transfer($1,$2,$3,$4) AS value',[owner,content,row.id,randomUUID()])).error,'upload_not_writable');

  const uid=randomUUID().replaceAll('-',''),otherUid=randomUUID().replaceAll('-','');
  assert.equal((await attach(row.id,'short')).error,'invalid_upload');
  assert.equal((await attach(randomUUID(),uid)).error,'upload_not_found');
  assert.equal((await attach(row.id,uid)).ok,true);assert.equal((await attach(row.id,uid)).ok,true);
  assert.equal((await attach(row.id,otherUid)).error,'idempotency_conflict');
  const attached=(await read(owner,content)).upload;
  assert.equal(attached.state,'processing');assert.equal(attached.stream_uid,uid);assert.equal(attached.upload_url,null);assert.equal(attached.source_job_id,video);
  assert.equal((await val('SELECT public.claim_cinema_transfer($1,$2,$3,$4) AS value',[owner,content,row.id,randomUUID()])).error,'upload_not_writable');
  // The observation path that serves browser uploads finishes a copy the same way, and never publishes.
  assert.equal((await val('SELECT public.observe_cinema_upload($1,$2,$3,$4,$5,$6) AS value',[uid,'ready',new Date().toISOString(),42,1080,1920])).ok,true);
  assert.equal((await read(owner,content)).upload.state,'ready');
  assert.equal(await val('SELECT lifecycle_status AS value FROM public.cinema_content WHERE id=$1',[content]),'DRAFT');
  // A browser-upload row cannot be attached through the Library path.
  const plain=(await draft(owner)).id,plainRow=await val('SELECT public.reserve_cinema_proxy_upload($1,$2,$3,100,$4) AS value',[owner,plain,randomUUID(),'a'.repeat(64)]);
  assert.equal((await attach(plainRow.id,otherUid)).error,'invalid_upload');
  // Membership revocation refuses before any lookup.
  await q("UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[owner]);
  assert.equal((await reserve(owner,content,video)).error,'upload_not_allowed');
  await q("UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[owner]);
  // Jobs are never deleted while a Cinema video refers to them.
  await assert.rejects(c.query('DELETE FROM public.jobs WHERE id=$1',[video]),e=>e.code==='23503');
  // Money is untouched by a reservation.
  assert.deepEqual(await q('SELECT user_id,balance FROM public.credit_balances ORDER BY user_id'),balances);

  for(const role of ['anon','authenticated']) for(const sql of [
    'SELECT public.reserve_cinema_library_upload(null,null,null,null)',
    'SELECT public.attach_cinema_library_upload(null,null)',
  ]) { await q('BEGIN');await q(`SET LOCAL ROLE ${role}`);await assert.rejects(c.query(sql),e=>e.code==='42501');await q('ROLLBACK'); }
  console.log('Cinema library uploads: idempotent migration, owner/source refusal, one claim per (draft, job), provenance, no transfer grant, observation to ready, FK and ACL passed.');
} finally { await c.end(); }
