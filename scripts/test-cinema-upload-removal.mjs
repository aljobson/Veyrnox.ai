// Disposable local database only. No provider access, no production writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname))throw Error('isolated local database required');
const c=new pg.Client({connectionString:url});await c.connect();
const q=async(sql,args=[]) =>(await c.query(sql,args)).rows;
const val=async(sql,args=[]) =>(await q(sql,args))[0]?.value;
const actors=[randomUUID(),randomUUID()],users=[];
const draft=actor=>val('SELECT public.save_cinema_draft($1,$2,null,0,$3) AS value',[actor,randomUUID(),{content_type:'SHORT',parent_id:null,position:null,title:'Removal test',synopsis:'Keep this description',language:'en',ai_disclosures:[]}]);
const reserve=(actor,content,key=randomUUID())=>val('SELECT public.reserve_cinema_upload($1,$2,$3,100,$4) AS value',[actor,content,key,'a'.repeat(64)]);
const read=(actor,id)=>val('SELECT public.read_cinema_upload($1,$2) AS value',[actor,id]);
const request=(actor,content,id,key=randomUUID())=>val('SELECT public.request_cinema_upload_removal($1,$2,$3,$4) AS value',[actor,content,id,key]);
const claim=(key,client=c)=>client.query('SELECT public.claim_cinema_upload_removals($1) AS value',[key]).then(r=>r.rows[0].value.items);
const finish=(id,key)=>val('SELECT public.finish_cinema_upload_removal($1,$2) AS value',[id,key]);
try {
 // Applying 0139 twice proves it is idempotent. Roll it back so the assertions exercise what a
 // full replay leaves behind, even once a later migration redefines these functions.
 const migration=await readFile(new URL('../packages/db/schema/supabase/0139_cinema_upload_removal.sql',import.meta.url),'utf8');await q('BEGIN');await c.query(migration);await c.query(migration);await q('ROLLBACK');
 for(const actor of actors){await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[actor,`${actor}@example.invalid`]);await val('SELECT public.create_cinema_profile($1,$2,$3) AS value',[actor,randomUUID(),{username:`r_${actor.replaceAll('-','').slice(0,20)}`,display_name:'Removal test'}]);users.push(await val('SELECT id AS value FROM public.users WHERE auth_id=$1',[actor]));await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=$1",[users.at(-1)]);}
 const balances=await q('SELECT * FROM public.credit_balances ORDER BY user_id');
 const content=await draft(actors[0]),startKey=randomUUID(),row=await reserve(actors[0],content.id,startKey),uid=randomUUID().replaceAll('-','');
 assert.equal((await request(actors[0],content.id,row.id)).error,'upload_needs_reconciliation');
 await val('SELECT public.attach_cinema_upload($1,$2,$3) AS value',[row.id,uid,`https://upload.cloudflarestream.com/${uid}`]);
 assert.equal((await request(actors[1],content.id,row.id)).error,'upload_not_allowed');
 for(const status of ['restricted','suspended','banned']){await q('UPDATE public.cinema_memberships SET account_status=$2 WHERE user_id=$1',[users[0],status]);assert.equal((await request(actors[0],content.id,row.id)).error,'upload_not_allowed');}
 await q("UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=$1",[users[0]]);
 const deleteKey=randomUUID();assert.equal((await request(actors[0],content.id,row.id,deleteKey)).ok,true);assert.equal((await request(actors[0],content.id,row.id,deleteKey)).ok,true);
 assert.equal((await read(actors[0],content.id)).upload.state,'deleting');assert.equal((await read(actors[0],content.id)).upload.upload_url,null);
 const observation=()=>val('SELECT public.observe_cinema_upload($1,$2,now(),30,1080,1920) AS value',[uid,'ready']);
 assert.equal((await observation()).idempotent,true);assert.equal((await read(actors[0],content.id)).upload.state,'deleting');
 assert.equal((await reserve(actors[0],content.id)).claimed,false);
 assert.equal((await val('SELECT public.attach_cinema_upload($1,$2,$3) AS value',[row.id,uid,`https://upload.cloudflarestream.com/${uid}`])).error,'upload_removed');
 const key=randomUUID(),batch=await claim(key);assert.deepEqual(batch,[{id:row.id,stream_uid:uid}]);assert.deepEqual(await claim(key),batch);assert.deepEqual(await claim(randomUUID()),[]);
 // No confirmation / wrong claim cannot release the slot.
 await finish(row.id,randomUUID());assert.equal((await read(actors[0],content.id)).upload.state,'deleting');
 await finish(row.id,key);await finish(row.id,key);assert.equal((await read(actors[0],content.id)).upload,null);
 assert.equal((await reserve(actors[0],content.id,startKey)).error,'upload_removed');
 const replacement=await reserve(actors[0],content.id);assert.ok(replacement.claimed);assert.notEqual(replacement.id,row.id);
 // Stale tabs target the old ID and cannot delete the replacement; key cannot migrate.
 assert.equal((await request(actors[0],content.id,row.id,deleteKey)).ok,true);
 assert.equal((await read(actors[0],content.id)).upload.id,replacement.id);assert.equal((await read(actors[0],content.id)).upload.state,'provisioning');
 assert.equal((await request(actors[0],content.id,replacement.id,deleteKey)).error,'idempotency_conflict');
 assert.equal((await observation()).ignored,true);
 assert.equal(await val('SELECT synopsis AS value FROM public.cinema_content WHERE id=$1',[content.id]),'Keep this description');
 assert.equal(await val('SELECT visibility AS value FROM public.cinema_content WHERE id=$1',[content.id]),'PRIVATE');
 // Failed cleanup is still counted; confirmed tombstones count against daily churn.
 const fixtures=[];
 for(let n=0;n<12;n++){
  const contentId=randomUUID(),uploadId=randomUUID();fixtures.push(uploadId);
  await q("INSERT INTO public.cinema_content(id,creator_id,content_type,title,language) VALUES($1,$2,'SHORT','Delete queue fixture','en')",[contentId,users[1]]);
  await q("INSERT INTO public.cinema_uploads(id,content_id,creator_id,create_key,file_size,fingerprint,state,stream_uid,delete_requested_at) VALUES($1,$2,$3,$4,100,$5,'deleting',$6,now()-interval '31 minutes')",[uploadId,contentId,users[1],randomUUID(),'a'.repeat(64),randomUUID().replaceAll('-','')]);
 }
 const keys=[randomUUID(),randomUUID()];
 const batches=await Promise.all(keys.map(async claimKey=>{const peer=new pg.Client({connectionString:url});await peer.connect();try{return await claim(claimKey,peer);}finally{await peer.end();}}));
 assert.equal(batches.flat().length,12);assert.ok(batches.every(b=>b.length<=10));assert.equal(new Set(batches.flat().map(x=>x.id)).size,12);
 await q("UPDATE public.cinema_uploads SET delete_claimed_at=now()-interval '6 minutes' WHERE id=ANY($1::uuid[])",[fixtures]);
 const newKey=randomUUID(),retried=await claim(newKey);assert.equal(retried.length,10);
 const target=retried[0],oldKey=batches[0].some(x=>x.id===target.id)?keys[0]:keys[1];
 await finish(target.id,oldKey);assert.equal(await val('SELECT state AS value FROM public.cinema_uploads WHERE id=$1',[target.id]),'deleting');
 await finish(target.id,newKey);assert.equal(await val('SELECT state AS value FROM public.cinema_uploads WHERE id=$1',[target.id]),'deleted');
 assert.equal((await reserve(actors[1],(await draft(actors[1])).id)).error,'upload_capacity_reached');
 await q("UPDATE public.cinema_uploads SET state='deleted' WHERE creator_id=$1",[users[1]]);
 assert.equal((await reserve(actors[1],(await draft(actors[1])).id)).error,'upload_capacity_reached');
 await q('SELECT public.refresh_recovery_health()');const health=await val('SELECT public.recovery_status() AS value');assert.equal(JSON.stringify(health).includes(uid),false);
 for(const role of ['anon','authenticated'])for(const sql of ['SELECT public.request_cinema_upload_removal(null,null,null,null)','SELECT public.claim_cinema_upload_removals(null)','SELECT public.finish_cinema_upload_removal(null,null)']){await q('BEGIN');await q(`SET LOCAL ROLE ${role}`);await assert.rejects(c.query(sql),e=>e.code==='42501');await q('ROLLBACK');}
 await q('DELETE FROM auth.users WHERE id=$1',[actors[0]]);assert.equal((await request(actors[0],content.id,replacement.id)).error,'upload_not_allowed');
 assert.deepEqual(await q('SELECT * FROM public.credit_balances ORDER BY user_id'),balances);
 console.log('Cinema removal: owner/status/Auth denial, exact-ID replay, grant withdrawal, provider-first completion, stale-tab/replacement safety, bounded concurrent claims, expiry, daily caps, private drafts and unchanged credits passed.');
}finally{await c.end();}
