import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// ADR-0351 amendment 23: video template prompts stay on the server. The real generations route on a fake network (no key, no spend),
// the resolver, the public routes with the runtime key on and off, and the signed-in route that answers the words.
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,next) { return next(s === 'next/server' ? 'next/server.js' : s,c); }`));
Object.assign(process.env, {
    SUPABASE_URL: 'https://db.test', SUPABASE_SERVICE_ROLE_KEY: 'test-service', PUBLIC_HOST: 'https://veyrnox.test',
    CRUN_ENABLED: 'true', CRUN_API_KEY: 'test-crun',
    R2_ACCOUNT_ID: 'test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_BUCKET: 'test',
});
const generations = await import('../app/api/v1/generations/route.js');
const promptRoute = await import('../app/api/v1/templates/[id]/prompt/route.js');
const detailRoute = await import('../app/api/templates/[id]/route.js');
const listRoute = await import('../app/api/templates/route.js');
const { ALL_TEMPLATES, galleryVideoPresets } = await import('../app/veyrnox/_lib/templates.js');
const { templateContract } = await import('../lib/templateContract.js');
const { checkTemplateRequest } = await import('../lib/templateFidelity.js');
const { resolveTemplatePrompt, ownTemplatePrompt } = await import('../lib/templatePromptResolve.js');
const { templatePromptPlaceholder } = await import('../lib/templatePromptPlaceholder.js');
const { templateRequestFingerprint } = await import('../lib/templateRequestFingerprint.js');
const { templatePromptsPrivate, withoutPromptText } = await import('../lib/templatePromptPrivacy.js');
const { templateDetail, templateCards, publicTemplateCards, searchTemplateIds, kindTemplates } = await import('../lib/clientTemplates.js');
const { toPublicPresets } = await import('../lib/publicPresets.js');
const { privateTemplateRecipe } = await import('../app/veyrnox/_lib/privateTemplateRecipe.js');
const { templateRecipe } = await import('../app/veyrnox/_lib/templateRecipe.js');
const { isVideoTemplate } = await import('../app/veyrnox/_lib/templatePromptVisibility.js');
const { PHOTO_CHARACTER_LINE } = await import('../lib/crunInputRefusal.js');
const { swapNeedsSourceVideo } = await import('../lib/templateSwapGuard.js');

const AUTH = '11111111-1111-4111-8111-111111111111';
const JOB = '22222222-2222-4222-8222-222222222222';
const SOURCE = `uploads/${AUTH}/33333333-3333-4333-8333-333333333333.png`;
const model = { id: 'kling-3.0-i2v', provider: 'crun', provider_endpoint: 'crun:kling/v3', modality: 'image-to-video', credits_5s: 32, active: true, gated_flag: false };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZQAAAABJRU5ErkJggg==', 'base64');
const runnable = t => t.model === 'Kling 3.0 · I2V' && !templateContract(t.id) && t.prompt.length <= 2000
    && checkTemplateRequest({ model_id: model.id, preset: t.id, inputs: { prompt: t.prompt } }).ok;
const template = ALL_TEMPLATES.find(t => runnable(t) && !t.negativePrompt?.trim()) || ALL_TEMPLATES.find(runnable);
const own = ownTemplatePrompt(template);

function network({ idempotent = false } = {}) {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        const u = new URL(String(url));
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
        calls.push({ url: u.href, body });
        if (u.pathname.endsWith('/rpc/ledger_debit')) return Response.json({ ok: true, job_id: JOB, idempotent, balance_after: 100 });
        if (u.pathname.includes('/rpc/')) return Response.json({ ok: true });
        if (u.pathname === '/rest/v1/model_catalog') return Response.json([model]);
        if (u.pathname === '/rest/v1/users') return Response.json([{ id: AUTH }]);
        if (u.hostname === 'api.crun.ai') return Response.json({ code: 200, data: { task_id: 'crun-task-1' } });
        if (u.hostname.endsWith('.r2.cloudflarestorage.com')) {
            return new Response(png, { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${png.length - 1}/${png.length}` } });
        }
        throw new Error(`Unexpected test request: ${u.hostname}${u.pathname}`);
    };
    return { calls, restore: () => { globalThis.fetch = real; } };
}
const post = (inputs, extra = {}) => generations.POST(new Request('https://veyrnox.test/api/v1/generations', {
    method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ model_id: model.id, idempotency_key: 'private-template-test', source_key: SOURCE, consent: true, preset: template.id, inputs: { duration_seconds: 5, ...inputs }, ...extra }),
}));
const debit = net => net.calls.find(c => c.url.includes('/rpc/ledger_debit'))?.body;
const crun = net => net.calls.filter(c => new URL(c.url).hostname === 'api.crun.ai');
async function run(inputs, extra) {
    const net = network();
    try { const res = await post(inputs, extra); return { res, debit: debit(net), crun: crun(net), calls: net.calls }; } finally { net.restore(); }
}

