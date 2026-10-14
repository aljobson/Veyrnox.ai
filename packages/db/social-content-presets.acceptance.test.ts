import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('social content presets (0302)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one=async(sql:string,args:unknown[]=[])=> (await pool.query(sql,args)).rows[0];
  const value=async(sql:string,args:unknown[]=[])=> (await one(sql,args)).value;
  before(async()=>{pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});const migration=await readFile(new URL('./schema/supabase/0302_social_content_presets.sql',import.meta.url),'utf8');await pool.query(migration);await pool.query(migration);});
  after(async()=>{if(pool)await pool.end();});
  async function fixture(paid=true){const auth=randomUUID(),email=`${auth}@test.veyrnox.ai`;await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,email]);const user=await value('SELECT public.provision_user($1,$2) value',[auth,email]);const brand=await value('SELECT public.get_or_create_default_social_brand($1) value',[auth]);const account=(await one(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,scopes_granted,access_token_enc,status) VALUES($1,'instagram',$2,'@publisher','{}',$3,'active') RETURNING id`,[brand.brand_id,`ig-${randomUUID()}`,Buffer.from('token')])).id;if(paid)await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end) VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`,[user,`preset-${randomUUID()}`]);return{auth,brandId:brand.brand_id,account};}
  const save=(f:Awaited<ReturnType<typeof fixture>>,id:string|null,name='Launch')=>value('SELECT public.save_social_content_preset($1,$2,$3,$4,$5,$6) value',[f.auth,f.brandId,id,name,'A reusable caption',[f.account]]);

  it('creates, updates, lists and deletes a paid brand preset',async()=>{const f=await fixture();const created=await save(f,null);assert.equal(created.ok,true);let listed=await value('SELECT public.list_social_content_presets($1,$2) value',[f.auth,f.brandId]);assert.deepEqual([listed.presets[0].name,listed.presets[0].caption,listed.presets[0].account_ids[0]],['Launch','A reusable caption',f.account]);assert.equal((await save(f,created.preset_id,'Evergreen')).preset_id,created.preset_id);listed=await value('SELECT public.list_social_content_presets($1,$2) value',[f.auth,f.brandId]);assert.equal(listed.presets[0].name,'Evergreen');assert.deepEqual(await value('SELECT public.delete_social_content_preset($1,$2,$3) value',[f.auth,f.brandId,created.preset_id]),{ok:true});assert.deepEqual((await value('SELECT public.list_social_content_presets($1,$2) value',[f.auth,f.brandId])).presets,[]);});

  it('requires the paid owner and validates account ownership and names',async()=>{const free=await fixture(false),paid=await fixture();assert.deepEqual(await save(free,null),{ok:false,code:'PLAN_REQUIRED'});assert.deepEqual(await value('SELECT public.list_social_content_presets($1,$2) value',[free.auth,free.brandId]),{ok:false,code:'PLAN_REQUIRED'});assert.deepEqual(await value('SELECT public.save_social_content_preset($1,$2,NULL,$3,$4,$5) value',[paid.auth,paid.brandId,'Bad','Caption',[free.account]]),{ok:false,code:'INVALID_INPUT'});assert.equal((await save(paid,null)).ok,true);assert.deepEqual(await save(paid,null,'launch'),{ok:false,code:'PRESET_NAME_TAKEN'});});

  it('keeps preset storage closed to browser roles',async()=>{for(const role of ['anon','authenticated'])assert.equal((await one(`SELECT has_table_privilege($1,'public.social_content_presets','SELECT') OR has_table_privilege($1,'public.social_content_presets','INSERT') allowed`,[role])).allowed,false,role);});
});
