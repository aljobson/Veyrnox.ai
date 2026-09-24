import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCatalogUpdates } from '../scripts/check-catalog-update-guards.mjs';
import { readFileSync } from 'node:fs';

const file = '0112_catalog_fix.sql';
const update = "UPDATE public.model_catalog SET active = true WHERE id = 'model';";
const guard = "GET DIAGNOSTICS affected = ROW_COUNT; IF affected <> 1 THEN RAISE EXCEPTION 'Expected one row, got %', affected; END IF;";
const check = (sql, name = file) => checkCatalogUpdates(sql, name);

test('the documented DO block follows the enforced convention', () => {
    const docs = readFileSync(new URL('../packages/db/schema/supabase/README.md', import.meta.url), 'utf8');
    const sql = docs.match(/```sql\n([\s\S]*?)```/)[1];
    assert.deepEqual(check(sql), []);
});
test('new bare updates fail with their filename and line; historical files stay immutable', () => {
    assert.match(check('\n' + update)[0], /^0112_catalog_fix.sql:2:/);
    assert.equal(check(update, '0111_first_new.sql').length, 1);
    assert.deepEqual(check(update, '0110_applied.sql'), []);
    assert.deepEqual(check(update, '0104_kie_rows_at_floor.sql'), []);
});
test('every UPDATE needs its own immediate guard', () => {
    assert.deepEqual(check(update + guard + update + guard), []);
    assert.equal(check(update + guard + update).length, 1);
    assert.equal(check(update + update + guard).length, 1);
    assert.equal(check(update + ' PERFORM 1; ' + guard).length, 1);
});
test('accepts quoted targets, aliases, ONLY, tagged bodies and exact batch counts', () => {
    for (const target of ['model_catalog', 'public.model_catalog AS m', 'ONLY public.model_catalog', '"public"."model_catalog"']) {
        const sql = `DO $guard$ DECLARE affected BIGINT; BEGIN UPDATE ${target} SET active = false; ${guard} END $guard$;`;
        assert.deepEqual(check(sql), [], target);
    }
    assert.deepEqual(check(update + guard.replace('= ROW_COUNT', ':= ROW_COUNT').replace('<> 1', '!= 12')), []);
});
test('guards must check the captured variable, an exact positive count and raise an exception', () => {
    for (const bad of [guard.replace('IF affected', 'IF other'), guard.replace('<> 1', '= 1'),
        guard.replace('<> 1', '<> 0'), guard.replace('<> 1', '< 1'), guard.replace('EXCEPTION', 'NOTICE'),
        guard.replace('THEN RAISE', 'THEN IF false THEN RAISE'), guard.replace('END IF;', '')]) {
        assert.equal(check(update + bad).length, 1, bad);
    }
});
test('comments and string contents cannot masquerade as a guard', () => {
    for (const fake of [`-- ${guard}\n`, `/* nested /* inner */ ${guard} */`, `RAISE NOTICE '${guard.replaceAll("'", "''")}';`]) {
        assert.equal(check(update + fake).length, 1);
    }
    assert.deepEqual(check(`${update} /* fine */ ${guard}`), []);
});
test('ordinary SQL strings and comments containing UPDATE text are ignored', () => {
    assert.deepEqual(check(`-- ${update}\n/* ${update} */ SELECT '${update.replaceAll("'", "''")}';`), []);
    assert.deepEqual(check("UPDATE public.jobs SET error_code = 'UPDATE public.model_catalog;';"), []);
    assert.deepEqual(check("INSERT INTO public.model_catalog(id) VALUES ('x') ON CONFLICT(id) DO UPDATE SET active = false;"), []);
});
test('semicolons inside values do not terminate an UPDATE and malformed quotes fail closed', () => {
    assert.deepEqual(check("UPDATE public.model_catalog SET display_name = 'it''s a; title';" + guard), []);
    for (const bad of ["DO $$ BEGIN " + update, "/* never closed", "SELECT 'never closed"]) {
        assert.match(check(bad)[0], /unterminated/);
    }
});
