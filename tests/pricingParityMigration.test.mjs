// Opt-in isolated Postgres integration test. No host ports or shared databases.
// RUN_PRICING_DB_TEST=1 node --test tests/pricingParityMigration.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test('parity migration is atomic, replayable and guards price/cost drift', {
    skip: process.env.RUN_PRICING_DB_TEST !== '1', timeout: 60000,
}, async () => {
    const name = `veyrnox-parity-${randomUUID().slice(0, 8)}`;
    const docker = (...args) => execFileSync('docker', args, {encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
    const sql = (input, fail = false) => {
        try {
            const result = execFileSync('docker', ['exec', '-i', name, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
                {input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']});
            if (fail) assert.fail('Expected migration to reject drift');
            return result.trim();
        } catch (err) { if (!fail) throw err; assert.equal(err.status, 3); }
    };
    const migration = readFileSync(new URL('../packages/db/schema/supabase/0118_monthly_credit_parity.sql', import.meta.url), 'utf8');
    const original = readFileSync(new URL('../packages/db/schema/supabase/0041_credit_packs_and_top_ups.sql', import.meta.url), 'utf8');
    const creditTable = original.slice(original.indexOf('CREATE TABLE'), original.indexOf('CREATE TABLE IF NOT EXISTS public.top_ups'));
    const models = JSON.parse(readFileSync(new URL('../docs/pricing/live-catalog-2026-09-24.json', import.meta.url), 'utf8')).models;
    // Fixed reviewed snapshot, not a live database connection.
    const values = models.filter(m => ['nano-banana-kie', 'flux-2-pro', 'hailuo-02-kie'].includes(m.id));
    const quote = v => v == null ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`;
    const seed = values.map(m => `(${[m.id, m.provider, m.provider_endpoint, m.credits_5s, m.provider_cost_per_unit, m.cost_unit, m.billing_seconds].map(quote).join(',')},true)`).join(',');
    const fixture = `${creditTable}
      ALTER TABLE public.credit_packs DROP CONSTRAINT credit_packs_active_needs_variant;
      UPDATE public.credit_packs SET active=true;
      CREATE TABLE public.model_catalog (
        id text primary key, provider text, provider_endpoint text, credits_5s integer,
        provider_cost_per_unit numeric, cost_unit text, billing_seconds numeric,
        active boolean, updated_at timestamptz default now());
      INSERT INTO public.model_catalog (id,provider,provider_endpoint,credits_5s,provider_cost_per_unit,cost_unit,billing_seconds,active) VALUES ${seed};
      CREATE TABLE public.top_ups (pack_id text references public.credit_packs(id), credits integer, price_usd_cents integer);
      INSERT INTO public.top_ups VALUES ('web-300',300,2500);`;
    try {
        docker('run', '-d', '--rm', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:16-alpine');
        let ready = false;
        for (let i = 0; i < 40; i++) {
            try { docker('exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'); ready = true; break; }
            catch { await new Promise(r => setTimeout(r, 250)); }
        }
        assert.ok(ready, 'Postgres starts');
        sql(fixture);
        // A late failure rolls back the earlier pack changes and constraint change.
        sql("UPDATE model_catalog SET provider_cost_per_unit=0.16 WHERE id='hailuo-02-kie';");
        sql(migration, true);
        assert.equal(sql("SELECT count(*) FROM credit_packs WHERE id='web-3000'"), '0');
        assert.equal(sql("SELECT active FROM credit_packs WHERE id='web-300'"), 't');
        assert.equal(sql("SELECT credits_5s FROM model_catalog WHERE id='nano-banana-kie'"), '2');
        sql("UPDATE model_catalog SET provider_cost_per_unit=0.15 WHERE id='hailuo-02-kie';");
        // The pack discount applies to all models, so a non-repriced model
        // below 50% must block rollout too.
        sql("INSERT INTO model_catalog (id,credits_5s,provider_cost_per_unit,active) VALUES ('other-model',1,0.02,true)");
        sql(migration, true);
        assert.equal(sql("SELECT count(*) FROM credit_packs WHERE id='web-3000'"), '0');
        sql("DELETE FROM model_catalog WHERE id='other-model'");
        sql(migration);
        sql(migration);
        assert.equal(sql("SELECT string_agg(id || ':' || credits || ':' || price_usd_cents, ',' ORDER BY credits) FROM credit_packs WHERE active"),
            'web-100:100:1000,web-270:270:1900,web-1200:1200:5900,web-3000:3000:12900');
        assert.equal(sql("SELECT string_agg(id || ':' || credits_5s, ',' ORDER BY id) FROM model_catalog"),
            'flux-2-pro:2,hailuo-02-kie:9,nano-banana-kie:2');
        assert.equal(sql('SELECT credits || \':\' || price_usd_cents FROM top_ups'), '300:2500');
        sql("UPDATE credit_packs SET price_usd_cents=12899 WHERE id='web-3000'", true);
        // Conflicting target packs abort instead of silently claiming parity.
        sql("UPDATE credit_packs SET price_usd_cents=13000 WHERE id='web-3000'");
        sql(migration, true);
        assert.equal(sql("SELECT price_usd_cents FROM credit_packs WHERE id='web-3000'"), '13000');
    } finally { docker('rm', '-f', name); }
});
