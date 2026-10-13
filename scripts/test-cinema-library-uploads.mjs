// Disposable local database only. Never contacts Cloudflare or production.
// Migration 0295: exact-byte malware quarantine for Cinema Library videos.
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
const read=(actor,content)=>val('SELECT public.read_cinema_upload($1,$2) AS value',[actor,content]);
const userId=actor=>val('SELECT id AS value FROM public.users WHERE auth_id=$1',[actor]);
const claims=()=>q('SELECT * FROM public.claim_cinema_malware_scans(1,900)');
const prepare=(row,uid,url)=>val('SELECT public.prepare_cinema_scanned_upload($1,$2,$3,$4,$5,$6,$7,$8) AS value',
  [row.upload_id,row.claim_token,'d'.repeat(64),'video/mp4','ClamAV 1.4/test',{reason:'clean',format:'mov,mp4',codec:'h264',duration_seconds:12,width:1280,height:720},uid,url]);
const record=(row,verdict,reason)=>val('SELECT public.record_cinema_malware_scan($1,$2,$3,$4,$5,$6,$7) AS value',
  [row.upload_id,row.claim_token,verdict,'e'.repeat(64),'video/mp4','ClamAV 1.4/test',{reason}]);

async function job(actor,{mime='video/mp4',size=5000,state='STORED',expires=null,held=false}={}) {
  const user=await userId(actor);
  await q('SELECT public.ledger_grant($1,100,$2)',[user,'grant:test_fixture']);
  const debit=await val("SELECT public.ledger_debit($1,$2,4,'debit:generation','seedance-2.0-fast','{}'::jsonb) AS value",[user,randomUUID()]);
  assert.equal(debit.ok,true);
  await q('UPDATE public.jobs SET state=$2 WHERE id=$1',[debit.job_id,state]);
  await q('INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes,expires_at,held_at) VALUES($1,$2,$3,$4,$5,$6)',
    [debit.job_id,'assets/'+randomUUID()+'.bin',mime,size,expires,held?new Date():null]);
  return debit.job_id;
}

