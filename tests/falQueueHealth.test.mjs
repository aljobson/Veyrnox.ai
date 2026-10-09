import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessQueueMetrics, checkFalQueueHealth, STAGING_QUEUES } from '../scripts/check-fal-queue-health.mjs';

const NOW = 1_800_000_000_000;
const empty = { backlog_count: 0, backlog_bytes: 0, oldest_message_timestamp_ms: 0 };
const backlog = age => ({ backlog_count: 2, backlog_bytes: 120, oldest_message_timestamp_ms: NOW - age });
const secret = 'private-test-token';
function fixture({ metrics = [empty, empty], override } = {}) {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url, options });
        const index = STAGING_QUEUES.findIndex(queue => url.includes(`/${queue.id}`));
        assert.notEqual(index, -1);
        const queue = STAGING_QUEUES[index];
        if (override) {
            const response = await override({ url, index });
            if (response) return response;
        }
        const result = url.endsWith('/metrics') ? metrics[index] : { queue_id: queue.id, queue_name: queue.name };
        return { ok: true, json: async () => ({ success: true, errors: [], result }) };
    };
    return { calls, run: () => checkFalQueueHealth({ token: secret, fetchImpl, now: () => NOW }) };
}

test('empty snapshot uses only fixed-account GETs and never consumes messages', async () => {
    const { calls, run } = fixture();
    const result = await run();
    assert.equal(result.exitCode, 0);
    assert.equal(calls.length, 4);
    for (const { url, options } of calls) {
        assert.match(url, /^https:\/\/api.cloudflare.com\/client\/v4\/accounts\/fb18d9f7052afbea5a5e0eae69948af2\/queues\/[a-f0-9]+(?:\/metrics)?$/);
        assert.equal(options.method, 'GET');
        assert.equal(options.redirect, 'error');
        assert.ok(options.signal instanceof AbortSignal);
        assert.equal(options.body, undefined);
    }
    assert.doesNotMatch(result.report, /private-test-token/);
});

test('source backlog trips at five minutes, while any DLQ count trips immediately', async () => {
    assert.equal((await fixture({ metrics: [backlog(299_999), empty] }).run()).exitCode, 0);
    assert.equal((await fixture({ metrics: [backlog(300_000), empty] }).run()).exitCode, 1);
    const dlq = await fixture({ metrics: [empty, { ...empty, backlog_count: 1 }] }).run();
    assert.equal(dlq.exitCode, 1);
    assert.match(dlq.report, /staging-dlq: backlog=1.*INVESTIGATE/);
});

test('unknown or invalid source age cannot produce a healthy result', async () => {
    for (const metrics of [
        { ...empty, backlog_count: 1 },
        { ...backlog(0), oldest_message_timestamp_ms: NOW + 5_001 },
        { ...empty, backlog_count: -1 },
        { ...empty, backlog_count: '0' },
        { ...empty, backlog_bytes: NaN },
        { ...empty, oldest_message_timestamp_ms: undefined },
    ]) assert.equal((await fixture({ metrics: [metrics, empty] }).run()).exitCode, 2);
    assert.equal(assessQueueMetrics(backlog(-1_000), { dlq: false, now: NOW }).ageSeconds, 0);
});

test('wrong queue identity blocks metrics access for that queue', async () => {
    const { calls, run } = fixture({ override: ({ url, index }) => index === 0 && !url.endsWith('/metrics') ?
        { ok: true, json: async () => ({ success: true, result: { queue_id: STAGING_QUEUES[0].id, queue_name: 'production' } }) } : null });
    assert.equal((await run()).exitCode, 2);
    assert.ok(!calls.some(call => call.url.endsWith(`${STAGING_QUEUES[0].id}/metrics`)));
});

test('access and transport failures are redacted; independent DLQ evidence survives', async () => {
    for (const failure of ['http', 'transport', 'json', 'envelope']) {
        const { run } = fixture({ metrics: [empty, backlog(1_000)], override: ({ index }) => {
            if (index !== 0) return null;
            if (failure === 'transport') throw Error(secret);
            return { ok: failure !== 'http', json: async () => {
                if (failure === 'json') throw Error(secret);
                return { success: false, errors: [{ message: secret }], result: empty };
            } };
        } });
        const result = await run();
        assert.equal(result.exitCode, 2);
        assert.doesNotMatch(result.report, /private-test-token/);
        assert.match(result.report, /staging-dlq: backlog=2.*INVESTIGATE/);
    }
});

test('missing credentials fail closed without a network request', async () => {
    const result = await checkFalQueueHealth({ fetchImpl: () => { throw Error('must not fetch'); } });
    assert.equal(result.exitCode, 2);
});

test('diagnostic workflow is manual, protected, current-main-only and has no deploy or issue writes', () => {
    const workflow = readFileSync(new URL('../.github/workflows/fal-queue-health-staging.yml', import.meta.url), 'utf8');
    assert.match(workflow, /workflow_dispatch:/);
    assert.match(workflow, /environment: fal-dispatch-staging/);
    assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
    assert.match(workflow, /git rev-parse origin\/main/);
    assert.doesNotMatch(workflow, /schedule:|issues:|pull_request_target:|wrangler deploy|SUPABASE_SERVICE_ROLE_KEY|FAL_KEY/);
});
