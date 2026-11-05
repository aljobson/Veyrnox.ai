// Host-run against a fully migrated isolated local DB (ADR-0328). Rolls back; no fixture survives.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname) || new URL(url).searchParams.has('host')) throw Error('isolated local DATABASE_URL required');
const c = new pg.Client({ connectionString: url }); await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const one = async (sql, p = []) => (await q(sql, p))[0];
const status = async () => (await one('SELECT public.spend_watch_status() AS v')).v;
try {
  await q('BEGIN');
  const migration = await readFile(new URL('../packages/db/schema/supabase/0444_spend_watch_status.sql', import.meta.url), 'utf8');
  await q(migration); await q(migration);
  const auth = randomUUID(); await q('INSERT INTO auth.users(id,email) VALUES($1,$2)', [auth, auth + '@example.invalid']);
  const user = await one('SELECT id FROM public.users WHERE auth_id=$1', [auth]);
  const policy = await one('SELECT * FROM public.provider_spend_policy WHERE singleton');

  assert.deepEqual(await status(), { ok: true, level: 'ok', scope: 'none', admission_open: true });

  // 85% of the tighter of the global and per-account hour caps: a warning that names the scope, not the figure.
  const cap = Math.min(Number(policy.global_hour_microusd), Number(policy.user_hour_microusd));
  const cost = Math.ceil(cap * 0.85);
  await q("INSERT INTO public.provider_spend_reservations(user_id,effect_key,provider,purpose,estimated_cost_microusd) VALUES($1,'watch-test-0001','zz-test','generation',$2)", [user.id, cost]);
  const warn = await status();
  assert.equal(warn.level, 'warn'); assert.ok(['global', 'user'].includes(warn.scope));
  assert.deepEqual(Object.keys(warn).sort(), ['admission_open', 'level', 'ok', 'scope']);

  // At or past the cap: critical.
  await q('UPDATE public.provider_spend_reservations SET estimated_cost_microusd=$1 WHERE effect_key=$2', [cap, 'watch-test-0001']);
  assert.equal((await status()).level, 'critical');

  // Admission closed is critical whatever the numbers.
  await q('DELETE FROM public.provider_spend_reservations WHERE effect_key=$1', ['watch-test-0001']);
  await q('UPDATE public.provider_spend_policy SET admission_open=false WHERE singleton');
  assert.deepEqual(await status(), { ok: true, level: 'critical', scope: 'global', admission_open: false });

  // A provider that was taking jobs and is now closed is a warning naming the provider, even with
  // global admission open. A provider closed from the start (Higgsfield) stays quiet: the baseline above.
  await q('UPDATE public.provider_spend_policy SET admission_open=true WHERE singleton');
  await q("INSERT INTO public.provider_spend_reservations(user_id,effect_key,provider,purpose,estimated_cost_microusd) VALUES($1,'watch-test-0003','fal','generation',1000)", [user.id]);
  await q("UPDATE public.provider_spend_provider_policy SET admission_open=false WHERE provider='fal'");
  assert.deepEqual(await status(), { ok: true, level: 'warn', scope: 'provider', admission_open: true });
  await q("UPDATE public.provider_spend_provider_policy SET admission_open=true WHERE provider='fal'");

  // Global closure wins the scope even when an account is the busiest at 50%.
  await q("INSERT INTO public.provider_spend_reservations(user_id,effect_key,provider,purpose,estimated_cost_microusd) VALUES($1,'watch-test-0002','zz-test','generation',$2)", [user.id, Math.ceil(Number(policy.user_hour_microusd) * 0.5)]);
  await q('UPDATE public.provider_spend_policy SET admission_open=false WHERE singleton');
  assert.deepEqual(await status(), { ok: true, level: 'critical', scope: 'global', admission_open: false });

  // Callable with the public key; the figures function is not.
  assert.equal((await one("SELECT has_function_privilege('anon','public.spend_watch_status()','EXECUTE') AS a")).a, true);
  assert.equal((await one("SELECT has_function_privilege('anon','public.provider_spend_utilization()','EXECUTE') AS a")).a, false);
  assert.equal((await one("SELECT has_function_privilege('authenticated','public.spend_watch_status()','EXECUTE') AS a")).a, false);
  console.log('spend-watch-status: ok');
} finally { await q('ROLLBACK'); await c.end(); }