test('the fixture template is a real video template on the Crun Kling offer', () => {
    assert.ok(template && isVideoTemplate(template) && own.length > 40);
});

test('a placeholder runs with the server\'s own words: same debit, same supplier request as a client-sent prompt', async () => {
    const sent = await run({ prompt: own });
    const named = await run({ prompt: templatePromptPlaceholder(template.id) });
    assert.equal(sent.res.status, 200);
    assert.equal(named.res.status, 200);
    assert.equal(named.debit.p_inputs.prompt, own, 'the stored job inputs are the words the supplier gets');
    assert.deepEqual(named.debit, sent.debit, 'price, key and stored inputs identical to a stale client that still sends the text');
    assert.deepEqual(named.crun.map(c => c.body), sent.crun.map(c => c.body));
    assert.equal(named.crun[0].body.input.prompt, own.trim());
    assert.equal(JSON.stringify(named.calls).includes('template-prompt'), false, 'the placeholder never leaves the Worker');
});

test('the photo line a template page adds, or any text around the placeholder, is kept; the words fill in where it stood', async () => {
    const withLine = await run({ prompt: `${templatePromptPlaceholder(template.id)}\n\n${PHOTO_CHARACTER_LINE}` });
    assert.equal(withLine.res.status, 200);
    assert.equal(withLine.debit.p_inputs.prompt, `${own}\n\n${PHOTO_CHARACTER_LINE}`);
    const around = await run({ prompt: `Cinematic. ${templatePromptPlaceholder(template.id)} Slow zoom.` });
    assert.equal(around.debit.p_inputs.prompt, `Cinematic. ${own} Slow zoom.`);
});

test('an edited prompt is the customer\'s own, stored and sent as it is', async () => {
    const edited = await run({ prompt: 'A custom scene of my own' });
    assert.equal(edited.debit.p_inputs.prompt, 'A custom scene of my own');
    assert.equal(edited.crun[0].body.input.prompt, 'A custom scene of my own');
});

test('a placeholder for an unknown or non-video template is refused before any charge or supplier call', async () => {
    for (const prompt of ['[[template-prompt:does-not-exist]]', `${templatePromptPlaceholder(template.id)} [[template-prompt:nope-nope]]`]) {
        const r = await run({ prompt });
        assert.equal(r.res.status, 400);
        assert.deepEqual(await r.res.json(), { error: 'template_not_found' });
        assert.equal(r.debit, undefined);
        assert.equal(r.crun.length, 0);
    }
    const other = ALL_TEMPLATES.find(t => t.id !== template.id && isVideoTemplate(t));
    const r = await run({ prompt: templatePromptPlaceholder(template.id) }, { template_id: other.id });
    assert.equal(r.res.status, 400);
    assert.deepEqual(await r.res.json(), { error: 'template_mismatch' });
    assert.equal(r.debit, undefined);
});

