import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCoverage, coverageConfig } from '../scripts/check-migration-coverage.mjs';

test('explicit environment identity prevents a staging audit reading production', () => {
    const production = { SUPABASE_URL: 'https://xdxdzmsztyzbnzeforxx.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'prod-public' };
    const staging = { SUPABASE_URL: 'https://yrqzwqywxfesmbvhzjgj.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'stage-public' };
    const config = { vars: production, env: { staging: { vars: staging } } };
    assert.equal(coverageConfig(config, 'staging').key, 'stage-public');
    assert.equal(coverageConfig(config, 'production').key, 'prod-public');
    assert.throws(() => coverageConfig(config));
    assert.throws(() => coverageConfig({ vars: production }, 'staging'));
    assert.throws(() => coverageConfig({ ...config, env: { staging: { vars: production } } }, 'staging'));
});

test('coverage detects an older missing receipt even when the applied ledger is accounted for', () => {
    const files = ['0001_first.sql', '0002_second.sql', '0003_third.sql'].map(name => ({ name, text: '' }));
    assert.deepEqual(assessCoverage(['0001_first', '0003_third'], files), {
        missing_receipts: ['0002_second.sql'], reconciled_receipts: [], unaccounted_receipts: [], complete: false,
    });
    assert.equal(assessCoverage(['0001_first', '0002_second', '0003_third', '0004_uncommitted'], files).complete, false);
});

test('coverage shares the apply planner rules for renamed, batched and explicit historical receipts', () => {
    const files = [
        { name: '0001_first.sql', text: '' }, { name: '0002_second.sql', text: '' },
        { name: '0003_renamed.sql', text: '' },
        { name: '0004_fourth.sql', text: '-- Applied name: 0020_historical_fourth' },
    ];
    assert.deepEqual(assessCoverage(['0001_0002_replay', 'phase1_0010_renamed', '0020_historical_fourth'], files), {
        missing_receipts: [], reconciled_receipts: [], unaccounted_receipts: [], complete: true,
    });
    assert.equal(assessCoverage(['0001_0005_incomplete_replay'], files).complete, false);
});

// Read-only history reconciliation must not relax production apply ordering.
import { pendingMigrations } from '../scripts/apply-migrations.mjs';

test('only an applied, explicitly declared newer repair reconciles an absent old receipt', () => {
    const files = [
        { name: '0222_starting_values.sql', text: '' },
        { name: '0262_replay_safe.sql', text: '-- Reconciles migration: 0222_starting_values' },
    ];
    assert.equal(assessCoverage([], files).complete, false);
    assert.equal(assessCoverage(['0222_starting_values'], files).complete, false);
    assert.deepEqual(assessCoverage(['0262_replay_safe'], files), {
        missing_receipts: [],
        reconciled_receipts: [{ migration: '0222_starting_values.sql', reconciled_by: '0262_replay_safe.sql' }],
        unaccounted_receipts: [], complete: true,
    });
    assert.throws(() => pendingMigrations(['0262_replay_safe'], files), /out of order/);
    assert.equal(assessCoverage(['0262_replay_safe', 'uncommitted_hotfix'], files).complete, false);
});

test('forward reconciliation ignores prose, backwards declarations and missing source targets', () => {
    const old = { name: '0222_starting_values.sql', text: '' };
    assert.equal(assessCoverage(['0262_replay_safe'], [old,
        { name: '0262_replay_safe.sql', text: 'This repairs 0222_starting_values' }]).complete, false);
    assert.equal(assessCoverage(['0200_backwards'], [old,
        { name: '0200_backwards.sql', text: '-- Reconciles migration: 0222_starting_values' }]).complete, false);
    assert.equal(assessCoverage(['0262_replay_safe'], [old,
        { name: '0262_replay_safe.sql', text: '-- Reconciles migration: 0221_other' }]).complete, false);
    assert.throws(() => assessCoverage(['0262_replay_safe', '0263_alternative'], [old,
        { name: '0262_replay_safe.sql', text: '-- Reconciles migration: 0222_starting_values' },
        { name: '0263_alternative.sql', text: '-- Reconciles migration: 0222_starting_values' }]), /Ambiguous/);
});
