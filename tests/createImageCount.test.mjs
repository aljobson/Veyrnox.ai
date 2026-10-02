import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// JSX page and a React hook, so this reads the source, like uploadConsent.test.mjs.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = read('../app/veyrnox/app/create/page.js');
const hook = read('../app/veyrnox/_lib/useStudioJobs.js');
const grid = read('../app/veyrnox/_components/StudioJobGrid.js');

const submit = page.slice(page.indexOf('async function onSubmit()'), page.indexOf('function cancel()'));
const sendOne = submit.slice(submit.indexOf('await sendInOrder('));

test('the IMAGES control is shown for image models only', () => {
    assert.match(page, /\{takesImageCount\(model\) && \(\s*<ControlRow label="IMAGES" options=\{IMAGE_COUNTS\} value=\{count\} onChange=\{setCount\} \/>/);
    assert.equal((page.match(/label="IMAGES"/g) || []).length, 1);
    assert.match(page, /const n = imageCount\(model, count\);/);
});

test('the total drives the price, the balance guard and the button', () => {
    assert.match(page, /const cost = totalCost\(unitCost, n\);/);
    assert.match(submit, /cost > balance\) return;/);
    assert.match(page, /balance == null \|\| cost > balance \|\| missingSource/);
    assert.match(page, />−\{cost\} cr<\/div>/);
    assert.match(page, /for \$\{cost\} credits/);
});

test('each source is uploaded once, before any request, and reused by all', () => {
    assert.ok(submit.length > 0 && sendOne.length > 0, 'submit and its sendInOrder found');
    assert.equal((submit.match(/uploadSource\(/g) || []).length, 1, 'one upload call site');
    assert.ok(submit.indexOf('uploadSource(') < submit.indexOf('await sendInOrder('), 'uploads come first');
    assert.equal(sendOne.includes('uploadSource('), false, 'no upload inside the per-request callback');
    assert.match(sendOne, /source_keys: source_keys\.length \? source_keys : undefined,/);
    assert.match(sendOne, /source_assets: source_assets\.length \? source_assets : undefined,/);
});

test('N idempotency keys are minted up front, one per request', () => {
    assert.match(submit, /const keys = Array\.from\(\{ length: n \}, \(\) => makeIdempotencyKey\(\)\);/);
    assert.equal((page.match(/makeIdempotencyKey\(\)/g) || []).length, 1, 'no other key is ever minted');
    assert.ok(submit.indexOf('const keys =') < submit.indexOf('await sendInOrder('));
    assert.match(sendOne, /idempotency_key: keys\[i\], inputs: inputsForIndex\(inputs, i, n\),/);
    // The double-click guard still holds for the whole batch.
    assert.match(submit, /if \(inFlight\.current \|\| sending \|\| generating/);
});

test('requests go one at a time and the first failure stops the rest', () => {
    assert.match(submit, /const \{ started, error: failure \} = await sendInOrder\(n, async \(i\) => \{/);
    assert.equal(/Promise\.(all|allSettled|race|any)\(/.test(page), false, 'never sent in parallel');
    assert.match(submit, /if \(failure\) setError\(\{ \.\.\.errorFor\(failure\), note: batchNote\(started, n\) \}\);/);
    assert.match(page, /\{error\.note && ` \$\{error\.note\}`\}/);
    // Every accepted job is tracked, recorded, and priced per unit.
    assert.match(sendOne, /addJob\(\{ job_id: submitted\.job_id, state: 'queued', credits: unitCost, model_id: modelId \}\);/);
    assert.match(sendOne, /pushJobHistory\(\{/);
    assert.match(sendOne, /setBalance\(submitted\.balance_after\);/);
});

test('one interval polls every in-flight job and keeps the give-up', () => {
    assert.equal((hook.match(/setInterval\(/g) || []).length, 1);
    assert.match(hook, /export const POLL_GIVE_UP_AFTER = 30;/);
    assert.match(hook, /const POLL_MS = 2000;/);
    assert.match(hook, /markJobSettled\(id, next\.state\);/);
    assert.match(hook, /notifyBalanceChanged\(\);/);
    assert.match(hook, /gatewayFetch\(`\/jobs\/\$\{id\}\/asset`\)/);
    assert.match(page, /setError\(\{ code: 'poll_unreachable' \}\)/);
});

test('one job keeps the single canvas; more get the grid', () => {
    assert.match(page, /const job = jobs\.length === 1 \? jobs\[0\] : null;/);
    assert.match(page, /\{jobs\.length > 1 \? <StudioJobGrid jobs=\{jobs\} aspect=\{aspect\} \/> : \(/);
    assert.match(grid, /grid grid-cols-2/);
    assert.match(grid, /STATE_UI\[job\.state\]/);
    assert.match(grid, /<JobAssetPreview job=\{job\} \/>/);
    // New generation clears every job and claims no cancelled charge.
    assert.match(page, /function cancel\(\) \{\s*clearJobs\(\);\s*setError\(null\);\s*\}/);
});
