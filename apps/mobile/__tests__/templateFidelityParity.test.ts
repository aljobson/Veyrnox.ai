const { writeFileSync } = require('fs');
const { execFileSync } = require('child_process');
const { resolve } = require('path');
import { parsePresets, presetHref } from '../src/lib/presets';
import { readTemplate } from '../src/lib/templateHandoff';
import { templateRequest } from '../src/lib/templateGenerate';
import { mediaApi, type CatalogModel } from '../src/lib/media';
import type { ApiClient } from '../src/lib/api';
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => undefined, hasAgreed: async () => true } }));
jest.mock('../src/lib/celebrate', () => ({ noteLocalSubmission: () => {} }));
jest.mock('../src/lib/analytics/generations', () => ({ noteGenerationSubmitted: async () => {}, noteGenerationFinished: async () => {} }));
const fixtureData = JSON.parse(execFileSync(process.execPath, [resolve('../../tests/fixtures/templateFidelityParity.mjs')], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, NODE_NO_WARNINGS: '1' } }));
const fixtures = fixtureData.inventory;
test('all exact templates have provider-field parity through feed, parser, handoff and request', async () => {
    expect(fixtures).toHaveLength(771);
    const parity: Record<string, unknown> = {};
    for (const { feed, model, body, contract } of fixtures) {
        const [parsed] = parsePresets({ presets: [feed] });
        const handoff = presetHref(parsed, {}, [model as CatalogModel]);
        const info = readTemplate(handoff.params, ['veyrnox.ai']);
        expect(info?.negativePrompt).toBe(feed.negativePrompt || '');
        expect('modelId' in handoff.params && handoff.params.modelId).toBe(model.id);
        expect(parsed.modelId).toBe(model.id);
        const request = templateRequest(parsed, model, { prompt: parsed.sourcePrompt!, aspect: body.inputs.aspect_ratio || null, duration: body.inputs.duration_seconds, references: body.references, sourceRights: true });
        parity[feed.id] = { equal: true, web: body.inputs, mobile: { prompt: request.prompt, duration_seconds: request.durationSeconds, ...request.extraInputs }, model: request.modelId };
        expect({ model_id: request.modelId, template_id: request.templateId, inputs: { prompt: request.prompt, duration_seconds: request.durationSeconds, ...request.extraInputs } }).toEqual({ model_id: body.model_id, template_id: body.template_id, inputs: body.inputs });
        let nativeBody: any;
        const api = { request: async (_path: string, init: { body: string }) => { nativeBody = JSON.parse(init.body); return { job_id: 'parity-job' }; } } as unknown as ApiClient;
        await mediaApi(api).createGeneration({ ...request, idempotencyKey: 'parity-key', maxCharge: 32 });
        expect({ model: nativeBody.model_id, template: nativeBody.template_id, inputs: nativeBody.inputs, references: nativeBody.references, consent: nativeBody.consent }).toEqual({ model: body.model_id, template: body.template_id, inputs: body.inputs, references: body.references, consent: body.consent });
    }
    if (process.env.TEMPLATE_FIDELITY_AUDIT === '1') writeFileSync(resolve('../../.gstack/template-request-parity.json'), JSON.stringify(parity));
});
test('models without negative support never receive a negative prompt', () => {
    const { feed, model, contract } = fixtures.find((f: any) => !f.model.capabilities.inputs.negative_prompt);
    const [p] = parsePresets({ presets: [{ ...feed, negativePrompt: 'blur' }] });
    expect(templateRequest(p, model, { prompt: p.sourcePrompt!, aspect: contract.aspect, duration: contract.duration }).extraInputs).not.toHaveProperty('negative_prompt');
});

test('template photo slots reject known low resolution and defer unknown dimensions to server inspection', () => {
    const { checkPicked } = require('../src/lib/sources');
    const file = { uri: 'file:///photo.png', mimeType: 'image/png', size: 1000, width: 256, height: 256 };
    const limits = { minSide: 256 };
    expect(checkPicked('image', file, limits).ok).toBe(true);
    expect(checkPicked('image', { ...file, width: 100 }, limits)).toEqual({ ok: false, error: 'resolution' });
    expect(checkPicked('image', { ...file, height: 100 }, limits)).toEqual({ ok: false, error: 'resolution' });
    for (const dimensions of [
        { width: undefined }, { height: undefined }, { width: undefined, height: undefined },
        { width: 0 }, { height: 0 }, { width: 0, height: 0 },
    ]) expect(checkPicked('image', { ...file, ...dimensions }, limits).ok).toBe(true);
});

