import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('social SmartLinks (0300)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one=async(sql:string,args:unknown[]=[])=> (await pool.query(sql,args)).rows[0];
  const value=async(sql:string,args:unknown[]=[])=> (await one(sql,args)).value;
  before(async()=>{pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});for(const file of ['0071_signup_grant_on_email_confirmation.sql','0154_social_publish_foundation.sql','0293_social_publish_plans.sql','0299_social_inbox.sql','0300_social_smartlinks.sql']){const migration=await readFile(new URL(`./schema/supabase/${file}`,import.meta.url),'utf8');await pool.query(migration);await pool.query(migration);}});
  after(async()=>{if(pool)await pool.end();});
  async function fixture(paid=true){const auth=randomUUID(),email=`${auth}@test.veyrnox.ai`;await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,email]);const user=await value('SELECT public.provision_user($1,$2) value',[auth,email]);const brand=await value('SELECT public.get_or_create_default_social_brand($1) value',[auth]);if(paid)await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end) VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`,[user,`smart-${randomUUID()}`]);return{auth,brandId:brand.brand_id};}
  const save=(f:Awaited<ReturnType<typeof fixture>>,slug:string)=>value(`SELECT public.save_social_smartlink($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) value`,[f.auth,f.brandId,slug,'Veyrnox','Create and publish',null,'midnight',true,JSON.stringify([{label:'Start creating',url:'https://veyrnox.ai/app/create',enabled:true}])]);

  it('saves a paid brand page, serves only safe public fields and counts views and clicks',async()=>{const f=await fixture(),slug=`v-${randomUUID().slice(0,8)}`;assert.equal((await save(f,slug)).ok,true);const publicPage=await value('SELECT public.read_social_smartlink_public($1) value',[slug]);assert.equal(publicPage.smartlink.title,'Veyrnox');assert.equal(publicPage.items[0].url,undefined);assert.deepEqual(await value('SELECT public.record_social_smartlink_view($1) value',[slug]),{ok:true});const click=await value('SELECT public.record_social_smartlink_click($1,$2) value',[slug,publicPage.items[0].id]);assert.deepEqual(click,{ok:true,url:'https://veyrnox.ai/app/create'});const editor=await value('SELECT public.get_social_smartlink_editor($1,$2) value',[f.auth,f.brandId]);assert.deepEqual(editor.totals,{views:1,clicks:1});assert.equal(editor.items[0].clicks,1);});

  it('requires the paid owner and keeps unpublished pages private',async()=>{const free=await fixture(false),slug=`v-${randomUUID().slice(0,8)}`;assert.deepEqual(await save(free,slug),{ok:false,code:'PLAN_REQUIRED'});assert.deepEqual(await value('SELECT public.get_social_smartlink_editor($1,$2) value',[free.auth,free.brandId]),{ok:false,code:'PLAN_REQUIRED'});assert.deepEqual(await value('SELECT public.read_social_smartlink_public($1) value',[slug]),{ok:false,code:'NOT_FOUND'});});

  it('keeps SmartLink storage closed to browser roles',async()=>{for(const table of ['social_smartlinks','social_smartlink_items','social_smartlink_daily_counts'])for(const role of ['anon','authenticated'])assert.equal((await one(`SELECT has_table_privilege($1,$2,'SELECT') OR has_table_privilege($1,$2,'INSERT') allowed`,[role,`public.${table}`])).allowed,false,`${role} on ${table}`);});
});