test('the resolved prompt meets the same limits and refusals before the debit as a sent one', async () => {
    // A negative prompt that is not the template's own is refused whether the words are sent or named (Crun Kling has no negative field).
    for (const prompt of [own, templatePromptPlaceholder(template.id)]) {
        const r = await run({ prompt, negative_prompt: 'blurry' });
        assert.equal(r.res.status, 400);
        assert.deepEqual(await r.res.json(), { error: 'inputs_key_not_allowed:negative_prompt' });
        assert.equal(r.debit, undefined);
        assert.equal(r.crun.length, 0);
    }
    // A prompt past the model's cap: the placeholder gives the verdict the long text would give.
    const long = ALL_TEMPLATES.find(t => isVideoTemplate(t) && t.model === 'Kling 3.0 · I2V' && !templateContract(t.id) && ownTemplatePrompt(t).length > 2500);
    if (long) {
        const sent = await run({ prompt: ownTemplatePrompt(long) }, { preset: long.id });
        const named = await run({ prompt: templatePromptPlaceholder(long.id) }, { preset: long.id });
        assert.equal(named.res.status, sent.res.status);
        assert.deepEqual(await named.res.json(), await sent.res.json());
        assert.equal(named.debit === undefined, sent.debit === undefined);
    }
});

test('replay: the same key with the placeholder and with the text is one request and returns the first job', async () => {
    const net = network({ idempotent: true });
    try {
        const named = await post({ prompt: templatePromptPlaceholder(template.id) });
        const sent = await post({ prompt: own });
        assert.deepEqual(await named.json(), await sent.json());
        assert.equal(crun(net).length, 0, 'no second supplier task');
        const debits = net.calls.filter(c => c.url.includes('/rpc/ledger_debit')).map(c => JSON.stringify(c.body));
        assert.equal(new Set(debits).size, 1, 'both attempts reach the ledger with one and the same request');
    } finally { net.restore(); }
});

// Audited templates: the contract id names the template, and a prompt that is absent, named or sent resolves to one request.
const audited = ALL_TEMPLATES.map(t => templateContract(t.id)).filter(Boolean);
const safe = audited.find(c => c.class === 'like-for-like-safe' && c.requiredReferences.imageMin === 1 && !swapNeedsSourceVideo(c.sourcePrompt));
const bound = audited.find(c => c.class === 'bound' && c.slotCount === 1 && c.prompt !== c.sourcePrompt && !swapNeedsSourceVideo(c.sourcePrompt));
const ref = { slot: 'image', origin: 'upload', key: 'uploads/example.png' };
const auditedBody = (c, prompt) => ({ model_id: c.modelId, template_id: c.id, idempotency_key: 'private-audited-key', references: [ref],
    inputs: { ...(prompt === undefined ? {} : { prompt }), duration_seconds: c.duration, ...(c.aspect ? { aspect_ratio: c.aspect } : {}), ...(c.negativePrompt ? { negative_prompt: c.negativePrompt } : {}) } });

for (const [name, c] of [['like-for-like', safe], ['bound', bound]]) {
    test(`audited ${name} template: absent, named and sent prompts resolve to the same audited request and fingerprint`, async () => {
        const sentPrompt = c.class === 'bound' ? c.prompt : c.sourcePrompt;
        const sent = auditedBody(c, sentPrompt);
        const forms = [auditedBody(c, undefined), auditedBody(c, templatePromptPlaceholder(c.id)), sent];
        const resolved = forms.map(body => resolveTemplatePrompt(body, c.modelId).body);
        for (const body of resolved) {
            assert.equal(body.inputs.prompt, sentPrompt);
            const check = checkTemplateRequest(body);
            assert.equal(check.ok, true);
            assert.equal(check.metadata.template_id, c.id);
        }
        const prints = await Promise.all(resolved.map(templateRequestFingerprint));
        assert.equal(new Set(prints).size, 1, 'replay cannot tell the three apart');
    });
}

test('a bound template is bound only when the whole text is named, the model is the bound one and every slot is filled', () => {
    const named = templatePromptPlaceholder(bound.id);
    const body = auditedBody(bound, named);
    assert.equal(resolveTemplatePrompt(body, bound.modelId).body.inputs.prompt, bound.prompt);
    assert.equal(resolveTemplatePrompt({ ...body, references: [] }, bound.modelId).body.inputs.prompt, bound.sourcePrompt, 'slots unfilled: the source text, as a client would send');
    assert.equal(resolveTemplatePrompt(body, 'seedance-2.0-fast').body.inputs.prompt, bound.sourcePrompt);
    assert.equal(resolveTemplatePrompt(auditedBody(bound, `${named} more`), bound.modelId).body.inputs.prompt, `${bound.sourcePrompt} more`);
});

