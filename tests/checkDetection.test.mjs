// scripts/check-detection.mjs (ADR-0310): reads the service-role-only
// security_detection_status() and decides healthy / needs-attention / unreadable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchDetectionStatus, evaluate, STALE_LIMIT_SECONDS } from '../scripts/check-detection.mjs';

const cfg = { url: 'https://example.invalid', key: 'service-role' };

function withRow(row, fn) {
    const real = globalThis.fetch;
    globalThis.fetch = async () => Response.json(row);
    try { return fn(); } finally { globalThis.fetch = real; }
}

const base = {
    ok: true,
    last_run_at: '2026-10-31T12:00:00Z',
    seconds_since_run: 120,
    open_critical: 0,
    open_high: 0,
    open_high_or_critical: 0,
    open_alerts: [],
};

test('reads the status fields into a normalized snapshot', async () => {
    const snap = await withRow(base, () => fetchDetectionStatus(cfg));
    assert.deepEqual(snap, {
        lastRunAt: '2026-10-31T12:00:00Z', secondsSinceRun: 120,
        openCritical: 0, openHigh: 0, openHighOrCritical: 0, openAlerts: [],
    });
});

test('a recent run with no open high/critical alert is healthy', () => {
    assert.equal(evaluate({ secondsSinceRun: 300, openCritical: 0, openHigh: 0, openHighOrCritical: 0, openAlerts: [] }).code, 0);
});

test('a stale engine needs attention', () => {
    const r = evaluate({ secondsSinceRun: STALE_LIMIT_SECONDS + 1, openCritical: 0, openHigh: 0, openHighOrCritical: 0, openAlerts: [] });
    assert.equal(r.code, 1);
    assert.ok(r.reasons.includes('engine_silent'));
});

test('an engine that never ran needs attention', () => {
    const r = evaluate({ secondsSinceRun: null, openCritical: 0, openHigh: 0, openHighOrCritical: 0, openAlerts: [] });
    assert.equal(r.code, 1);
    assert.ok(r.reasons.includes('engine_silent'));
});

test('an open high/critical alert needs attention even when the engine is live', () => {
    const r = evaluate({
        secondsSinceRun: 60, openCritical: 1, openHigh: 2, openHighOrCritical: 3,
        openAlerts: [{ severity: 'critical', rule_id: 'SEC-005', entity: 'u1', event_count: 1, last_seen: 'x' }],
    });
    assert.equal(r.code, 1);
    assert.ok(r.reasons.includes('open_high_alert'));
});

test('both a silent engine and an open alert are reported together', () => {
    const r = evaluate({ secondsSinceRun: null, openCritical: 0, openHigh: 1, openHighOrCritical: 1, openAlerts: [] });
    assert.deepEqual(new Set(r.reasons), new Set(['engine_silent', 'open_high_alert']));
});

test('a non-ok or missing row is unreadable, not a pass', async () => {
    await assert.rejects(withRow({ ok: false }, () => fetchDetectionStatus(cfg)), /returned no row/);
    await assert.rejects(withRow([], () => fetchDetectionStatus(cfg)), /returned no row/);
});

test('an http error is unreadable', async () => {
    const real = globalThis.fetch;
    globalThis.fetch = async () => new Response('nope', { status: 503 });
    try { await assert.rejects(fetchDetectionStatus(cfg), /answered 503/); } finally { globalThis.fetch = real; }
});

test('malformed counts or a negative age are rejected', async () => {
    for (const bad of [{ ...base, open_high: '0' }, { ...base, open_critical: -1 }, { ...base, seconds_since_run: -5 }, { ...base, open_high_or_critical: 1.5 }]) {
        await assert.rejects(withRow(bad, () => fetchDetectionStatus(cfg)), /was not a/);
    }
});
