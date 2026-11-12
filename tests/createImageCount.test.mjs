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
    assert.match(page, /\{takesImageCount\(model\) && <ChipSelect assistantTarget="create.count" label="IMAGES" options=\{IMAGE_COUNTS\} value=\{count\} onChange=\{setCount\}/);
    assert.equal((page.match(/assistantTarget="create.count"/g) || []).length, 1);
    assert.match(page, /const n = imageCount\(model, count\);/);
});

test('the total drives the price, the balance guard and the button', () => {
    // The batch total still drives the price; ADR-0069 waives the first `freeLeft` jobs of it when the server says so.
    assert.match(page, /const cost = quote.total;/);
    assert.match(submit, /payable > balance\) return;/);
    assert.match(page, /const payable = quote.payable \?\? cost;/);
    // A continuation (jobs already started) still pre-checks the balance for the remaining items.
    assert.match(page, /\(!!activeBatch && \(balance == null \|\| payable > balance\)\)/);
    assert.match(page, /balance == null \|\| payable > balance \|\| missingSource/);
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
    const serialize = new Function('context', `const {modelId,keys,inputs,inputsForIndex,presetParam,templateStartIdFor,templateData,references,anySource,i,n}=context; const run={inputs}, quote={ceilings:[0,7,7]}; return JSON.stringify(${requestObject});`);
    for (const count of [1, 3]) {
        const events = [], files = Array.from({length:count}, (_,i) => ({name:`reference-${i}.png`}));
        const sources = {image:files.map(file=>({file}))};
        const {references} = await mediaGenerationSources({media:{image:{maxFiles:3}}}, sources, async file => {
            events.push(`upload:${file.name}`); return `uploads/${file.name}`;
        });
        const bodies = [], keys = ['batch-key-1','batch-key-2','batch-key-3'];
        const result = await sendInOrder(3, async i => {
            events.push(`request:${i}`);
            bodies.push(JSON.parse(serialize({modelId:'edit',keys,inputs:{prompt:'p'},inputsForIndex,presetParam:null,templateData:null,templateStartIdFor:()=>null,references,anySource:true,i,n:3})));
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
    assert.match(submit, /createBatch\(n, \(\) => makeIdempotencyKey\(\)\)/);
    assert.equal((page.match(/makeIdempotencyKey\(\)/g) || []).length, 1, 'no other key is ever minted');
    assert.ok(submit.indexOf('const keys =') < submit.indexOf('await sendInOrder('));
    assert.match(sendOne, /idempotency_key: keys\[i\], inputs: inputsForIndex\(run.inputs, i, n\),/);
    // The double-click guard still holds for the whole batch.
    assert.match(submit, /if \(inFlight\.current \|\| sending \|\| generating/);
});

test('requests go one at a time and the first failure stops the rest', () => {
    assert.match(submit, /const \{ started, error: failure \} = await sendInOrder\(n, async \(i\) => \{/);
    assert.equal(/Promise\.(all|allSettled|race|any)\(/.test(page), false, 'never sent in parallel');
    assert.match(submit, /setError\(\{ \.\.\.err, code, note: batchNote\(started, n, code\) \}\);/);
    assert.match(page, /\{error\.note && ` \$\{error\.note\}`\}/);
    // Every accepted job is tracked, recorded, and priced per unit.
    // Priced per unit, or 0 when the server marked the job as having used a free allowance (ADR-0069).
    assert.match(sendOne, /const jobCredits = submitted\.free_allowance === true \? 0 : run.unit;/);
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
    assert.match(page, /function cancel\(\) \{\s*continuation.current = null;\s*setBatchView\(null\);\s*clearJobs\(\);\s*setError\(null\);\s*\}/);
});

test('a new click replaces the last click\'s jobs instead of piling onto them', () => {
    // The hook appends; only startJobs resets the list, and it is the hook's only other setter.
    assert.match(hook, /const startJobs = useCallback\(\(job\) => setJobs\(\[job\]\), \[\]\);/);
    assert.match(hook, /return \{ jobs, generating, startJobs, addJob, clearJobs \};/);
    // onSubmit only runs once every earlier job has settled, and its first
    // accepted job resets the list, so one image keeps the single canvas.
    assert.match(page, /onClick=\{hasJobs && !activeBatch \? cancel : onSubmit\}/);
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


test('price recovery refreshes allowance and freezes the server quote before explicit confirmation', () => {
    assert.match(submit, /gatewayFetch\('\/free-allowance'\)/);
    assert.match(submit, /run.unit = err.expectedCredits;/);
    assert.match(submit, /run.quote = allocationSnapshot\(run, run.unit, freeLeftFor\(fresh, modelId\)\);/);
    assert.match(submit, /max_charge_credits: quote.ceilings\[i\]/);
    assert.match(submit, /}, run, makeIdempotencyKey\);/);
    assert.match(page, /disabled=\{[^\n]*\|\| !!activeBatch\?\.confirm\}/);
    assert.match(read('../app/veyrnox/app/create/page.js'), /t\('app.create.confirmPrice', \{ credits: creditLabel\(cost\) \}\)/);
    assert.match(page, /const activeBatch = batchView\?\.identity === formIdentity/);
});

for (const modelId of ['flux-2-pro-1k-kie', 'flux-2-pro']) test(`actual web confirmation for ${modelId} retains keys and sends ceilings; the server chooses enforcement`, async () => {
    const { createBatch, allocationSnapshot } = await import('../app/veyrnox/_lib/imageBatch.js');
    const ast = ts.createSourceFile('page.js', read('../app/veyrnox/app/create/page.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    let handler, confirmControl, generateDisabled;
    function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'onSubmit') handler = node.getText(ast);
        if (ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith('activeBatch?.confirm &&')) confirmControl = node.expression.getText(ast);
        if (ts.isJsxOpeningElement(node) && node.attributes.properties.some(attr => attr.name?.text === 'data-assistant-target' && attr.initializer?.text === 'create.generate')) {
            generateDisabled = node.attributes.properties.find(attr => attr.name?.text === 'disabled').initializer.expression.getText(ast);
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    const requests = [], events = [], accepted = [];
    let sequence = 0, uploads = 0, error;
    const identity = {};
    const context = {
        draftRecovery: {}, attachConverting: false, sourcesConverting: false, inFlight: { current: false },
        sending: false, generating: false, model: { id: modelId, name: 'Image', kind: 'image' }, modelId,
        balance: 100, cost: 0, payable: 0, catalogStatus: 'live', sourceBlocked: false, animationMismatch: false, needsReattach: false, overLimit: false,
        missingSource: false, missingConsent: false, missingPrompt: false, promptTooLong: false, missingVoice: false,
        invalidAudioDuration: false, setError: value => { error = value; }, setSending: () => {},
        getJourney: () => ({}), duration: '5s', isShort: false, aspectOptions: [], aspect: '1:1',
        activeBatch: null, continuation: { current: null }, formIdentity: identity, activeTier: null, unitCost: 2, n: 2,
        createBatch, makeIdempotencyKey: () => `key-${++sequence}`, allocationSnapshot,
        quote: allocationSnapshot({ accepted: [null, null], unknown: new Set() }, 2, 2),
        prompt: 'lake', finalPrompt: () => 'lake', settingsInputs: () => ({ seed: 7 }), seed: '7', negative: '', loop: false, voice: '', audioDuration: null,
        sources: {}, uploadSource: () => {}, mediaGenerationSources: async () => { uploads++; return { references: [], source_keys: [], source_assets: [] }; },
        sendInOrder, inputsForIndex, presetParam: null, templateData: null, templateStartIdFor: () => null,
        gatewayFetch: async (path, init) => {
            events.push(path);
            if (path === '/free-allowance') return { enabled: true, left: {} }; // fresh: stale two free slots are gone
            const body = JSON.parse(init.body); requests.push(body);
            if (requests.length === 2) throw { code: 'price_changed', expectedCredits: 9 };
            return { job_id: `job-${body.idempotency_key}`, balance_after: 99 };
        },
        startJobs: result => accepted.push(result), addJob: result => accepted.push(result), trackJourneyJob: () => {}, pushJobHistory: () => {},
        setBalance: () => {}, notifyBalanceChanged: () => {}, errorFor: value => value, submitErrorCode: code => code,
        freeLeftFor: (map, id) => map?.[id] ?? 0, batchNote: () => '', setBatchView: () => {},
    };
    // Execute the real handler with its browser dependencies replaced by this bounded harness.
    const onSubmit = new Function('context', `with (context) { return (${handler}); }`)(context);
    await onSubmit();
    assert.equal(error.code, 'price_changed');
    const run = context.continuation.current;
    assert.equal(run.confirm, true);
    assert.deepEqual(run.quote, { ceilings: [null, 9], total: 9, payable: 9 });
    assert.equal(context.unitCost, 2, 'the cached catalog still quotes the old price');
    assert.deepEqual(events, ['/generations', '/generations', '/free-allowance']);
    assert.equal(requests.length, 2, 'no automatic retry');
    context.activeBatch = run; context.quote = run.quote; context.cost = run.quote.total; context.payable = run.quote.payable;
    context.onSubmit = onSubmit;
    context.hasJobs = true;
    context.t = (key, values) => `${key}: ${values?.credits ?? ''}`;
    context.creditLabel = value => `${value} credits`;
    context.React = await import('react');
    const renderCode = ts.transpileModule(`const control = (${confirmControl});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ESNext } }).outputText;
    const renderConfirm = () => new Function('context', `with (context) { ${renderCode}; return control; }`)(context);
    const button = renderConfirm();
    assert.equal(new Function('context', `with (context) { return (${generateDisabled}); }`)(context), true, 'ordinary submit is blocked pending confirmation');
    assert.equal(button.type, 'button');
    assert.equal(button.props.disabled, false);
    assert.equal(button.props.children, 'app.create.confirmPrice: 9 credits');
    context.balance = 8;
    assert.equal(renderConfirm().props.disabled, true, 'confirmation cannot exceed the available balance');
    context.balance = 100;
    await button.props.onClick(); // explicit confirmation through the actual rendered control
    assert.deepEqual(requests.map(r => [r.idempotency_key, r.max_charge_credits, r.inputs.seed]), [
        ['key-1', 0, 7], ['key-2', 0, 8], ['key-2', 9, 8],
    ]);
    assert.ok(requests.every(r => r.model_id === modelId && r.confirmed_credits === undefined), 'web sends the ceiling, without gross confirmation, for both durable and ordinary models');
    assert.equal(uploads, 1);
    assert.equal(accepted.length, 2);
    assert.equal(context.continuation.current, null);
});

// Run the actual submit handler with deterministic requests and a rerendered quote.
async function retryHandlerHarness(count, replies) {
    const helpers = await import('../app/veyrnox/_lib/imageBatch.js');
    const ast = ts.createSourceFile('page.js', read('../app/veyrnox/app/create/page.js'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    let handler;
    function visit(node) {
        if (ts.isFunctionDeclaration(node) && node.name?.text === 'onSubmit') handler = node.getText(ast);
        ts.forEachChild(node, visit);
    }
    visit(ast);
    let sequence = 0;
    const requests = [], jobs = [];
    const context = {
        ...helpers, draftRecovery: {}, attachConverting: false, sourcesConverting: false, inFlight: { current: false },
        sending: false, generating: false, model: { id: 'image', name: 'Image', kind: 'image' }, modelId: 'image',
        balance: 100, catalogStatus: 'live', sourceBlocked: false, animationMismatch: false, needsReattach: false, overLimit: false,
        missingSource: false, missingConsent: false, missingPrompt: false, promptTooLong: false, missingVoice: false,
        invalidAudioDuration: false, setError: value => { context.error = value; }, setSending: () => {},
        getJourney: () => ({}), duration: '5s', isShort: false, aspectOptions: [], aspect: '1:1',
        activeBatch: null, continuation: { current: null }, formIdentity: {}, activeTier: null, unitCost: 2, n: count,
        makeIdempotencyKey: () => `retry-key-${++sequence}`,
        prompt: 'lake', finalPrompt: () => 'lake', settingsInputs: () => ({ seed: 7 }), seed: '7', negative: '', loop: false, voice: '', audioDuration: null,
        sources: {}, uploadSource: () => {}, mediaGenerationSources: async () => ({ references: [], source_keys: [], source_assets: [] }),
        presetParam: null, templateData: null, templateStartIdFor: () => null,
        gatewayFetch: async (path, init) => {
            if (path === '/free-allowance') return { enabled: true, left: {} };
            const body = JSON.parse(init.body); requests.push(body);
            const reply = replies.shift();
            if (reply?.code) throw reply;
            return reply ?? { job_id: `job-${body.idempotency_key}` };
        },
        startJobs: job => jobs.push(job), addJob: job => jobs.push(job), trackJourneyJob: () => {}, pushJobHistory: () => {},
        setBalance: () => {}, notifyBalanceChanged: () => {}, errorFor: error => error,
        freeLeftFor: () => 0, setBatchView: value => { context.activeBatch = value; },
    };
    const onSubmit = new Function('context', `with (context) { return (${handler}); }`)(context);
    return { context, requests, jobs, async submit() {
        const run = context.continuation.current;
        context.quote = run?.quote ?? helpers.allocationSnapshot(run ?? { accepted: Array(count).fill(null), unknown: new Set() }, run?.unit ?? 2, 0);
        context.cost = context.quote.total; context.payable = context.quote.payable;
        await onSubmit();
    } };
}

for (const [status, code] of [[502, 'provider_submit_failed'], [422, 'provider_moderation'], [422, 'provider_input_rejected'], [429, 'rate_limited'], [400, 'unlisted_refusal']]) {
    test(`actual web handler starts a new key after single definitive ${status} ${code}`, async () => {
        const h = await retryHandlerHarness(1, [{ status, code }]);
        await h.submit();
        assert.equal(h.context.continuation.current, null);
        assert.equal(h.context.activeBatch, null);
        assert.equal(h.requests.length, 1, 'no automatic retry');
        await h.submit();
        assert.deepEqual(h.requests.map(r => r.idempotency_key), ['retry-key-1', 'retry-key-2']);
        assert.equal(h.jobs.length, 1);
    });
}
for (const code of ['network_error', 'admission_unknown']) test(`actual web handler retains a single uncertain ${code} key`, async () => {
    const h = await retryHandlerHarness(1, [{ code }]);
    await h.submit();
    const run = h.context.continuation.current;
    assert.deepEqual([...run.unknown], [0]);
    assert.equal(h.context.error.code, 'outcome_unknown');
    assert.equal(h.requests.length, 1);
    await h.submit();
    assert.deepEqual(h.requests.map(r => r.idempotency_key), ['retry-key-1', 'retry-key-1']);
    assert.equal(h.context.continuation.current, null);
});
test('actual web handler retains a single price_changed key until explicit confirmation', async () => {
    const h = await retryHandlerHarness(1, [{ code: 'price_changed', expectedCredits: 9 }]);
    await h.submit();
    const run = h.context.continuation.current;
    assert.equal(run.confirm, true);
    assert.deepEqual(run.quote, { ceilings: [9], total: 9, payable: 9 });
    assert.equal(h.requests.length, 1);
    await h.submit();
    assert.deepEqual(h.requests.map(r => [r.idempotency_key, r.max_charge_credits]), [['retry-key-1', 2], ['retry-key-1', 9]]);
});
test('actual web partial retry rotates only the definitively refused item and keeps accepted jobs and suffix keys', async () => {
    const h = await retryHandlerHarness(3, [{ job_id: 'accepted' }, { status: 502, code: 'provider_submit_failed' }]);
    await h.submit();
    const run = h.context.continuation.current;
    assert.deepEqual(run.keys, ['retry-key-1', 'retry-key-4', 'retry-key-3']);
    assert.equal(run.accepted[0].job_id, 'accepted');
    assert.equal(h.jobs.length, 1);
    await h.submit();
    assert.deepEqual(h.requests.map(r => [r.idempotency_key, r.inputs.seed]), [
        ['retry-key-1', 7], ['retry-key-2', 8], ['retry-key-4', 8], ['retry-key-3', 9],
    ]);
    assert.equal(h.jobs.length, 3);
    assert.equal(h.context.continuation.current, null);
});
