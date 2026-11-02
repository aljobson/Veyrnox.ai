import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname) || new URL(url).searchParams.has('host')) throw Error('isolated local DATABASE_URL required');
const c = new pg.Client({ connectionString: url }); await c.connect();
const q = async (sql,params=[]) => (await c.query(sql,params)).rows;
const one = async (sql,params=[]) => (await q(sql,params))[0];
const call = async (name,args) => (await one('SELECT public.'+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') AS value',args)).value;
async function person(admin=false) {
  const auth=randomUUID(); await q('INSERT INTO auth.users(id,email) VALUES($1,$2)',[auth,auth+'@example.invalid']);
  const u=await one('UPDATE public.users SET is_admin=$2 WHERE auth_id=$1 RETURNING id,email',[auth,admin]);
  if(admin && (await one("SELECT to_regclass('public.admin_roles') AS t")).t) await q("INSERT INTO public.admin_roles(user_id,role) VALUES($1,'owner')",[u.id]);
  return {...u,auth};
}
async function rejects(run,code) {
  await q('SAVEPOINT rejected');try {await assert.rejects(run,e=>e.code===code);}
  finally {await q('ROLLBACK TO SAVEPOINT rejected');await q('RELEASE SAVEPOINT rejected');}
}
try {
  await q('BEGIN');
  // Both ordered replay and older S1-only replay must preserve S2 permissions.
  const reporting=await readFile(new URL('../packages/db/schema/supabase/0427_admin_reporting.sql',import.meta.url),'utf8');
  await q(reporting);await q(reporting);
  const roles=await readFile(new URL('../packages/db/schema/supabase/0428_admin_roles.sql',import.meta.url),'utf8');
  if(roles) {
    await q(roles);
    const signature='public.admin_require_permission(text,text)';
    const definition=()=>one('SELECT pg_get_functiondef($1::regprocedure) AS body',[signature]);
    const guarded=await definition();assert.match(guarded.body,/admin_has_permission/);
    await q(reporting);await q(reporting);
    assert.match((await definition()).body,/admin_has_permission/);
    assert.deepEqual(await definition(),guarded,'0427-only replay must not downgrade the role guard');
  }
  const admin=await person(true), ordinary=await person();
  const denied=await person(true);
  if(roles) {
    await q("UPDATE public.admin_roles SET role='moderator' WHERE user_id=$1",[denied.id]);
    await rejects(()=>call('admin_revenue_summary',[denied.auth,30]),'42501');
    await rejects(()=>call('admin_referrals_summary',[denied.auth,30,50]),'42501');
  }
  const report=()=>call('admin_revenue_summary',[admin.auth,30]);
  const referrals=()=>call('admin_referrals_summary',[admin.auth,30,50]);
  const initial=await report(); assert.deepEqual(initial.pack_purchase_cohorts,[]);
  assert.equal((await referrals()).totals.signups,0);
  for(const [name,args] of [['admin_revenue_summary',[ordinary.auth,30]],['admin_referrals_summary',[ordinary.auth,30,50]]]) await rejects(()=>call(name,args),'42501');
  for(const days of [null,0,366]) {
    await rejects(()=>call('admin_revenue_summary',[admin.auth,days]),'22023');
    await rejects(()=>call('admin_referrals_summary',[admin.auth,days,50]),'22023');
  }
  for(const limit of [null,0,101]) await rejects(()=>call('admin_referrals_summary',[admin.auth,30,limit]),'22023');
  async function sub({price=1900,plan='starter-monthly',paid=true,channel=null,expired=false,status='active'}={}) {
    const u=await person(), id=randomUUID();
    await q("INSERT INTO public.credit_subscriptions(id,user_id,plan_id,idempotency_key,price_usd_cents,credits,consent_version,status,current_period_end,store_channel,store_original_transaction_id) VALUES($1,$2,$3,$4,$5,10,'test',$6,now()+($7::int*interval '1 day'),$8,$9)",
      [id,u.id,plan,randomUUID(),price,status,expired?-1:30,channel,channel?randomUUID():null]);
    if(paid) await q("INSERT INTO public.credit_subscription_events(subscription_id,stripe_event_id,type,status,period_end,occurred_at) VALUES($1,$2,$3,'granted',now()+($4::int*interval '1 day'),now())",
      [id,(channel?'rc_':'evt_')+randomUUID().replaceAll('-',''),channel?'renewal':'invoice.paid',expired?-1:30]);
  }
  await sub();
  assert.equal((await report()).mrr_by_channel.find(r=>r.channel==='stripe').mrr_cents,1900);
  await sub({price:12006,plan:'starter-yearly'}); // 1000.5 rounds to 1001 cents before summing.
  await sub({price:12006,plan:'starter-yearly'});
  await sub({paid:false}); await sub({expired:true}); await sub({status:'past_due'});
  await sub({price:2000,channel:'ios'});await sub({price:3000,channel:'android'});
  // Transactional test fixture only: a hidden plan must not remove existing MRR.
  await q("UPDATE public.credit_subscription_plans SET active=false WHERE id='starter-monthly'");
  const revenue=await report();
  assert.equal(revenue.mrr_by_channel.find(r=>r.channel==='stripe').mrr_cents,3902);
  assert.equal(revenue.mrr_by_channel.find(r=>r.channel==='ios').mrr_cents,2000);
  assert.equal(revenue.mrr_by_channel.find(r=>r.channel==='android').mrr_cents,3000);
  assert.equal(revenue.subscriptions_by_status.find(r=>r.channel==='stripe' && !r.paid_invoice_recorded).subscriptions,1);
  const referrer=await person(), referee=await person();
  await q("INSERT INTO public.referral_codes(user_id,code) VALUES($1,'ABCDEFGHJK')",[referrer.id]);
  await q("INSERT INTO public.referrals(referee_user_id,referrer_user_id,code) VALUES($1,$2,'ABCDEFGHJK')",[referee.id,referrer.id]);
  const grant=await call('ledger_grant',[referee.id,100,'grant:test',randomUUID()]);
  assert.equal(grant.ok,true);
  const topup=randomUUID();
  await q("INSERT INTO public.top_ups(id,user_id,pack_id,idempotency_key,sales_channel,credits,price_usd_cents,variant_id,status,consent_at,consent_version,order_id,credited_at,grant_entry_id,refunded_cents) VALUES($1,$2,'web-100',$3,'web',100,1000,'1','credited',now(),'test','123456789',now(),$4,250)",
    [topup,referee.id,randomUUID(),grant.entry_id]);
  await q("INSERT INTO public.referral_rewards(referee_user_id,referrer_user_id,top_up_id,credits,eligible_at) VALUES($1,$2,$3,10,now())",[referee.id,referrer.id,topup]);
  assert.equal((await referrals()).recent_rewards.length,1);
  const reward=await call('ledger_grant',[referrer.id,10,'grant:test',randomUUID()]);
  await q("UPDATE public.referral_rewards SET status='released',released_at=now(),ledger_entry_id=$2,clawed_back_credits=2 WHERE referee_user_id=$1",[referee.id,reward.entry_id]);
  const summary=await referrals();
  assert.equal(summary.totals.signups,1);assert.equal(summary.totals.rewarded,1);
  assert.equal(summary.totals.credits_granted,10);assert.equal(summary.totals.credits_reversed,2);
  assert.equal(summary.top_referrers[0].email,referrer.email);
  const second=await person();
  await q("INSERT INTO public.referrals(referee_user_id,referrer_user_id,code) VALUES($1,$2,'ABCDEFGHJK')",[second.id,referrer.id]);
  assert.equal((await referrals()).totals.signups,2);
  assert.equal((await referrals()).top_referrers[0].signups,2);
  assert.equal((await call('admin_referrals_summary',[admin.auth,30,1])).top_referrers.length,1);
  const cohort=(await report()).pack_purchase_cohorts[0];
  assert.equal(cohort.gross_cents,1000);assert.equal(cohort.refunded_to_date_cents,250);assert.equal(cohort.net_cents,750);
  for(const fn of ['reconcile_balances','reconcile_free_credits','reconcile_subscription_credits']) assert.deepEqual(await q('SELECT * FROM public.'+fn+'()'),[]);
  console.log('S1 reporting: bounds, non-admin refusal, empty/single/many subscriptions, snapshot MRR, paid evidence, channel separation, inactive plans, referral states and cumulative refunds passed');
} finally {await q('ROLLBACK');await c.end();}
