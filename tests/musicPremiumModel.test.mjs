import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { capabilityFor } from '../lib/modelCapabilities.js';

const migrationUrl = new URL('../packages/db/schema/supabase/0469_music_premium_pair_model.sql', import.meta.url);
const activationUrl = new URL('../packages/db/schema/supabase/0043_activate_ace_step_1_5.sql', import.meta.url);
const entitlementRouteUrl = new URL('../app/api/v1/music/entitlements/route.js', import.meta.url);

test('ACE-Step 1.5 has the verified fixed one-track payload and catalog activation evidence', async () => {
  const capability = capabilityFor('fal-ai/ace-step-1.5');
  assert.deepEqual(capability.fixed, { duration: 60, thinking: true, num_outputs: 1 });
  assert.equal(capability.inputs.prompt.required, true);
  assert.deepEqual(capability.rename, {});
  const activation = await readFile(activationUrl, 'utf8');
  assert.match(activation, /WHERE id = 'ace-step-1\.5'/);
  assert.match(activation, /SET active = true/);
});

test('premium quote and submit boundaries both require a current active paid period', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /p_model_id NOT IN \('ace-step', 'ace-step-1\.5'\)/);
  assert.match(sql, /provider_endpoint IN \('fal-ai\/ace-step', 'fal-ai\/ace-step-1\.5'\)/);
  assert.equal((sql.match(/private\.music_paid_plan_active\(v_user\)/g) || []).length, 2);
  assert.match(sql, /s\.status = 'active'[\s\S]*s\.current_period_end IS NOT NULL[\s\S]*s\.current_period_end > now\(\)/);
  assert.match(sql, /WHEN 'ace-step-1\.5' THEN jsonb_build_object\([\s\S]*'prompt', v_prompt\.prompt[\s\S]*'thinking', true[\s\S]*'num_outputs', 1/);
  assert.match(sql, /v_model\.updated_at IS DISTINCT FROM v_quote\.catalog_updated_at/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.music_create_quote[\s\S]*TO service_role/);
  assert.doesNotMatch(sql, /GRANT EXECUTE[\s\S]*TO authenticated/);
});

test('the authenticated entitlement route reads subscription state server-side', async () => {
  const route = await readFile(entitlementRouteUrl, 'utf8');
  assert.match(route, /read_own_credit_subscription/);
  assert.match(route, /subscription: subscription\?\.ok \? subscription\.subscription : null/);
});
