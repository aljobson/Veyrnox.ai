import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

describe('report exports and delivery (0323)', { skip: !process.env.DATABASE_URL }, () => {
  let pool: pg.Pool;
  const one = async (sql: string, args: unknown[] = []) => (await pool.query(sql, args)).rows[0];
  const value = async (sql: string, args: unknown[] = []) => (await one(sql, args)).value;
  before(async () => { pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 4 }); const migration = await readFile(new URL('./schema/supabase/0323_social_report_exports_delivery.sql', import.meta.url), 'utf8'); await pool.query(migration); await pool.query(migration); });
  after(async () => { if (pool) await pool.end(); });
  async function user() { const auth = randomUUID(), email = `report-${randomUUID()}@test.veyrnox.ai`; await pool.query('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, email]); const id = await value('SELECT public.provision_user($1,$2) value', [auth, email]); return { auth, id }; }

  it('stores bounded delivery details and claims the complete report configuration', async () => {
    const owner = await user(); const brand = (await value('SELECT public.get_or_create_default_social_brand($1) value', [owner.auth])).brand_id;
    await pool.query(`INSERT INTO public.social_publish_subscriptions(user_id,plan_id,idempotency_key,price_usd_cents,consent_version,status,current_period_end) VALUES($1,'publish',$2,1500,'publish-plan-2026-10-14','active',now()+interval '30 days')`, [owner.id, `report-delivery-${randomUUID()}`]);
    const account = await value(`INSERT INTO public.social_accounts(brand_id,network,external_account_id,display_name,access_token_enc,status) VALUES($1,'instagram',$2,'Report account',decode('00','hex'),'active') RETURNING id value`, [brand, `report-${randomUUID()}`]);
    const saved = await value(`SELECT public.save_social_report_template_v3($1,$2,NULL,'Client report',$3,30,true,true,'Performance','#38bdf8','weekly',9,1,NULL,$4,'reply@example.com','Attached report.','pptx') value`, [owner.auth, brand, account, ['CLIENT@example.com', 'client@example.com']]);
    assert.equal(saved.ok, true);
    const listed = await value('SELECT public.list_social_report_templates($1,$2) value', [owner.auth, brand]);
    assert.deepEqual(listed.templates[0].delivery_recipients, ['client@example.com']); assert.equal(listed.templates[0].delivery_format, 'pptx');
    await pool.query("UPDATE public.social_report_templates SET next_delivery_at=now()-interval '1 minute' WHERE id=$1", [saved.template_id]);
    const claimed = await value('SELECT public.claim_social_report_deliveries(10) value');
    assert.equal(claimed.reports.length, 1); assert.equal(claimed.reports[0].owner_auth_id, owner.auth); assert.equal(claimed.reports[0].account_id, account);
    assert.equal(claimed.reports[0].delivery_message, 'Attached report.'); assert.deepEqual(claimed.reports[0].delivery_recipients, ['client@example.com']);
    assert.equal((await value('SELECT public.complete_social_report_delivery($1,$2,true,$3,NULL) value', [saved.template_id, claimed.reports[0].claim_key, 'email_1'])).ok, true);
    const bad = await value(`SELECT public.save_social_report_template_v3($1,$2,NULL,'Bad',NULL,30,false,true,NULL,'#38bdf8','weekly',9,1,NULL,'{}',NULL,NULL,'pdf') value`, [owner.auth, brand]);
    assert.equal(bad.code, 'INVALID_DELIVERY');
  });

  it('keeps the delivery save function service-only', async () => {
    const signature = 'public.save_social_report_template_v3(text,uuid,uuid,text,uuid,integer,boolean,boolean,text,text,text,integer,integer,integer,text[],text,text,text)';
    for (const role of ['anon', 'authenticated']) assert.equal((await one("SELECT has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).allowed, false);
  });
});
