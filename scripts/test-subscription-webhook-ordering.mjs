// ADR-0064 / 0188: real concurrent refund/grant interleavings.
// Committed fixtures live only in a throwaway local database; drop it after the run.
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const url=process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must name a throwaway local test database');
const target=new URL(url);
if (!['localhost','127.0.0.1','[::1]'].includes(target.hostname) || !/^\/(rebuild_check|[a-z0-9_]+_test)$/.test(target.pathname)) {
 throw new Error('Subscription race tests refuse remote databases and non-test database names');
}
const pool=new pg.Pool({connectionString:url,max:8});
const end=new Date(Date.now()+30*86400000).toISOString();
try {
 for(let n=0;n<150;n++) {
  const auth=randomUUID(),sid=`sub_${randomUUID().replaceAll("-", "")}`,invoice=`in_${randomUUID().replaceAll("-", "")}`;
  await pool.query('INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,$2,now())',[auth,`${auth}@example.invalid`]);
  const start=(await pool.query("SELECT public.start_credit_subscription($1,'starter-monthly',$2,'race-test',5,600) AS r",[auth,`race-start-${n}`])).rows[0].r;
  await pool.query("SELECT public.apply_credit_subscription_event($1,'customer.subscription.created',$2,$3,'cus_race','active',$4,false,now())",[`evt_bind_${sid}`,start.subscription_id,sid,end]);
  const grant=()=>pool.query('SELECT public.grant_credit_subscription_invoice($1,$2,$3,1900,$4,now()) AS r',[sid,invoice,`evt_paid_${sid}`,end]);
  const reverse=()=>pool.query("SELECT public.reverse_credit_subscription_invoice($1,$2,$3,'refunded','ch_race',now()) AS r",[sid,invoice,`evt_refund_${sid}`]);
  const promises=n%2?[reverse(),grant()]:[grant(),reverse()];
  const results=await Promise.all(promises);
  assert.ok(results.every(r=>typeof r.rows[0].r.ok==='boolean'));
  const b=(await pool.query('SELECT s.status,b.subscription_balance,b.free_balance FROM public.credit_subscriptions s JOIN public.credit_balances b ON b.user_id=s.user_id WHERE s.id=$1',[start.subscription_id])).rows[0];
  assert.deepEqual(b,{status:'ended',subscription_balance:0,free_balance:10});
  const replay=(await grant()).rows[0].r;
  assert.ok(replay.refused===true || replay.idempotent===true);
  await pool.query("SELECT public.apply_credit_subscription_event($1,'customer.subscription.updated',NULL,$2,'cus_race','active',$3,false,now())",[`evt_late_state_${sid}`,sid,end]);
  assert.equal((await pool.query('SELECT status FROM public.credit_subscriptions WHERE id=$1',[start.subscription_id])).rows[0].status,'ended');
 }
 for (const fn of ['reconcile_balances','reconcile_free_credits','reconcile_top_ups','reconcile_failed_refunds','reconcile_subscription_credits']) assert.deepEqual((await pool.query(`SELECT * FROM public.${fn}()`)).rows,[],fn);
 console.log('150 concurrent full-refund/invoice races, replay and late activation attempts passed; all five reconcilers return zero rows');
} finally {await pool.end();}
