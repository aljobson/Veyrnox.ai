import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('social approvals (0304)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one=async(sql:string,args:unknown[]=[]) => (await pool.query(sql,args)).rows[0];
  const value=async(sql:string,args:unknown[]=[]) => (await one(sql,args)).value;
  before(async()=>{
    pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:4});
    const migration=await readFile(new URL('./schema/supabase/0304_social_approvals.sql',import.meta.url),'utf8');
    await pool.query(migration); await pool.query(migration);
  });
  after(async()=>{if(pool)await pool.end();});

  async function fixture({paid=true}={}) {
    const auth=randomUUID(),email=`${auth}@test.veyrnox.ai`;
    await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,email]);
    const userId=await value('SELECT public.provision_user($1,$2) value',[auth,email]);
    const brand=(await value('SELECT public.get_or_create_default_social_brand($1) value',[auth])).brand_id;
    const account=(await one(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,access_token_enc,status)
      VALUES($1,'instagram',$2,$3,'active') RETURNING id`,[brand,`ig-${randomUUID()}`,Buffer.from('cipher')])).id;
    const job=(await one(`INSERT INTO public.jobs(user_id,idempotency_key,model_id,credits,state,inputs)
      VALUES($1,$2,'approval-fixture',1,'STORED','{}'::jsonb) RETURNING id`,[userId,`approval-${randomUUID()}`])).id;
    await pool.query(`INSERT INTO public.assets(job_id,r2_key,mime_type,size_bytes) VALUES($1,$2,'image/png',10)`,[job,`approval/${randomUUID()}.png`]);
    if(paid)await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end)
      VALUES($1,'publish',$2,1500,'publish-plan-2026-10-13','active',now()+interval '30 days')`,[userId,`approval-plan-${randomUUID()}`]);
    return {auth,brand,account,job};
  }
  const create=(f:Awaited<ReturnType<typeof fixture>>,policy='all')=>value(
    `SELECT public.create_social_post_approval($1,$2,$3,now()+interval '1 hour',$4,$5,$6,$7::jsonb,$8,$9::jsonb,NULL) value`,
    [f.auth,f.brand,randomUUID(),'Review this post',`approval_${randomUUID().replaceAll('-','')}`,[f.account],JSON.stringify([{media_type:'image',job_id:f.job}]),policy,JSON.stringify(['one@example.com','two@example.com'])]);

  it('keeps an all-reviewer post inert until every reviewer approves',async()=>{
    const f=await fixture(); const made=await create(f);
    assert.equal(made.ok,true,JSON.stringify(made)); assert.equal(made.reviewers.length,2);
    assert.equal((await one('SELECT status FROM public.social_posts WHERE id=$1',[made.post_id])).status,'draft');
    const first=await value('SELECT public.decide_social_approval($1,$2,$3) value',[made.reviewers[0].id,'approved','Looks good']);
    assert.deepEqual([first.request_status,(await one('SELECT status FROM public.social_posts WHERE id=$1',[made.post_id])).status],['pending','draft']);
    const second=await value('SELECT public.decide_social_approval($1,$2,NULL) value',[made.reviewers[1].id,'approved']);
    assert.equal(second.request_status,'approved');
    assert.equal((await one('SELECT status FROM public.social_posts WHERE id=$1',[made.post_id])).status,'scheduled');
    assert.equal((await value('SELECT public.get_social_approval_review($1) value',[made.reviewers[0].id])).media.r2_key.startsWith('approval/'),true);
    assert.equal((await value('SELECT public.list_social_approvals($1,$2) value',[f.auth,f.brand])).requests[0].status,'approved');
  });

  it('one rejection cancels the draft before it can be claimed',async()=>{
    const f=await fixture(); const made=await create(f,'any');
    const rejected=await value('SELECT public.decide_social_approval($1,$2,$3) value',[made.reviewers[0].id,'rejected','Change the caption']);
    assert.equal(rejected.request_status,'rejected');
    assert.deepEqual(await one(`SELECT p.status,t.publish_status,t.last_error FROM public.social_posts p JOIN public.social_post_targets t ON t.post_id=p.id WHERE p.id=$1`,[made.post_id]),
      {status:'canceled',publish_status:'failed',last_error:'approval_rejected'});
    const replay=await value('SELECT public.decide_social_approval($1,$2,NULL) value',[made.reviewers[0].id,'approved']);
    assert.deepEqual([replay.idempotent,replay.decision,replay.request_status],[true,'rejected','rejected']);
  });

  it('requires a paid owner and keeps approval storage closed to browser roles',async()=>{
    const free=await fixture({paid:false});
    assert.deepEqual(await create(free),{ok:false,code:'PLAN_REQUIRED'});
    for(const table of ['social_approval_requests','social_approval_reviewers','social_approval_events'])for(const role of ['anon','authenticated'])
      assert.equal((await one(`SELECT has_table_privilege($1,$2,'SELECT') OR has_table_privilege($1,$2,'INSERT') allowed`,[role,`public.${table}`])).allowed,false,`${role} on ${table}`);
  });
});