test('nothing to resolve leaves the very same body: no template, a sent prompt, clips and swaps', () => {
    for (const body of [
        { model_id: 'x', inputs: {} }, { model_id: 'x', inputs: { prompt: 'hello' }, template_id: safe.id },
        { model_id: 'x', inputs: { prompt: templatePromptPlaceholder(safe.id) }, template_clip: safe.id },
        { model_id: 'x', inputs: { prompt: templatePromptPlaceholder(safe.id) }, template_swap: safe.id },
        { model_id: 'x', inputs: {}, template_id: 'unknown-template' }, { model_id: 'x', inputs: [] }, null,
    ]) assert.equal(resolveTemplatePrompt(body, 'x').body, body);
});

test('an audited run still passes through the route to normal admission with the prompt absent', async () => {
    const net = network();
    try {
        const body = JSON.stringify(auditedBody(safe, undefined));
        const res = await generations.POST(new Request('https://veyrnox.test/api/v1/generations', { method: 'POST', headers: { 'x-veyrnox-auth-id': AUTH }, body }));
        assert.notEqual((await res.json()).error, 'template_mismatch');
        assert.ok(net.calls.some(c => c.url.endsWith('/rpc/check_generation_rate_limit')), 'admission reached');
    } finally { net.restore(); }
});

// ---- the public side ----

