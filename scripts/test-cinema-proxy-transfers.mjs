// Disposable local database only. Never contacts Cloudflare or production.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname)) throw Error('isolated local database required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(sql,args=[])=>(await c.query(sql,args)).rows;
const val=async(sql,args=[])=>(await q(sql,args))[0]?.value;
const actor=randomUUID();
const draft=()=>val('SELECT public.save_cinema_draft($1,$2,null,0,$3) AS value',[actor,randomUUID(),{content_type:'SHORT',parent_id:null,position:null,title:'Proxy transfer test',synopsis:'',language:'en',ai_disclosures:[]}]);
const reserve=(content,proxy=true)=>val(`SELECT public.${proxy?'reserve_cinema_proxy_upload':'reserve_cinema_upload'}($1,$2,$3,100,$4) AS value`,[actor,content,randomUUID(),'a'.repeat(64)]);
const attach=(id,uid)=>val('SELECT public.attach_cinema_upload($1,$2,$3) AS value',[id,uid,`https://upload.cloudflarestream.com/${uid}`]);
const claim=(content,id,key=randomUUID())=>val('SELECT public.claim_cinema_transfer($1,$2,$3,$4) AS value',[actor,content,id,key]);
try {
  const migration=await readFile(new URL('../packages/db/schema/supabase/0164_cinema_proxy_transfers.sql',import.meta.url),'utf8');
  await q('BEGIN');await c.query(migration);await c.query(migration);await q('ROLLBACK');
  await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[actor,`${actor}@example.invalid`]);
  await val('SELECT public.create_cinema_profile($1,$2,$3) AS value',[actor,randomUUID(),{username:`p_${actor.replaceAll('-','').slice(0,20)}`,display_name:'Proxy test'}]);
  await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actor]);

  const content=(await draft()).id,row=await reserve(content),uid=randomUUID().replaceAll('-','');
  assert.equal(row.server_mediated,true);assert.equal((await attach(row.id,uid)).ok,true);
  const transferKey=randomUUID(),held=await claim(content,row.id,transferKey);
  assert.equal(held.ok,true);assert.equal(held.file_size,100);assert.match(held.upload_url,/^https:\/\/upload\.cloudflarestream\.com\//);
  assert.equal((await claim(content,row.id)).error,'upload_busy');
  assert.equal((await claim((await draft()).id,row.id)).error,'upload_not_allowed');

  const removalKey=randomUUID();
  assert.equal((await val('SELECT public.request_cinema_upload_removal($1,$2,$3,$4) AS value',[actor,content,row.id,removalKey])).ok,true);
  assert.deepEqual((await val('SELECT public.claim_cinema_upload_removals($1) AS value',[randomUUID()])).items,[]);
  assert.equal((await val('SELECT public.finish_cinema_transfer($1,$2) AS value',[row.id,randomUUID()])).error,'stale_claim');
  assert.equal((await val('SELECT public.finish_cinema_transfer($1,$2) AS value',[row.id,transferKey])).ok,true);
  const deleteKey=randomUUID(),items=(await val('SELECT public.claim_cinema_upload_removals($1) AS value',[deleteKey])).items;
  assert.deepEqual(items,[{id:row.id,stream_uid:uid}]);
  assert.equal((await val('SELECT public.finish_cinema_upload_removal($1,$2) AS value',[row.id,deleteKey])).ok,true);

  const legacyContent=(await draft()).id,legacy=await reserve(legacyContent,false),legacyUid=randomUUID().replaceAll('-','');
  await attach(legacy.id,legacyUid);
  assert.equal((await claim(legacyContent,legacy.id)).error,'upload_needs_reconciliation');
  assert.equal((await reserve(legacyContent,true)).error,'upload_needs_reconciliation');

  for(const role of ['anon','authenticated']) for(const sql of [
    "SELECT public.reserve_cinema_proxy_upload(null,null,null,null,null)",
    "SELECT public.claim_cinema_transfer(null,null,null,null)",
    "SELECT public.finish_cinema_transfer(null,null)",
  ]) { await q('BEGIN');await q(`SET LOCAL ROLE ${role}`);await assert.rejects(c.query(sql),e=>e.code==='42501');await q('ROLLBACK'); }
  console.log('Cinema proxy transfers: idempotent migration, server-only grants, owner/legacy refusal, durable transfer lock, removal serialization and ACL passed.');
} finally { await c.end(); }
