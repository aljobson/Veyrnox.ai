import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
const directory = new URL('../packages/db/schema/supabase/', import.meta.url);
const migrationName = '0396_multi_reference_identity.sql';
const migration = readFileSync(new URL(migrationName, directory), 'utf8');
const guard = `        IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = v_existing AND
            (j.model_id IS DISTINCT FROM p_model_id OR
             NOT private.generation_request_matches(j.inputs, p_inputs))) THEN
            RETURN jsonb_build_object('ok', false, 'code', 'IDEMPOTENCY_CONFLICT');
        END IF;
`;
for (const [name, count] of [['ledger_debit_for_admission', 2], ['submit_free_job_for_admission', 1]]) {
  test(`0396 ${name} differs from the latest prior definition only at replay guards`, () => {
    const pattern = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+private\\.${name}\\([\\s\\S]*?END\\s+\\$\\$;`, 'i');
    // Sort explicitly: do not rely on directory enumeration order.
    const latest = readdirSync(directory).filter(file=>file.endsWith('.sql') && file < migrationName).sort().reverse()
      .map(file=>({file,body:readFileSync(new URL(file,directory),'utf8').match(pattern)?.[0]})).find(row=>row.body);
    assert.ok(latest);
    assert.equal(latest.file,'0274_generation_hold_admission.sql');
    const actual = migration.match(pattern)?.[0];
    assert.ok(actual);
    const insertion = name.startsWith('ledger') ? `        IF p_reason IN ('debit:generation', 'debit:chat') THEN\n${guard}        END IF;\n` : guard;
    assert.equal(actual.split(insertion).length - 1,count,'only the intended replay insertion sites');
    assert.equal(actual.replaceAll(insertion,''),latest.body,'locks, holds, spend order, allowance and accounting bodies remain byte-identical');
  });
}