const videoTemplates = ALL_TEMPLATES.filter(isVideoTemplate);
const probes = videoTemplates.flatMap(t => [ownTemplatePrompt(t), t.prompt].filter(Boolean).map(text => text.replace(/\s+/g, ' ').slice(20, 70))).filter(s => s.length >= 40);
const leaks = (value) => { const text = JSON.stringify(value).replace(/\\n|\\r|\s+/g, ' '); return probes.filter(p => text.includes(p.replace(/"/g, '\\"'))).length; };
const withFlag = (value, fn) => { const old = process.env.APP_RUNTIME_FLAGS; const restore = () => { if (old === undefined) delete process.env.APP_RUNTIME_FLAGS; else process.env.APP_RUNTIME_FLAGS = old; }; if (value === undefined) delete process.env.APP_RUNTIME_FLAGS; else process.env.APP_RUNTIME_FLAGS = value; let out; try { out = fn(); } catch (e) { restore(); throw e; } if (out && typeof out.then === 'function') return out.finally(restore); restore(); return out; };
// A bound template's photo-slot hints are the one deliberate exception: the words around each photo token, so a person knows which photo goes where.
const withoutHints = (value) => (value?.fidelity ? { ...value, fidelity: { ...value.fidelity, photoHints: undefined, photoHintsPhone: undefined } } : value);
const ON = JSON.stringify({ templatePromptsPrivate: true });

test('the key is on only for a literal true', () => {
    for (const [value, expected] of [[undefined, false], ['{}', false], ['not json', false], ['{"templatePromptsPrivate":"true"}', false], ['{"templatePromptsPrivate":1}', false], [ON, true]]) {
        assert.equal(withFlag(value, () => templatePromptsPrivate(process.env)), expected, String(value));
    }
});

test('key off: presets, cards and detail still carry the words, exactly as before', () => withFlag(undefined, () => {
    const presets = toPublicPresets([]);
    assert.ok(presets.every(p => !('promptPrivate' in p)));
    assert.ok(leaks(presets) > 0);
    assert.deepEqual(publicTemplateCards(), templateCards(), 'the very same list');
    assert.ok(templateCards().filter(c => c.kind !== 'image').every(c => typeof c.promptPreview === 'string' && c.promptPreview.length > 0));
    const detail = templateDetail(template.id);
    assert.equal(detail.prompt, own);
    assert.equal(detail.promptPrivate, undefined);
    assert.deepEqual(templateDetail(template.id, { hidePrompt: false }), detail);
}));

test('key on: no public answer for a video template carries any of its words', () => withFlag(ON, () => {
    assert.equal(leaks(toPublicPresets([], undefined, { hidePrompts: true })), 0);
    const presets = toPublicPresets([], undefined, { hidePrompts: true });
    assert.ok(presets.length > 20 && presets.every(p => p.promptPrivate === true && p.prompt === templatePromptPlaceholder(p.id)));
    assert.ok(presets.every(p => p.sourcePrompt === null || p.sourcePrompt === templatePromptPlaceholder(p.id)));
    assert.ok(presets.every(p => 'sourcePromptRunnable' in p && 'sourcePromptIssues' in p && 'credits' in p), 'audit and price fields stay');
    const cards = publicTemplateCards();
    assert.equal(leaks(cards), 0);
    assert.equal(leaks(presets), 0);
    assert.ok(cards.filter(c => c.kind !== 'image').every(c => !('promptPreview' in c) && 'name' in c && 'clip' in c));
    for (const t of videoTemplates) {
        const detail = templateDetail(t.id, { hidePrompt: true });
        assert.equal(leaks(withoutHints(detail)), 0, t.id);
        assert.equal(detail.prompt, templatePromptPlaceholder(t.id));
        assert.equal(detail.promptPrivate, true);
        assert.equal(detail.name, templateDetail(t.id).name);
        if (detail.fidelity) assert.equal(detail.fidelity.prompt, templatePromptPlaceholder(t.id));
        assert.equal(leaks(withoutHints(privateTemplateRecipe(t))), 0, `${t.id} page data`);
    }
}));

test('key on: image and audio templates keep their public prompts', () => withFlag(ON, () => {
    const image = templateCards().find(c => c.kind === 'image');
    if (image) assert.equal(publicTemplateCards().find(c => c.id === image.id).promptPreview, image.promptPreview);
    for (const kind of ['image', 'audio']) {
        const list = kindTemplates(kind);
        assert.ok(list.templates.length > 0 && list.templates.every(t => typeof t.prompt === 'string' && t.prompt.length > 0 && !t.prompt.startsWith('[[template-prompt')));
    }
}));

test('key on: a bound template\'s photo-slot hints and contract still work without its text', () => withFlag(ON, () => {
    const detail = templateDetail(bound.id, { hidePrompt: true });
    assert.equal(detail.fidelity.class, 'bound');
    assert.equal(detail.fidelity.photoHints.length, bound.slotCount);
    assert.equal(detail.fidelity.photoHintsPhone.length, bound.slotCount);
    assert.ok(detail.fidelity.photoHints.every(h => typeof h === 'string' && h.length <= 120));
    assert.ok(detail.fidelity.photoHintsPhone.every(h => typeof h === 'string' && h.length <= 222));
    assert.equal('photoPrompt' in detail.fidelity, false);
    assert.equal(detail.fidelity.prompt, detail.fidelity.sourcePrompt, 'the client\'s equality tests still read "unedited"');
}));

test('search still finds a template by a word of its prompt, with the key on or off, and answers ids only', () => {
    const target = galleryVideoPresets().find(t => [...new Set(ownTemplatePrompt(t).toLowerCase().match(/[a-z]{9,}/g) || [])].some(w => !`${t.name} ${t.category} ${t.model} ${t.needs ?? ''}`.toLowerCase().includes(w)));
    const word = [...new Set(ownTemplatePrompt(target).toLowerCase().match(/[a-z]{9,}/g) || [])].find(w => !`${target.name} ${target.category} ${target.model} ${target.needs ?? ''}`.toLowerCase().includes(w));
    assert.ok(word, 'fixture: a long word only in the prompt');
    for (const flag of [undefined, ON]) withFlag(flag, () => assert.ok(searchTemplateIds(word).includes(target.id), String(flag)));
});

async function getJson(handler, url, ...rest) { const res = await handler(new Request(url), ...rest); return { status: res.status, body: await res.json(), headers: res.headers }; }

test('GET /api/templates/:id and GET /api/templates follow the key', async () => {
    const off = await withFlag(undefined, () => getJson(detailRoute.GET, 'https://veyrnox.test/api/templates/x', { params: Promise.resolve({ id: template.id }) }));
    assert.equal(off.body.template.prompt, own);
    const on = await withFlag(ON, () => getJson(detailRoute.GET, 'https://veyrnox.test/api/templates/x', { params: Promise.resolve({ id: template.id }) }));
    assert.equal(on.body.template.prompt, templatePromptPlaceholder(template.id));
    assert.equal(on.body.template.promptPrivate, true);
    const list = await withFlag(ON, () => getJson(listRoute.GET, 'https://veyrnox.test/api/templates'));
    assert.equal(leaks(list.body), 0);
    const found = await withFlag(ON, () => getJson(listRoute.GET, `https://veyrnox.test/api/templates?q=${encodeURIComponent('slow')}`));
    assert.ok(Array.isArray(found.body.ids));
});

test('the signed-in prompt route: 401 without a verified identity, the real template with one, 404 for image, audio and unknown', async () => {
    const call = (id, headers = {}) => promptRoute.GET(new Request(`https://veyrnox.test/api/v1/templates/${id}/prompt`, { headers }), { params: Promise.resolve({ id }) });
    const signedOut = await call(template.id);
    assert.equal(signedOut.status, 401);
    assert.equal(JSON.stringify(await signedOut.json()).includes(own.slice(0, 30)), false);
    const signedIn = await call(template.id, { 'x-veyrnox-auth-id': AUTH });
    assert.equal(signedIn.status, 200);
    assert.equal(signedIn.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual((await signedIn.json()).template, withFlag(undefined, () => templateDetail(template.id)), 'the object the public route gave before the key');
    for (const id of ['does-not-exist', 'bad id!', ...[...new Set(templateCards().filter(c => c.kind === 'image').map(c => c.id))].slice(0, 1)]) {
        assert.equal((await call(id, { 'x-veyrnox-auth-id': AUTH })).status, 404, id);
    }
});

test('withoutPromptText leaves every non-prompt field of a template alone', () => {
    const detail = templateDetail(template.id);
    const hidden = withoutPromptText(detail);
    const { prompt, sourcePrompt, fidelity, promptPrivate, ...rest } = hidden;
    const { prompt: p0, sourcePrompt: s0, fidelity: f0, ...rest0 } = detail;
    assert.deepEqual(rest, rest0);
    assert.equal(templateRecipe(template).name, privateTemplateRecipe(template).name);
});

// ---- web client wiring ----
import { readFileSync } from 'node:fs';
const { withTemplateText, ownPromptOf, isPrivateTemplate } = await import('../app/veyrnox/_lib/privateTemplatePrompt.js');

test('web: text without a placeholder is never fetched, and a template says whether it is private', async () => {
    assert.equal(await withTemplateText('my own words'), 'my own words');
    assert.equal(isPrivateTemplate({ promptPrivate: true }), true);
    assert.equal(isPrivateTemplate({}), false);
    assert.equal(ownPromptOf({ sourcePromptOrigin: 'community-source-exact', sourcePrompt: 'exact', prompt: 'adapted' }), 'exact');
    assert.equal(ownPromptOf({ prompt: 'adapted' }), 'adapted');
});

test('web: Create, the template page and the prompt panel hydrate through Edit prompt, and every submit path is untouched', () => {
    const page = readFileSync('app/veyrnox/app/create/page.js', 'utf8');
    const recipe = readFileSync('app/veyrnox/_components/TemplateRecipe.js', 'utf8');
    const display = readFileSync('app/veyrnox/_lib/templatePromptDisplay.js', 'utf8');
    assert.match(page, /useTemplatePromptDisplay\(activeTemplate \|\| keptTemplate, prompt, undefined, \{ onHydrate: hydrateTemplate \}\)/);
    assert.match(recipe, /useTemplatePromptDisplay\(preset, displayPrompt, null, \{ onHydrate \}\)/);
    assert.match(display, /fetchPrivateTemplate\(templateId\)/);
    assert.match(display, /if \(!full\) \{ setStatus\('error'\); return; \}/, 'a failed read reveals nothing');
    assert.match(page, /prompt: finalPrompt\(\),/, 'Create still sends what the box holds');
    assert.match(readFileSync('app/veyrnox/_lib/templateGenerate.js', 'utf8'), /template_id: !templateClip && auditedInputs\.has\(inputs\)/);
});
