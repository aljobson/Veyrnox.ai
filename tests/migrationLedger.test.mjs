import test from 'node:test';
import assert from 'node:assert/strict';

const { unaccounted, descriptiveName, parseJsonc, namesFromRpc } = await import('../scripts/check-migration-ledger.mjs');
const { readFileSync } = await import('node:fs');

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

test('parseJsonc reads the committed wrangler.jsonc', () => {
    // The real file: full-line comments, '//' inside URLs, and a comment block
    // after the last property that leaves a trailing comma once stripped.
    const cfg = parseJsonc(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
    assert.match(cfg.vars.SUPABASE_URL, /^https:\/\/[a-z0-9]+\.supabase\.co$/);
    assert.ok(cfg.vars.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'publishable key present');
});

test('parseJsonc keeps URLs intact and drops the dangling comma', () => {
    const text = [
        '{',
        '  // a comment',
        '  "url": "https://example.supabase.co",',
        '  "vars": { "a": 1 },',
        '  // trailing comment block',
        '}',
    ].join('\n');
    assert.deepEqual(parseJsonc(text), { url: 'https://example.supabase.co', vars: { a: 1 } });
});

test('namesFromRpc maps PostgREST rows and rejects a malformed body', () => {
    assert.deepEqual(namesFromRpc([{ name: 'a' }, { name: 'b' }]), ['a', 'b']);
    // An error body or wrong shape must throw, so the CLI exits 2 ("could not
    // check") instead of comparing nothing and reporting a false pass.
    assert.throws(() => namesFromRpc({ message: 'permission denied' }));
    assert.throws(() => namesFromRpc([{ id: 1 }]));
});
