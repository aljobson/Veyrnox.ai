import { isFullSocialReplay } from './social-acceptance-bootstrap.js';
import {after,before,describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import pg from 'pg';

describe('Publish production QA regressions (0324–0325)',{skip:!process.env.DATABASE_URL},()=>{
 let pool:pg.Pool;
 const value=async(sql:string,args:unknown[]=[]) => (await pool.query(sql,args)).rows[0].value;
 before(async()=>{pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});if (await isFullSocialReplay(pool)) return;for(const file of ['0324_social_smartlink_history.sql','0325_social_autolist_claim.sql']){const sql=await readFile(new URL(`./schema/supabase/${file}`,import.meta.url),'utf8');await pool.query(sql);await pool.query(sql);}});
 after(async()=>{await pool?.end();});
 async function fixture(){const auth=randomUUID(),email=`qa-${auth}@test.veyrnox.ai`;await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,email]);const user=await value('SELECT public.provision_user($1,$2) value',[auth,email]);const brand=(await value('SELECT public.get_or_create_default_social_brand($1) value',[auth])).brand_id;await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end) VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`,[user,randomUUID()]);return {auth,user,brand,slug:`qa-${randomUUID()}`};}
 type F=Awaited<ReturnType<typeof fixture>>;
 const save=(f:F,items:unknown[],published=true)=>value('SELECT public.save_social_smartlink($1,$2,$3,$4,NULL,NULL,$5,$6,$7::jsonb) value',[f.auth,f.brand,f.slug,'QA','midnight',published,JSON.stringify(items)]);
 const read=(f:F)=>value('SELECT public.get_social_smartlink_editor($1,$2) value',[f.auth,f.brand]);
 it('retains IDs, destinations and clicks through edits, reorder, unpublish and removal',async()=>{
  const f=await fixture();const links=[{label:'Home',url:'https://veyrnox.ai',enabled:true},{label:'Create',url:'https://veyrnox.ai/app/create',enabled:true}];assert.equal((await save(f,links)).ok,true);let page=await read(f);const [a,b]=page.items;
  await value('SELECT public.record_social_smartlink_view($1) value',[f.slug]);await value('SELECT public.record_social_smartlink_click($1,$2) value',[f.slug,a.id]);await value('SELECT public.record_social_smartlink_click($1,$2) value',[f.slug,b.id]);
  assert.equal((await save(f,[{...b,label:'New label'},a],false)).ok,true);page=await read(f);assert.deepEqual(page.items.map((i:any)=>i.id),[b.id,a.id]);assert.deepEqual(page.totals,{views:1,clicks:2});assert.deepEqual(page.items.map((i:any)=>i.clicks),[1,1]);assert.equal((await value('SELECT public.read_social_smartlink_public($1) value',[f.slug])).code,'NOT_FOUND');
  assert.equal((await save(f,[{...b,label:'New label'}])).ok,true);page=await read(f);assert.equal(page.items.length,1);assert.deepEqual(page.totals,{views:1,clicks:2});assert.equal((await value('SELECT public.record_social_smartlink_click($1,$2) value',[f.slug,a.id])).code,'NOT_FOUND');
  assert.equal((await save(f,[])).ok,true);assert.deepEqual((await read(f)).totals,{views:1,clicks:2});
 });
 it('supports older clients and rejects foreign or duplicate IDs atomically',async()=>{
  const f=await fixture(),other=await fixture();const link={label:'Home',url:'https://veyrnox.ai',enabled:true};await save(f,[link]);await save(other,[link]);const id=(await read(f)).items[0].id;const foreign=(await read(other)).items[0].id;await value('SELECT public.record_social_smartlink_click($1,$2) value',[f.slug,id]);await save(f,[link]);assert.equal((await read(f)).items[0].id,id);assert.equal((await read(f)).totals.clicks,1);
  assert.equal((await save(f,[{...link,id:foreign}],false)).code,'INVALID_ITEM');assert.equal((await save(f,[{...link,id},{...link,id}])).code,'INVALID_ITEM');const page=await read(f);assert.equal(page.smartlink.published,true);assert.equal(page.items.length,1);assert.equal(page.items[0].id,id);
  // A new identical destination must not consume an explicitly retained ID.
  assert.equal((await save(f,[link,{...link,id}])).ok,true);assert.equal((await read(f)).items[1].id,id);
 });
 it('serializes a destination click with removal without losing the page total',async()=>{
  const f=await fixture();await save(f,[{label:'Home',url:'https://veyrnox.ai',enabled:true}]);const id=(await read(f)).items[0].id;
  const click=await pool.connect();try{
   await click.query('BEGIN');assert.equal((await click.query('SELECT public.record_social_smartlink_click($1,$2) value',[f.slug,id])).rows[0].value.ok,true);
   const removal=save(f,[]);await click.query('COMMIT');assert.equal((await removal).ok,true);
  }finally{await click.query('ROLLBACK');click.release();}
  assert.equal((await read(f)).totals.clicks,1);assert.equal((await value('SELECT public.record_social_smartlink_click($1,$2) value',[f.slug,id])).code,'NOT_FOUND');
 });
 it('claims due feeds once, skips paused queues and locked rows, and advances refresh time',async()=>{
  const f=await fixture();const account=await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,access_token_enc,status) VALUES($1,'instagram',$2,'QA',decode('00','hex'),'active') RETURNING id value`,[f.brand,randomUUID()]);const queue=await value(`SELECT public.save_social_publish_queue($1,$2,NULL,'QA queue','UTC',$3,'[{"weekday":1,"minute":720}]',true) value`,[f.auth,f.brand,[account]]);assert.equal(queue.ok,true);
  const feed=await value(`SELECT public.save_social_publish_autolist($1,$2,NULL,$3,'QA feed','https://example.com/feed','{{title}}',30,true,false) value`,[f.auth,f.brand,queue.queue_id]);assert.equal(feed.ok,true);await pool.query('UPDATE public.social_publish_autolists SET enabled=false WHERE id<>$1',[feed.autolist_id]);
  const lock=await pool.connect();try{await lock.query('BEGIN');await lock.query('SELECT id FROM public.social_publish_autolists WHERE id=$1 FOR UPDATE',[feed.autolist_id]);assert.equal((await value('SELECT public.claim_due_social_publish_autolists(5) value')).autolists.length,0);}finally{await lock.query('ROLLBACK');lock.release();}
  await pool.query('UPDATE public.social_publish_queues SET enabled=false WHERE id=$1',[queue.queue_id]);assert.equal((await value('SELECT public.claim_due_social_publish_autolists(5) value')).autolists.length,0);await pool.query('UPDATE public.social_publish_queues SET enabled=true WHERE id=$1',[queue.queue_id]);
  const results=await Promise.all([value('SELECT public.claim_due_social_publish_autolists(5) value'),value('SELECT public.claim_due_social_publish_autolists(5) value')]);assert.equal(results.flatMap(r=>r.autolists).filter((r:any)=>r.id===feed.autolist_id).length,1);assert.equal((await value('SELECT next_refresh_at>now() value FROM public.social_publish_autolists WHERE id=$1',[feed.autolist_id])),true);assert.deepEqual((await value('SELECT public.claim_due_social_publish_autolists(5) value')).autolists,[]);
 });
});
