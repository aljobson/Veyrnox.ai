import test from 'node:test';
import assert from 'node:assert/strict';
import { stagingConfig, recoveryCounts, checkStagingDatabase } from '../scripts/check-staging-database-health.mjs';

const config = { url: 'https://yrqzwqywxfesmbvhzjgj.supabase.co', key: 'public-test-key' };
const recovery = { stale_jobs: 0, reap_overdue: 0, reap_exhausted: 0,
    stale_top_up_returns: 0, unreviewed_flagged_orders: 0, unreviewed_order_collisions: 0,
    cinema_poll_overdue: 0, cinema_poll_failed: 0, cinema_provisioning_stuck: 0,
    cinema_processing_stuck: 0, cinema_cleanup_required: 0,
    fal_dispatch_unknown: 0, fal_dispatch_overdue: 0, unhealthy_tasks: [] };
const reconciliation = { balance_drift: 0, free_credit_drift: 0, top_up_drift: 0,
    failed_refund_drift: 0, subscription_credit_drift: 0, free_allowance_drift: 0, referral_drift: 0 };

test('staging targeting cannot fall back to production configuration', () => {
    assert.throws(() => stagingConfig({ vars: { SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.key } }));
    const scoped = vars => ({ env: { staging: { vars } } });
    assert.deepEqual(stagingConfig(scoped({ SUPABASE_URL: config.url, NEXT_PUBLIC_SUPABASE_ANON_KEY: config.key })), config);
    assert.throws(() => stagingConfig(scoped({ SUPABASE_URL: 'https://xdxdzmsztyzbnzeforxx.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: config.key })));
});

test('staging requires dispatch and Cinema counts rather than treating missing fields as healthy', () => {
    for (const field of ['fal_dispatch_unknown', 'cinema_poll_failed']) {
        const incomplete = { ...recovery }; delete incomplete[field];
        assert.throws(() => recoveryCounts(incomplete));
    }
    assert.throws(() => recoveryCounts({ ...recovery, fal_dispatch_overdue: null }));
    assert.throws(() => recoveryCounts({ ...recovery, unhealthy_tasks: ['arbitrary server text'] }));
});

test('healthy reads retain only bounded counts and an observation timestamp', async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url: String(url), method: options.method, body: options.body });
        return Response.json(String(url).endsWith('recovery_status') ? { ...recovery, unexpected: 'must not persist' } : [reconciliation]);
    });
    const result = await checkStagingDatabase(config);
    assert.equal(result.exit, 0);
    assert.match(result.evidence.checked_at, /^\d{4}-/);
    assert.equal(result.evidence.project, 'yrqzwqywxfesmbvhzjgj');
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.url.startsWith(config.url + '/rest/v1/rpc/') && call.method === 'POST' && call.body === '{}'));
    assert.doesNotMatch(JSON.stringify(result), /must not persist|public-test-key/);
});

test('dispatch UNKNOWN and ledger drift fail without hiding either diagnostic', async t => {
    t.mock.method(globalThis, 'fetch', async url => Response.json(String(url).endsWith('recovery_status')
        ? { ...recovery, fal_dispatch_unknown: 1 } : [{ ...reconciliation, balance_drift: 2 }]));
    const result = await checkStagingDatabase(config);
    assert.equal(result.exit, 1);
    assert.match(result.reports.join('\n'), /fal_dispatch_unknown: 1/);
    assert.match(result.reports.join('\n'), /balance_drift: 2/);
});

test('unreadable recovery still checks reconciliation and suppresses remote error text', async t => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async url => {
        calls++;
        if (String(url).endsWith('recovery_status')) throw Error('sensitive transport details');
        return Response.json([{ ...reconciliation, failed_refund_drift: 1 }]);
    });
    const result = await checkStagingDatabase(config);
    assert.equal(calls, 2);
    assert.equal(result.exit, 2);
    assert.match(result.reports.join('\n'), /failed_refund_drift: 1/);
    assert.doesNotMatch(JSON.stringify(result), /sensitive transport details/);
});

test('stale HTTP response or malformed reconciliation never passes', async t => {
    t.mock.method(globalThis, 'fetch', async url => String(url).endsWith('recovery_status')
        ? new Response('private body', { status: 500 }) : Response.json([{ ...reconciliation, balance_drift: null }]));
    const result = await checkStagingDatabase(config);
    assert.equal(result.exit, 2);
    assert.deepEqual(result.evidence.recovery, { unreadable: true });
    assert.deepEqual(result.evidence.reconciliation, { unreadable: true });
    assert.doesNotMatch(JSON.stringify(result), /private body/);
});
