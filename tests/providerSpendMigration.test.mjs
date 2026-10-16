import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const guard = await readFile(new URL('../packages/db/schema/supabase/0329_provider_spend_and_submit_guards.sql', import.meta.url), 'utf8');
const swap = await readFile(new URL('../packages/db/schema/supabase/0330_nano_banana_to_grsai.sql', import.meta.url), 'utf8');

test('GrsAI has a strict provider budget below the shared supplier ceiling', () => {
    assert.match(guard, /VALUES \('grsai', true, 1000000, 5000000\)/);
    assert.match(guard, /\('fal', true, 10000000, 25000000\)/);
    assert.match(guard, /\('kie', true, 10000000, 25000000\)/);
    assert.match(guard, /\('openrouter', true, 10000000, 25000000\)/);
    assert.match(guard, /\('openrouter-chat', true, 10000000, 25000000\)/);
    assert.match(guard, /\('openrouter-help', true, 1000000, 5000000\)/);
    assert.match(guard, /scope', 'provider_hour'/);
    assert.match(guard, /scope', 'provider_day'/);
    assert.match(guard, /FOR UPDATE/);
});

test('ambiguous paid-provider debits are excluded from generic refunds and have a service-only resolver', () => {
    assert.match(guard, /j\.error_code = 'provider_outcome_unknown'/);
    assert.match(guard, /r\.provider IN \('grsai','fal','kie','openrouter'\)/);
    assert.match(guard, /reconcile_provider_submit_unknown/);
    assert.match(guard, /GRANT EXECUTE[^;]+service_role/s);
    assert.doesNotMatch(guard, /GRANT EXECUTE[^;]+(?:anon|authenticated)/s);
});

test('Nano Banana keeps its public price while moving only the wholesale route', () => {
    assert.match(swap, /id = 'nano-banana-kie'/);
    assert.match(swap, /provider = 'grsai'/);
    assert.match(swap, /provider_endpoint = 'grsai:nano-banana-2-lite'/);
    assert.match(swap, /provider_cost_per_unit = 0\.0067/);
    assert.match(swap, /credits_5s = 2/);
});
