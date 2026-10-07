import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// JSX page, so this reads the source, like createAutoShort.test.mjs.
const page = readFileSync(new URL('../app/veyrnox/app/video-agent/page.js', import.meta.url), 'utf8');
const errors = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js', import.meta.url), 'utf8');
const copyFor = (code) => { const m = errors.match(new RegExp(`^\\s*'?${code}'?:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm')); return m ? m[1] : null; };

test('the video agent page is hidden unless localStorage.veyrnox_video_agent is "1"', () => {
    assert.match(page, /const FLAG = 'veyrnox_video_agent';/);
    assert.match(page, /localStorage\.getItem\(FLAG\) === '1'/);
    assert.match(page, /This feature isn&apos;t available yet\./);
});

test('Approve sends exactly the planned brief, ticket and aspect, under the key the plan named', () => {
    assert.match(page, /idempotency_key: plan\.idempotency_key/);
    assert.match(page, /const inputs = \{ brief: plan\.brief, plan_id: plan\.plan_id, aspect_ratio: plan\.aspect \};/);
    assert.match(page, /model_id: MODEL_ID/);
    // No fresh key is ever minted for an approval: that would buy a second run.
    assert.doesNotMatch(page, /makeIdempotencyKey/);
});

test('editing the brief or aspect drops the plan, so a stale plan can never be approved', () => {
    assert.match(page, /setBrief\(e\.target\.value\); setPlan\(null\);/);
    assert.match(page, /setAspect\(a\); setPlan\(null\);/);
});

test('Approve is disabled when the plan has expired or the balance cannot cover it', () => {
    assert.match(page, /disabled=\{busy \|\| expired \|\| cannotAfford\}/);
    assert.match(page, /if \(inFlight\.current \|\| !plan \|\| expired \|\| cannotAfford\) return;/);
});

test('every code the plan route, the gateway and the runner can raise has its own copy', () => {
    for (const code of ['video_agent_unavailable', 'inputs_invalid:brief', 'plan_unavailable', 'plan_expired', 'plan_invalid',
        'plan_mismatch', 'plan_price_changed', 'plan_key_mismatch', 'video_agent_failed', 'montage_failed',
        'runner_submit_failed', 'step_not_recorded', 'step_timeout', 'output_missing', 'output_invalid']) {
        assert.ok(copyFor(code), code);
    }
    // Run failures promise a refund (failedJobCopy rewrites it until the refund lands); plan errors promise nothing was charged.
    assert.match(copyFor('montage_failed'), /Credits refunded/);
    assert.match(copyFor('plan_expired'), /Nothing was charged/);
});
