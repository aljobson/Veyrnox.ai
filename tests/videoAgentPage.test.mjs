import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pickResumable } from '../app/veyrnox/_lib/videoAgentResume.js';

// JSX page, so this reads the source, like createAutoShort.test.mjs.
const page = readFileSync(new URL('../app/veyrnox/app/video-agent/page.js', import.meta.url), 'utf8');
const errors = readFileSync(new URL('../app/veyrnox/_lib/createErrors.js', import.meta.url), 'utf8');
const copyFor = (code) => { const m = errors.match(new RegExp(`^\\s*'?${code}'?:\\s*'((?:[^'\\\\]|\\\\.)*)'`, 'm')); return m ? m[1] : null; };

test('the video agent page is open to every signed-in user and has its own tab (rollout step 9)', () => {
    // No browser switch any more: the server flag AGENT_VIDEO_ENABLED is the only gate, and the plan route answers
    // video_agent_unavailable (with its own copy) when that is off.
    assert.doesNotMatch(page, /veyrnox_video_agent/);
    assert.doesNotMatch(page, /isn&apos;t available yet/);
    assert.match(page, /<AppNav balance=\{balance\} active="agent" \/>/);
    const nav = readFileSync(new URL('../app/veyrnox/_components/NavBar.js', import.meta.url), 'utf8');
    assert.match(nav, /\{ key: 'agent', href: '\/app\/video-agent', label: 'Video agent' \}/);
    assert.ok(copyFor('video_agent_unavailable'));
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
        'runner_submit_failed', 'step_not_recorded', 'step_timeout', 'run_lost', 'output_missing', 'output_invalid',
        'video_agent_busy', 'video_agent_offline', 'video_agent_in_progress', 'brief_refused']) {
        assert.ok(copyFor(code), code);
    }
    // Run failures promise a refund (failedJobCopy rewrites it until the refund lands); plan errors promise nothing was charged.
    assert.match(copyFor('montage_failed'), /Credits refunded/);
    assert.match(copyFor('plan_expired'), /Nothing was charged/);
    assert.match(copyFor('video_agent_busy'), /Nothing was charged/);
    assert.match(copyFor('video_agent_offline'), /Nothing was charged/);
    assert.match(copyFor('video_agent_in_progress'), /Nothing was charged/);
    assert.match(copyFor('brief_refused'), /Credits refunded/);
    // The copy names every rule the runner's agent refuses on (runner/agent.py), so a refused user can see which one applied.
    for (const rule of [/real, named people/, /minors/, /sexual/, /violence/, /self-harm/, /hatred/, /artist/, /brand/]) assert.match(copyFor('brief_refused'), rule);
});

test('after a reload the page resumes the newest unsettled video-agent job from this browser\'s history', () => {
    assert.match(page, /const pending = pickResumable\(jobsToWatch\(readJobHistory\(\)\), MODEL_ID\);/);
    assert.match(page, /if \(pending\) startJobs\(pending\);/);
    // once per mount
    assert.match(page, /if \(resumed\.current\) return;/);
});

test('pickResumable takes the newest matching job and ignores other models and bad rows', () => {
    const rows = [
        { job_id: 'img-1', model_id: 'flux-2-pro', credits: 2 },
        { job_id: 'va-new', model_id: 'video-agent', credits: 165 },
        { job_id: 'va-old', model_id: 'video-agent', credits: 165 },
    ];
    assert.deepEqual(pickResumable(rows, 'video-agent'), { job_id: 'va-new', state: 'queued', credits: 165, model_id: 'video-agent' });
    assert.equal(pickResumable([{ job_id: 'img-1', model_id: 'flux-2-pro' }], 'video-agent'), null);
    assert.equal(pickResumable([{ model_id: 'video-agent' }, null, { job_id: '', model_id: 'video-agent' }], 'video-agent'), null);
    assert.equal(pickResumable(undefined, 'video-agent'), null);
    assert.equal(pickResumable([{ job_id: 'x', model_id: 'video-agent', credits: 'abc' }], 'video-agent').credits, 0);
});
