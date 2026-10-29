import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../packages/db/schema/supabase/0406_expand_fal_prompt_boundary.sql', import.meta.url), 'utf8');
const latestFalAdmission = readFileSync(new URL('../packages/db/schema/supabase/0243_fal_pinned_payload_validation.sql', import.meta.url), 'utf8');
const supplierAdmission = readFileSync(new URL('../packages/db/schema/supabase/0327_supplier_spend_limits.sql', import.meta.url), 'utf8');
const postgresHarness = readFileSync(new URL('../scripts/test-fal-pinned-payload.mjs', import.meta.url), 'utf8');
const stagingProbe = readFileSync(new URL('../scripts/check-fal-pinned-payload-staging.sql', import.meta.url), 'utf8');
const rollbackProbe = readFileSync(new URL('../scripts/check-fal-admission-rollback-staging.sql', import.meta.url), 'utf8');

test('durable FAL admission and its outbox accept the 30,000-character prompt envelope', () => {
    assert.match(sql, /fal_dispatch_payload_check/);
    assert.ok((sql.match(/262144/g) || []).length >= 2);
    assert.match(sql, /pg_get_functiondef/);
    assert.match(sql, /regexp_replace/);
    assert.match(sql, /p_inputs/);
    assert.match(sql, /p_payload/);
    assert.match(sql, /provider_spend_admit_model/);
    assert.match(sql, /pg_constraint/);
    assert.match(sql, /pg_get_constraintdef/);
    assert.match(sql, /format\('ALTER TABLE public\.fal_dispatch DROP CONSTRAINT %I'/);
    assert.match(sql, /fal_dispatch retained an old payload boundary/);
    assert.equal((latestFalAdmission.match(/octet_length\(p_payload::text\) > 16384/g) || []).length, 2);
    assert.match(sql, /p_payload[\s\S]*'g'[\s\S]*boundaries were not fully updated/);
    assert.match(sql, /ELSIF current_definition !~[\s\S]*262144/);
    assert.match(sql, /provider_spend_admit_model has an unknown inputs boundary/);
    assert.doesNotMatch(sql, /expanded_definition = current_definition/);
});

test('the migration replacements cover every current admission-function boundary', () => {
    const falExpanded = latestFalAdmission
        .replace(/octet_length\(p_inputs::text\) > 16384/g, 'octet_length(p_inputs::text) > 262144')
        .replace(/octet_length\(p_payload::text\) > 16384/g, 'octet_length(p_payload::text) > 262144');
    assert.doesNotMatch(falExpanded, /octet_length\(p_(?:inputs|payload)::text\) > 16384/);
    assert.equal((falExpanded.match(/octet_length\(p_payload::text\) > 262144/g) || []).length, 2);
    assert.equal((falExpanded.match(/octet_length\(p_inputs::text\) > 262144/g) || []).length, 1);

    const supplierExpanded = supplierAdmission.replace(
        /octet_length\(p_inputs::text\) > 16384/g,
        'octet_length(p_inputs::text) > 262144',
    );
    assert.doesNotMatch(supplierExpanded, /octet_length\(p_inputs::text\) > 16384/);
    assert.equal((supplierExpanded.match(/octet_length\(p_inputs::text\) > 262144/g) || []).length, 1);
});

test('database acceptance probes track the expanded boundary and separate raw inputs from pinned payloads', () => {
    assert.match(postgresHarness, /0406_expand_fal_prompt_boundary\.sql/);
    assert.match(postgresHarness, /supplierMax/);
    assert.match(postgresHarness, /supplierMax\+1/);
    assert.match(postgresHarness, /'\\u0001'\.repeat\(30000\)/);
    assert.doesNotMatch(stagingProbe, /16384/);
    assert.match(stagingProbe, /262144/);
    assert.doesNotMatch(rollbackProbe, /16384/);
    assert.match(rollbackProbe, /INVALID_INPUTS/);
});