test('negative prompt survives the feed parser and Create handoff', () => {
    const { feed, model } = fixtures.find((f: any) => f.model.capabilities.inputs.negative_prompt);
    const [parsed] = parsePresets({ presets: [feed] });
    expect(parsed.negativePrompt).toBe('blur, distortion');
    const info = readTemplate(presetHref(parsed, {}, [model]).params, ['veyrnox.ai']);
    expect(info?.negativePrompt).toBe('blur, distortion');
});


test('long negative retains a safe template identity on web, mobile and server after model truncation', () => {
    const { feed, model, body, contract, serverCheck } = fixtureData.longNegative;
    const data = require('../../../lib/templateFidelityContracts.json');
    const index = data.prompts.length;
    data.prompts.push(contract.sourcePrompt);
    data.templates[contract.id] = { ...contract, sourcePromptIndex: index, promptIndex: index, photoPromptIndex: index };
    try {
        const [parsed] = parsePresets({ presets: [feed] });
        require('../src/lib/templateFidelity').rememberTemplateSource({ id: parsed.id, fidelity: contract });
        const info = readTemplate(presetHref(parsed, {}, [model]).params, ['veyrnox.ai']);
        const request = templateRequest(parsed, model, { prompt: parsed.sourcePrompt!, aspect: body.inputs.aspect_ratio || null, duration: body.inputs.duration_seconds, references: body.references, sourceRights: true });
        expect(feed.negativePrompt.length).toBeGreaterThan(model.capabilities.inputs.negative_prompt.max);
        expect(info?.negativePrompt).toBeTruthy();
        expect(body.inputs.negative_prompt).toBe(feed.negativePrompt.trim().slice(0, model.capabilities.inputs.negative_prompt.max).trimEnd());
        expect(body.template_id).toBe(contract.id);
        expect(request.templateId).toBe(contract.id);
        expect(request.extraInputs?.negative_prompt).toBe(body.inputs.negative_prompt);
        expect(serverCheck.ok).toBe(true);
        const { fidelityTemplateId } = require('../src/lib/templateFidelity');
        const { optionsFor, settingsInputs } = require('../src/lib/createOptions');
        const createInputs = { ...settingsInputs(optionsFor(model), { seed: '', negative: info!.negativePrompt, aspect: contract.aspect }), duration_seconds: contract.duration };
        expect(fidelityTemplateId(contract, contract.sourcePrompt, model.id, createInputs)).toBe(contract.id);
    } finally { delete data.templates[contract.id]; }
});

// Execute the actual Create request assembly after the real feed -> detail href ->
// readTemplate handoff. This catches divergence from the detail-page builder.
const ts = require('typescript');
const createSource = require('fs').readFileSync(resolve('src/app/(app)/create/[modelId].tsx'), 'utf8');
const createAst = ts.createSourceFile('create.tsx', createSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const assembly: string[] = [];
function visitCreate(node: any) {
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some((d: any) => ['requestPrompt', 'request'].includes(d.name.getText(createAst)))) assembly.push(node.getText(createAst));
    if (ts.isIfStatement(node) && node.expression.getText(createAst).startsWith('request.templateId')) assembly.push(node.getText(createAst));
    ts.forEachChild(node, visitCreate);
}
visitCreate(createAst);
const createRequest = new Function('context', `with (context) { ${ts.transpileModule(assembly.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText} return request; }`);

