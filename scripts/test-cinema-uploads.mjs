// Disposable local database only. Never contacts Cloudflare or production.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
const url=process.env.DATABASE_URL;
if(!url||!['localhost','127.0.0.1','postgres'].includes(new URL(url).hostname))throw Error('isolated local database required');
const c=new pg.Client({connectionString:url});await c.connect();
const actors=[randomUUID(),randomUUID()];
const q=async(sql,args=[]) =>(await c.query(sql,args)).rows;
const val=async(sql,args=[]) =>(await q(sql,args))[0]?.value;
const reserve=(actor,content,key=randomUUID(),size=100,hash='a'.repeat(64),client=c)=>client.query('SELECT public.reserve_cinema_upload($1,$2,$3,$4,$5) AS value',[actor,content,key,size,hash]).then(r=>r.rows[0].value);
const read=(actor,id)=>val('SELECT public.read_cinema_upload($1,$2) AS value',[actor,id]);
const attach=(id,uid='b'.repeat(32))=>val('SELECT public.attach_cinema_upload($1,$2,$3) AS value',[id,uid,`https://upload.cloudflarestream.com/${uid}`]);
const observe=(state,time=new Date().toISOString(),uid='b'.repeat(32),duration=42)=>val('SELECT public.observe_cinema_upload($1,$2,$3,$4,$5,$6) AS value',[uid,state,time,duration,1080,1920]);
async function draft(actor,type='SHORT'){return val('SELECT public.save_cinema_draft($1,$2,null,0,$3) AS value',[actor,randomUUID(),{content_type:type,parent_id:null,position:null,title:'Upload test',synopsis:'',language:'en',ai_disclosures:[]}]);}
try {
 const migration=await readFile(new URL('../packages/db/schema/supabase/0137_cinema_stream_uploads.sql',import.meta.url),'utf8');await c.query(migration);await c.query(migration);
 for(const actor of actors){await q('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[actor,`${actor}@example.invalid`]);await val('SELECT public.create_cinema_profile($1,$2,$3) AS value',[actor,randomUUID(),{username:`u_${actor.replaceAll('-','').slice(0,20)}`,display_name:'Upload test'}]);await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actor]);}
 const balances=await q('SELECT * FROM public.credit_balances ORDER BY user_id');
 const d=await draft(actors[0]),series=await draft(actors[0],'SERIES'),key=randomUUID();
 assert.equal((await reserve(actors[0],series.id)).error,'upload_not_allowed');assert.equal((await reserve(actors[1],d.id)).error,'upload_not_allowed');
 const race=await Promise.all([0,1].map(async()=>{const peer=new pg.Client({connectionString:url});await peer.connect();try{return await reserve(actors[0],d.id,key,100,'a'.repeat(64),peer);}finally{await peer.end();}}));
 assert.equal(race.filter(x=>x.claimed).length,1);assert.equal(race[0].id,race[1].id);const row=race[0];
 assert.equal((await reserve(actors[0],d.id,key,101)).error,'idempotency_conflict');
 assert.equal((await reserve(actors[0],d.id,randomUUID(),101)).error,'upload_exists');
 const other=await draft(actors[0]);assert.equal((await reserve(actors[0],other.id,key)).error,'idempotency_conflict');
 assert.equal((await attach(row.id)).ok,true);assert.equal((await attach(row.id)).ok,true);
 assert.equal((await attach(row.id,'c'.repeat(32))).error,'idempotency_conflict');
 assert.equal((await read(actors[1],d.id)).error,'upload_not_allowed');
 assert.equal((await observe('ready',new Date().toISOString(),'b'.repeat(32),601)).error,'invalid_observation');
 const earlier=new Date(Date.now()-60000).toISOString();assert.equal((await observe('processing',earlier)).ok,true);
 assert.equal((await observe('ready')).ok,true);assert.equal((await observe('processing',earlier)).idempotent,true);
 const ready=(await read(actors[0],d.id)).upload;assert.equal(ready.state,'ready');assert.equal(ready.upload_url,null);
 assert.equal(await val('SELECT visibility AS value FROM public.cinema_content WHERE id=$1',[d.id]),'PRIVATE');
 assert.equal(await val('SELECT lifecycle_status AS value FROM public.cinema_content WHERE id=$1',[d.id]),'DRAFT');
 for(const status of ['restricted','suspended','banned']){await q('UPDATE public.cinema_memberships SET account_status=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',[actors[0],status]);assert.equal((await reserve(actors[0],d.id,key)).error,'upload_not_allowed');assert.equal((await read(actors[0],d.id)).error,'upload_not_allowed');}
 await q("UPDATE public.cinema_memberships SET account_status='active' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actors[0]]);
 for(const role of ['viewer','administrator','moderator']){await q('UPDATE public.cinema_memberships SET role=$2 WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',[actors[0],role]);assert.equal((await reserve(actors[0],d.id,key)).error,'upload_not_allowed');}
 await q("UPDATE public.cinema_memberships SET role='creator' WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)",[actors[0]]);
 for(let n=1;n<10;n++){const item=await draft(actors[0]);assert.equal((await reserve(actors[0],item.id)).claimed,true);}
 assert.equal((await reserve(actors[0],other.id)).error,'upload_capacity_reached');
 // Missing provider completions remain counted; they cannot evade the cap.
 const secured=await q("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='cinema_uploads'");assert.ok(secured[0].relrowsecurity&&secured[0].relforcerowsecurity);
 for(const role of ['anon','authenticated','service_role'])for(const sql of ['SELECT * FROM public.cinema_uploads','TRUNCATE public.cinema_uploads',...(role==='service_role'?[]:["SELECT public.read_cinema_upload('invalid',null)","SELECT public.attach_cinema_upload(null,null,null)","SELECT public.observe_cinema_upload(null,null,null,null,null,null)"])]){await q('BEGIN');await q(`SET LOCAL ROLE ${role}`);await assert.rejects(c.query(sql),e=>e.code==='42501');await q('ROLLBACK');}
 // Do not orphan billable media through a cascaded profile deletion.
 await assert.rejects(c.query('DELETE FROM public.cinema_profiles WHERE user_id=(SELECT id FROM public.users WHERE auth_id=$1)',[actors[0]]),e=>e.code==='23503');
 await q('DELETE FROM auth.users WHERE id=$1',[actors[0]]);assert.equal((await read(actors[0],d.id)).error,'upload_not_allowed');
 assert.deepEqual(await q('SELECT * FROM public.credit_balances ORDER BY user_id'),balances);
 console.log('Cinema uploads: replay, concurrent single provisioning, ownership, role/status/Auth denial, capacity, terminal observations, RLS/ACL, private drafts and unchanged credits passed.');
}finally{await c.end();}
