import { resolveI18nSource } from '../scripts/lib/vey-knowledge-i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { mediaGenerationSources } from '../app/veyrnox/_lib/chatMedia.js';
import { sendInOrder, inputsForIndex } from '../app/veyrnox/_lib/imageBatch.js';

// JSX page and a React hook, so this reads the source, like uploadConsent.test.mjs.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = resolveI18nSource(read('../app/veyrnox/app/create/page.js'));
const hook = read('../app/veyrnox/_lib/useStudioJobs.js');
const grid = read('../app/veyrnox/_components/StudioJobGrid.js');
const errors = read('../app/veyrnox/_lib/createErrors.js');

const submit = page.slice(page.indexOf('async function onSubmit()'), page.indexOf('function cancel()'));
const sendOne = submit.slice(submit.indexOf('await sendInOrder('));

test('the IMAGES control is shown for image models only', () => {
    assert.match(page, /\{takesImageCount\(model\) && \(\s*<ControlRow assistantTarget="create.count" label="IMAGES" options=\{IMAGE_COUNTS\} value=\{count\} onChange=\{setCount\} \/>/);
    assert.equal((page.match(/label="IMAGES"/g) || []).length, 1);
    assert.match(page, /const n = imageCount\(model, count\);/);
});

test('the total drives the price, the balance guard and the button', () => {
    // The batch total still drives the price; ADR-0069 waives the first `freeLeft` jobs of it when the server says so.
    assert.match(page, /const cost = freeLeft > 0 \? freeCost\(unitCost, n, freeLeft\) : totalCost\(unitCost, n\);/);
    assert.match(submit, /cost > balance\) return;/);
    assert.match(page, /balance == null \|\| cost > balance \|\| missingSource/);
    assert.match(page, />\{generationCostLabel\(cost\)\}<\/div>/);
    assert.match(page, /cost===0\?'app.create.generateFree':'app.create.generatePaid',\{credits:creditLabel\(cost\)\}/);
});

test('each source is uploaded once, before any request, and reused by all', async () => {
    assert.ok(submit.length > 0 && sendOne.length > 0, 'submit and its sendInOrder found');
    assert.equal((submit.match(/mediaGenerationSources\(model, sources, uploadSource\)/g) || []).length, 1);
    assert.ok(submit.indexOf('mediaGenerationSources(') < submit.indexOf('await sendInOrder('));
    assert.equal(sendOne.includes('uploadSource('), false);

    // Execute the actual page's request object, not a duplicate of its field names.
    const ast = ts.createSourceFile('page.js', read('../app/veyrnox/app/create/page.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    let requestObject;
    function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === 'JSON.stringify') {
            const arg = node.arguments[0];
            if (arg && ts.isObjectLiteralExpression(arg) && arg.properties.some(p => p.name?.getText(ast) === 'idempotency_key')) requestObject = arg.getText(ast);
        }
        ts.forEachChild(node, visit);
    }
    visit(ast); assert.ok(requestObject, 'generation request body found');
    const serialize = new Function('context', `const {modelId,keys,inputs,inputsForIndex,presetParam,templateStartId,references,anySource,i,n}=context; return JSON.stringify(${requestObject});`);
    for (const count of [1, 3]) {
        const events = [], files = Array.from({length:count}, (_,i) => ({name:`reference-${i}.png`}));
        const sources = {image:files.map(file=>({file}))};
        const {references} = await mediaGenerationSources({media:{image:{maxFiles:3}}}, sources, async file => {
            events.push(`upload:${file.name}`); return `uploads/${file.name}`;
        });
        const bodies = [], keys = ['batch-key-1','batch-key-2','batch-key-3'];
        const result = await sendInOrder(3, async i => {
            events.push(`request:${i}`);
            bodies.push(JSON.parse(serialize({modelId:'edit',keys,inputs:{prompt:'p'},inputsForIndex,presetParam:null,templateStartId:()=>null,references,anySource:true,i,n:3})));
        });
        assert.equal(result.started, 3); assert.equal(result.error, null);
        assert.deepEqual(events.slice(0,count),files.map(file=>`upload:${file.name}`));
        assert.equal(events.filter(event=>event.startsWith('upload:')).length,count);
        for (const [i,body] of bodies.entries()) {
            assert.deepEqual(body.references,files.map(file=>({slot:'image',origin:'upload',key:`uploads/${file.name}`})));
            assert.equal(body.idempotency_key, keys[i]); assert.equal(body.consent, true);
            assert.equal('source_keys' in body, false); assert.equal('source_assets' in body, false);
        }
    }
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
    // Priced per unit, or 0 when the server marked the job as having used a free allowance (ADR-0069).
    assert.match(sendOne, /const jobCredits = submitted\.free_allowance === true \? 0 : unitCost;/);
    assert.match(sendOne, /\(i === 0 \? startJobs : addJob\)\(\{ job_id: submitted\.job_id, state: 'queued', credits: jobCredits, model_id: modelId, \.\.\.submittedPresentation \}\);/);
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
    assert.match(page, /setError\(LOCAL_ERRORS\.poll_unreachable\)/);
});

test('one job keeps the single canvas; more get the grid', () => {
    assert.match(page, /const job = jobs\.length === 1 \? jobs\[0\] : null;/);
    assert.match(page, /\{jobs\.length > 1 \? <StudioJobGrid jobs=\{jobs\} aspect=\{resultAspect\} \/> : \(/);
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
    assert.match(page, /onClick=\{hasJobs \? cancel : onSubmit\}/);
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
