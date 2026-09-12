import test from 'node:test';
import assert from 'node:assert/strict';

const { unaccounted, descriptiveName } = await import('../scripts/check-migration-ledger.mjs');

const file = (name, text = '') => ({ name, text });

test('descriptiveName strips the phase prefix, the number and the extension', () => {
    assert.equal(descriptiveName('phase1_0006_ledger_rpc_functions'), 'ledger_rpc_functions');
    assert.equal(descriptiveName('0018_floor_pricing_and_veo_fast'), 'floor_pricing_and_veo_fast');
    assert.equal(descriptiveName('0020_floor_pricing_and_veo_fast.sql'), 'floor_pricing_and_veo_fast');
});

test('a renumbered file still accounts for its applied name', () => {
    // The database kept 0018_…; the repository renumbered it to 0020_….
    const repo = [file('0020_floor_pricing_and_veo_fast.sql')];
    assert.deepEqual(unaccounted(['0018_floor_pricing_and_veo_fast'], repo), []);
});

test('an applied migration with no file is reported', () => {
    const repo = [file('0032_admin_flag_and_ops_metrics.sql')];
    assert.deepEqual(unaccounted(['0033_nano_banana_endpoint'], repo), ['0033_nano_banana_endpoint']);
});

test('a documented fold is accounted for by its full applied name', () => {
    const repo = [file('0032_admin_flag_and_ops_metrics.sql',
        '--   0032_ops_metrics_p95_stored_only   (folded into the function body below)')];
    assert.deepEqual(unaccounted(['0032_ops_metrics_p95_stored_only'], repo), []);
});

test('a fold named in the README counts too', () => {
    const repo = [
        file('0006_ledger_rpc_functions.sql'),
        file('README.md', '| `phase1_0006_ledger_rpc_functions_perm_fix` | folded into 0006 |'),
    ];
    assert.deepEqual(unaccounted(['phase1_0006_ledger_rpc_functions_perm_fix'], repo), []);
});

test('a descriptive name mentioned only in passing does not count as a fold', () => {
    // Only the FULL applied name documents a fold. A stray mention of the
    // suffix — say in a comment about something else — must not hide a gap.
    const repo = [file('0015_reactivate.sql', 'nano_banana_endpoint was fine at the time')];
    assert.deepEqual(unaccounted(['0033_nano_banana_endpoint'], repo), ['0033_nano_banana_endpoint']);
});

test('the live ledger as of 2026-09-12 has exactly the two gaps this change closes', () => {
    // Names from supabase_migrations.schema_migrations, abridged to the
    // entries that exercise each rule, against the repository before the fix.
    const applied = [
        'phase1_0006_ledger_rpc_functions',
        'phase1_0006_ledger_rpc_functions_perm_fix',
        '0018_floor_pricing_and_veo_fast',
        '0031_admin_flag_and_ops_metrics',
        '0032_ops_metrics_p95_stored_only',
        '0033_nano_banana_endpoint',
    ];
    const before = [
        file('0006_ledger_rpc_functions.sql'),
        file('0020_floor_pricing_and_veo_fast.sql'),
        file('0032_admin_flag_and_ops_metrics.sql', '0032_ops_metrics_p95_stored_only (folded)'),
    ];
    assert.deepEqual(unaccounted(applied, before), [
        'phase1_0006_ledger_rpc_functions_perm_fix',
        '0033_nano_banana_endpoint',
    ]);
});