test('all bound contracts use ordered references and the same bound transport on web and mobile', async () => {
    const { templateRoute } = require('../src/lib/templateFidelity');
    expect(fixtureData.boundInventory).toHaveLength(162);
    for (const { feed, model, body, contract, serverCheck } of fixtureData.boundInventory) {
        const [parsed] = parsePresets({ presets: [feed] });
        const route = templateRoute(parsed, parsed.modelId, body.references.length);
        expect(route.modelId).toBe(model.id);
        expect(route.slotCount).toBe(body.references.length);
        const href = presetHref(parsed, {}, [model]);
        const detail = readTemplate(href.params, ['veyrnox.ai']);
        expect('modelId' in href.params && href.params.modelId).toBe('seedance-2.0-reference');
        expect(detail?.id).toBe(parsed.id);
        if (!('prompt' in href.params)) throw new Error('Create route unavailable');
        expect(href.params.prompt).toBe(contract.sourcePrompt);
        const { optionsFor, settingsInputs, resolveAudio, resolveResolution } = require('../src/lib/createOptions');
        const { templateBoundPrompt, fidelityTemplateId } = require('../src/lib/templateFidelity');
        const options = optionsFor(model), duration = Number(href.params.duration);
        const context = { contract, model, modelId: href.params.modelId, prompt: href.params.prompt, text: href.params.prompt, cameraOn: false, characterOn: false,
            references: body.references, options, opts: { seed: '', negative: detail?.negativePrompt || '', aspect: href.params.aspect || null },
            resolution: resolveResolution(model, options, null), audio: resolveAudio(model, options, null), duration, isVideo: true, swapScene: null,
            unit: feed.credits, hasReference: true, text_: { key: 'prompt' }, templatePreset: true, template: detail,
            kindOf: () => 'video', settingsInputs, templateBoundPrompt, fidelityTemplateId };
        const fromCreate = createRequest(context);
        expect({ model: fromCreate.modelId, template: fromCreate.templateId, inputs: { prompt: fromCreate.prompt, duration_seconds: fromCreate.durationSeconds, ...fromCreate.extraInputs }, references: fromCreate.references }).toEqual({ model: body.model_id, template: body.template_id, inputs: body.inputs, references: body.references });
        const request = templateRequest(parsed, model, { prompt: parsed.sourcePrompt!, aspect: body.inputs.aspect_ratio || null, duration: body.inputs.duration_seconds, references: body.references, sourceRights: true });
        expect(request.templateId).toBe(contract.id);
        for (const count of [0, contract.slotCount - 1, contract.slotCount + 1]) {
            const refs = Array.from({ length: count }, (_, i) => ({ slot: 'image' as const, origin: 'upload' as const, key: `photo-${i}` }));
            expect(templateRequest(parsed, model, { prompt: parsed.sourcePrompt!, aspect: body.inputs.aspect_ratio || null, duration: body.inputs.duration_seconds, references: refs }).templateId).toBeUndefined();
            expect(createRequest({ ...context, references: refs }).templateId).toBeUndefined();
        }
        expect(serverCheck.ok).toBe(true);
        let nativeBody: any;
        const api = { request: async (_path: string, init: { body: string }) => { nativeBody = JSON.parse(init.body); return { job_id: 'bound-job' }; } } as unknown as ApiClient;
        await mediaApi(api).createGeneration({ ...request, idempotencyKey: 'bound-key', maxCharge: 85 });
        expect({ model: nativeBody.model_id, template: nativeBody.template_id, inputs: nativeBody.inputs, references: nativeBody.references, consent: nativeBody.consent }).toEqual({ model: body.model_id, template: body.template_id, inputs: body.inputs, references: body.references, consent: body.consent });
    }
});

test('direct Create loads only the selected detail and preserves source independently of edited text', async () => {
    const { fetchTemplateContract, templateContract } = require('../src/lib/templateFidelity');
    const { contract } = fixtureData.boundInventory[0];
    const response = { template: { id: contract.id, fidelity: contract } };
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => response } as Response);
    try {
        const loaded = await fetchTemplateContract(contract.id, 'https://veyrnox.test');
        expect(loaded.prompt).toBe(contract.prompt);
        expect(loaded.tokenMap).toEqual(contract.tokenMap);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(spy).toHaveBeenCalledWith(`https://veyrnox.test/api/templates/${contract.id}`);
        expect(templateContract(contract.id).sourcePrompt).toBe(contract.sourcePrompt);
        spy.mockResolvedValue({ ok: false } as Response);
        await expect(fetchTemplateContract(contract.id, 'https://veyrnox.test')).rejects.toThrow('template_detail_unavailable');
        spy.mockResolvedValue({ ok: true, json: async () => ({ template: { id: 'wrong' } }) } as Response);
        await expect(fetchTemplateContract(contract.id, 'https://veyrnox.test')).rejects.toThrow('template_detail_mismatch');
    } finally { spy.mockRestore(); }
});