try {
  const migration=await readFile(new URL('../packages/db/schema/supabase/0295_cinema_malware_quarantine.sql',import.meta.url),'utf8');
  await q('BEGIN');await c.query(migration);await c.query(migration);await q('ROLLBACK');
  for(const actor of actors){
    await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[actor,actor+'@example.invalid']);
    await val('SELECT public.create_cinema_profile($1,$2,$3) AS value',[actor,randomUUID(),{username:'l_'+actor.replaceAll('-','').slice(0,20),display_name:'Library test'}]);
    await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actor]);
  }
  const [owner,other]=actors,content=(await draft(owner)).id,video=await job(owner),secondVideo=await job(owner),flaggedJob=await job(owner);

  assert.equal((await reserve(other,content,video)).error,'upload_not_allowed');
  assert.equal((await reserve(owner,content,await job(other))).error,'source_not_found');
  assert.equal((await reserve(owner,content,await job(owner,{state:'DEBITED'}))).error,'source_not_found');
  assert.equal((await reserve(owner,content,await job(owner,{expires:new Date(Date.now()-60000)}))).error,'source_not_found');
  assert.equal((await reserve(owner,content,await job(owner,{held:true}))).error,'source_not_found');
  assert.equal((await reserve(owner,content,randomUUID())).error,'source_not_found');
  assert.equal((await reserve(owner,content,await job(owner,{mime:'image/png'}))).error,'source_not_video');
  assert.equal((await reserve(owner,(await draft(owner,'SERIES')).id,video)).error,'upload_not_allowed');
  assert.equal(await val('SELECT count(*)::int AS value FROM public.cinema_uploads WHERE content_id=$1',[content]),0);
  const balances=await q('SELECT user_id,balance FROM public.credit_balances ORDER BY user_id');

  const key=randomUUID(),row=await reserve(owner,content,video,key);
  assert.equal(row.claimed,true);assert.equal(row.server_mediated,true);assert.equal(row.source_job_id,video);
  assert.equal(row.file_size,5000);assert.equal(row.state,'provisioning');assert.equal(row.scan_status,'queued');
  assert.equal(row.r2_key,undefined);assert.equal(row.mime_type,undefined);
  const queued=(await q('SELECT r2_key,expected_size,expected_mime,status FROM public.cinema_malware_scans WHERE upload_id=$1',[row.id]))[0];
  assert.match(queued.r2_key,/^assets\//);assert.equal(Number(queued.expected_size),5000);
  assert.equal(queued.expected_mime,'video/mp4');assert.equal(queued.status,'queued');
  for(const again of [await reserve(owner,content,video,key),await reserve(owner,content,video)]) {
    assert.equal(again.id,row.id);assert.equal(again.claimed,false);assert.equal(again.scan_status,'queued');
  }
  assert.equal((await reserve(owner,content,secondVideo)).error,'upload_exists');
  assert.equal((await reserve(owner,(await draft(owner)).id,video,key)).error,'idempotency_conflict');

  const claimed=(await claims())[0];
  assert.equal(claimed.upload_id,row.id);assert.match(claimed.claim_token,/^[a-f0-9-]{36}$/);
  assert.equal(Number(claimed.expected_size),5000);assert.equal(claimed.attempts,1);
  assert.equal((await prepare(claimed,'short','https://upload.cloudflarestream.com/test')).code,'INVALID_RESULT');
  const uid=randomUUID().replaceAll('-',''),uploadUrl='https://upload.cloudflarestream.com/'+randomUUID();
  assert.equal((await prepare(claimed,uid,uploadUrl)).ok,true);
  assert.equal((await prepare(claimed,uid,uploadUrl)).replayed,true);
  const attached=(await read(owner,content)).upload;
  assert.equal(attached.state,'uploading');assert.equal(attached.stream_uid,uid);assert.equal(attached.upload_url,uploadUrl);
  assert.equal((await val('SELECT public.observe_cinema_upload($1,$2,$3,$4,$5,$6) AS value',[uid,'ready',new Date().toISOString(),42,1280,720])).ok,true);
  assert.equal((await read(owner,content)).upload.state,'ready');
  assert.equal(await val('SELECT lifecycle_status AS value FROM public.cinema_content WHERE id=$1',[content]),'DRAFT');

  const flaggedContent=(await draft(owner)).id;
  const flaggedRow=await reserve(owner,flaggedContent,flaggedJob),flaggedClaim=(await claims())[0];
  assert.equal(flaggedClaim.upload_id,flaggedRow.id);
  assert.equal((await record(flaggedClaim,'flagged','malware_signature')).ok,true);
  assert.equal((await read(owner,flaggedContent)).upload.state,'error');
  assert.equal(await val('SELECT status AS value FROM public.cinema_malware_scans WHERE upload_id=$1',[flaggedRow.id]),'flagged');
  assert.equal(await val('SELECT count(*)::int AS value FROM public.cinema_malware_scan_events WHERE upload_id=$1',[flaggedRow.id]),1);
  await assert.rejects(c.query('UPDATE public.cinema_malware_scan_events SET details=$2 WHERE upload_id=$1',[flaggedRow.id,{reason:'changed'}]),e=>e.message.includes('append-only'));

  const scannerFns=[
    'public.reserve_cinema_library_upload(text,uuid,uuid,uuid)',
    'public.claim_cinema_malware_scans(integer,integer)',
    'public.record_cinema_malware_scan(uuid,uuid,text,text,text,text,jsonb)',
    'public.prepare_cinema_scanned_upload(uuid,uuid,text,text,text,jsonb,text,text)',
    'public.fail_cinema_scanned_delivery(uuid,text)',
  ];
  const bypassFns=[
    'public.attach_cinema_library_upload(uuid,text)',
    'public.reserve_cinema_proxy_upload(text,uuid,uuid,bigint,text)',
    'public.attach_cinema_upload(uuid,text,text)',
    'public.claim_cinema_transfer(text,uuid,uuid,uuid)',
    'public.finish_cinema_transfer(uuid,uuid)',
  ];
  for(const fn of scannerFns) assert.equal(await val("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS value",[fn]),true,fn);
  for(const fn of bypassFns) assert.equal(await val("SELECT has_function_privilege('service_role',$1,'EXECUTE') AS value",[fn]),false,fn);
  for(const role of ['anon','authenticated']) for(const fn of scannerFns) {
    assert.equal(await val('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS value',[role,fn]),false,role+' '+fn);
  }
  for(const role of ['anon','authenticated','service_role']) for(const table of ['cinema_malware_scans','cinema_malware_scan_events']) {
    assert.equal(await val('SELECT has_table_privilege($1,$2,\'SELECT\') AS value',[role,'public.'+table]),false,role+' '+table);
  }
  const rls=await q("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid IN ('public.cinema_malware_scans'::regclass,'public.cinema_malware_scan_events'::regclass) ORDER BY relname");
  assert.equal(rls.length,2);for(const table of rls){assert.equal(table.relrowsecurity,true);assert.equal(table.relforcerowsecurity,true);}

  await q("UPDATE public.cinema_memberships SET account_status='suspended' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[owner]);
  assert.equal((await reserve(owner,content,video)).error,'upload_not_allowed');
  await q("UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[owner]);
  await assert.rejects(c.query('DELETE FROM public.jobs WHERE id=$1',[video]),e=>e.code==='23503');
  assert.deepEqual(await q('SELECT user_id,balance FROM public.credit_balances ORDER BY user_id'),balances);

  console.log('Cinema Library quarantine: replay, ownership, private queue, exact scanner claim/result, append-only evidence, legacy bypass revocation, RLS/ACL and unchanged credits passed.');
} finally { await c.end(); }
