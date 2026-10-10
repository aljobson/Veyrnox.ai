import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewWindow } from '../scripts/review-staging-health-window.mjs';
import { readFileSync } from 'node:fs';

// Reuse the committed checker's count names without relying on live credentials.
const source = readFileSync(new URL('../scripts/check-staging-database-health.mjs', import.meta.url), 'utf8');
const names = [...source.match(/const RECOVERY_COUNTS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const base = { since: '2026-10-10T09:25:31Z', until: '2026-10-11T09:26:31Z', baseline_run_id: 1,
    runs: [{ databaseId: 1, createdAt: '2026-10-10T09:25:18Z', status: 'completed', conclusion: 'success' },
        { databaseId: 2, createdAt: '2026-10-11T09:25:31Z', status: 'completed', conclusion: 'success' }] };
function artifact(id) {
    return { project: 'yrqzwqywxfesmbvhzjgj', checked_at: id === 1 ? base.since : base.until,
        recovery: { counts: Object.fromEntries(names.map(n => [n, 0])), unhealthy_tasks: [], issues: [] },
        reconciliation: { balance_drift: 0, free_credit_drift: 0, top_up_drift: 0, failed_refund_drift: 0, subscription_credit_drift: 0 } };
}
test('24 elapsed hours and sparse clean samples still require gap and operator review', () => {
    const r = reviewWindow(base, artifact);
    assert.equal(r.observed_span_24_hours, true);
    assert.equal(r.largest_sampling_gap.seconds, 86460);
    assert.equal(r.operator_review_required, true);
    assert.equal(r.production_activation_authorized, false);
});
test('workflow failure cannot disappear behind a clean artifact', () => {
    const input = structuredClone(base); input.runs[1].conclusion = 'failure';
    assert.equal(reviewWindow(input, artifact).problems[0].kind, 'workflow_not_successful');
});
test('missing artifacts and UNKNOWN observations fail review', () => {
    assert.equal(reviewWindow(base, () => { throw Error(); }).problems.length, 2);
    const r = reviewWindow(base, id => { const a = artifact(id); a.recovery.counts.fal_dispatch_unknown = 2; return a; });
    assert.equal(r.problems[0].kind, 'unhealthy_observation');
});
test('wrong project, future timestamp, missing counts and unreadable flags are invalid', () => {
    for (const mutate of [a => { a.project = 'production'; }, a => { a.checked_at = '2026-10-12T00:00:00Z'; },
        a => { delete a.reconciliation.balance_drift; }, a => { a.recovery = { unreadable: true }; }]) {
        assert.equal(reviewWindow(base, id => { const a = artifact(id); mutate(a); return a; }).problems[0].kind, 'invalid_artifact');
    }
});
test('elapsed window alone cannot supply observations and baseline must be inventoried', () => {
    const r = reviewWindow({ ...base, runs: [] }, artifact);
    assert.equal(r.elapsed_24_hours, true); assert.equal(r.observed_span_24_hours, false);
    assert.equal(r.problems[0].kind, 'baseline_missing_from_inventory');
});
test('incomplete window, duplicate and unsafe run identifiers cannot pass', () => {
    const r = reviewWindow({ ...base, until: '2026-10-10T09:30:00Z', runs: [base.runs[0]] }, artifact);
    assert.equal(r.observed_span_24_hours, false);
    assert.throws(() => reviewWindow({ ...base, runs: [base.runs[0], base.runs[0]] }, artifact));
    assert.throws(() => reviewWindow({ ...base, runs: [{ ...base.runs[0], databaseId: '../escape' }] }, artifact));
});
