import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// JSX page and a React hook, so this reads the source, like uploadConsent.test.mjs.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = read('../app/veyrnox/app/create/page.js');
const hook = read('../app/veyrnox/_lib/useStudioJobs.js');
const grid = read('../app/veyrnox/_components/StudioJobGrid.js');
const errors = read('../app/veyrnox/_lib/createErrors.js');

const submit = page.slice(page.indexOf('async function onSubmit()'), page.indexOf('function cancel()'));
const sendOne = submit.slice(submit.indexOf('await sendInOrder('));

test('the IMAGES control is shown for image models only', () => {
    assert.match(page, /\{takesImageCount\(model\) && \(\s*<ControlRow label="IMAGES" options=\{IMAGE_COUNTS\} value=\{count\} onChange=\{setCount\} \/>/);
    assert.equal((page.match(/label="IMAGES"/g) || []).length, 1);
    assert.match(page, /const n = imageCount\(model, count\);/);
});

test('the total drives the price, the balance guard and the button', () => {
    // The batch total still drives the price; ADR-0069 waives the first `freeLeft` jobs of it when the server says so.
    assert.match(page, /const cost = freeLeft > 0 \? freeCost\(unitCost, n, freeLeft\) : totalCost\(unitCost, n\);/);
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
    assert.match(submit, /const code = submitErrorCode\(err\.code\);\s*setError\(\{ \.\.\.err, code, note: batchNote\(started, n, code\) \}\);/);
    assert.match(page, /\{error\.note && ` \$\{error\.note\}`\}/);
    // Every accepted job is tracked, recorded, and priced per unit.
    assert.match(sendOne, /\(i === 0 \? startJobs : addJob\)\(\{ job_id: submitted\.job_id, state: 'queued', credits: unitCost, model_id: modelId \}\);/);
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
    assert.match(grid, /const ui = jobStateUi\(job\);/);
    assert.match(grid, /<JobAssetPreview job=\{job\} \/>/);
    assert.match(grid, /\{failedJobCopy\(job\)\}/);
    // New generation clears every job and claims no cancelled charge.
    assert.match(page, /function cancel\(\) \{\s*clearJobs\(\);\s*setError\(null\);\s*\}/);
});

test('a new click replaces the last click\'s jobs instead of piling onto them', () => {
    // The hook appends; only startJobs resets the list, and it is the hook's only other setter.
    assert.match(hook, /const startJobs = useCallback\(\(job\) => setJobs\(\[job\]\), \[\]\);/);
    assert.match(hook, /return \{ jobs, generating, startJobs, addJob, clearJobs \};/);
    // onSubmit only runs once every earlier job has settled, and its first
    // accepted job resets the list, so one image keeps the single canvas.
    assert.match(page, /onClick=\{generating \? cancel : onSubmit\}/);
    assert.equal((page.match(/\baddJob\(/g) || []).length, 0, 'addJob is never called unconditionally');
    assert.equal((page.match(/startJobs/g) || []).length, 2, 'destructured once, used once');
    assert.ok(sendOne.indexOf('(i === 0 ? startJobs : addJob)(') !== -1);
});

test('a lost reply says it may have been charged, never that it was refunded', () => {
    const line = errors.split('\n').find((l) => /^\s*outcome_unknown:/.test(l)) || '';
    assert.match(line, /may have started and been charged/);
    assert.match(line, /Library/);
    assert.doesNotMatch(line, /refunded|Nothing was charged/i);
});
