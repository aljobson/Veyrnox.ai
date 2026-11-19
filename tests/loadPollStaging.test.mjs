import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { checkBase, parseTokens, percentile, runStage } from '../scripts/load-poll-staging.mjs';

test('only localhost and staging-labelled hosts are allowed', () => {
    for (const ok of ['http://localhost:8787', 'http://127.0.0.1:3000', 'https://veyrnox-ai-staging.example.workers.dev', 'https://staging.veyrnox.ai']) assert.equal(checkBase(ok).ok, true, ok);
    for (const bad of ['https://veyrnox.ai', 'https://www.veyrnox.ai', 'http://staging.veyrnox.ai', 'nonsense', 'https://stagingveyrnox.ai.evil.com.attacker.io']) assert.equal(checkBase(bad).ok, false, bad);
});

test('the token file keeps tokens and optional job ids, and skips blanks and comments', () => {
    const job = '11111111-2222-3333-4444-555555555555';
    assert.deepEqual(parseTokens(`# header\n\nAAA\nBBB ${job}\nCCC not-a-uuid\n`), [
        { token: 'AAA', jobId: null }, { token: 'BBB', jobId: job }, { token: 'CCC', jobId: null }]);
});

test('percentiles read from a sorted list', () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    assert.equal(percentile(sorted, 50), 50);
    assert.equal(percentile(sorted, 95), 100);
    assert.equal(percentile([], 50), null);
});

test('a stage counts requests, statuses and server errors against a local server', async () => {
    let hits = 0;
    const server = createServer((req, res) => {
        hits += 1;
        const status = hits % 5 === 0 ? 503 : hits % 7 === 0 ? 429 : 200;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end('{}');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const users = Array.from({ length: 4 }, (_, i) => ({ token: `t${i}`, jobId: null }));
        const result = await runStage({ base, users, count: 4, seconds: 1, intervalMs: 100 });
        assert.equal(result.users, 4);
        assert.ok(result.requests >= 20, `requests ${result.requests}`);
        assert.equal(Object.values(result.status).reduce((a, b) => a + b, 0) + result.timeouts, result.requests);
        assert.ok(result.status[503] > 0 && result.error_rate > 0);
        assert.equal(result.rate_limited, result.status[429] || 0);
        assert.ok(result.p95_ms >= result.p50_ms);
    } finally { server.close(); }
});
