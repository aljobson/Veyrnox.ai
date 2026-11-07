import { templateContract, rememberTemplateSource, fidelityTemplateId } from '../src/lib/templateFidelity';
import { templateRequest } from '../src/lib/templateGenerate';
import { checkPicked } from '../src/lib/sources';
import type { CatalogModel } from '../src/lib/media';
import type { Preset } from '../src/lib/presets';
const data = require('../../../lib/templateFidelityContracts.json');
for (const id of Object.keys(data.templates)) rememberTemplateSource({ id, fidelity: require('../../../lib/expandTemplateContract').expandFidelityContract(data, id) });
const c = Object.keys(data.templates).map(id => templateContract(id)!).find(c => c.class === 'like-for-like-safe' && c.aspect && c.duration)!;
const model = { id: c.modelId, modality: 'text-to-video', credits: 10, durations: [5, 10], capabilities: { inputs: { prompt: { type: 'string' }, aspect_ratio: { type: 'enum', values: [c.aspect, 'custom-shape'] }, negative_prompt: { type: 'string' } }, media: {} } } as unknown as CatalogModel;
const preset = { id: c.id, modelId: c.modelId, prompt: c.sourcePrompt, sourcePrompt: c.sourcePrompt, sourcePromptOrigin: 'community-source-exact', negativePrompt: c.negativePrompt } as Preset;
const choice = { prompt: c.sourcePrompt, aspect: c.aspect, duration: c.duration };

test.each([
    ['aspect', { aspect: 'custom-shape' }],
    ['duration', { duration: 99 }],
    ['prompt', { prompt: 'Changed prompt' }],
])('mobile changed %s omits template_id', (_name, changes) => {
    expect(templateRequest(preset, model, choice).templateId).toBe(c.id);
    expect(templateRequest(preset, model, { ...choice, ...changes }).templateId).toBeUndefined();
});
test('mobile changed model and negative prompt omit template_id', () => {
    expect(templateRequest(preset, { ...model, id: 'different-model' }, choice).templateId).toBeUndefined();
    expect(templateRequest({ ...preset, negativePrompt: 'changed negative' }, model, choice).templateId).toBeUndefined();
});
test('Create contract matching checks every submitted setting', () => {
    const inputs = { aspect_ratio: c.aspect, duration_seconds: c.duration, negative_prompt: c.negativePrompt };
    expect(fidelityTemplateId(c, c.sourcePrompt, c.modelId, inputs)).toBe(c.id);
    expect(fidelityTemplateId(c, c.sourcePrompt, c.modelId, { ...inputs, duration_seconds: 99 })).toBeUndefined();
    expect(fidelityTemplateId(c, c.sourcePrompt, c.modelId, { ...inputs, aspect_ratio: 'changed' })).toBeUndefined();
    expect(fidelityTemplateId(c, c.sourcePrompt, c.modelId, { ...inputs, negative_prompt: 'changed' })).toBeUndefined();
});
test.each([0, undefined])('unknown photo width %s passes the client floor for server inspection', width => {
    expect(checkPicked('image', { uri: 'file:///photo.png', mimeType: 'image/png', size: 1000, width, height: 512 }, { minSide: 256 }).ok).toBe(true);
});
test.each([0, undefined])('unknown photo height %s passes the client floor for server inspection', height => {
    expect(checkPicked('image', { uri: 'file:///photo.png', mimeType: 'image/png', size: 1000, width: 512, height }, { minSide: 256 }).ok).toBe(true);
});
