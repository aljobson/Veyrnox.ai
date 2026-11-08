import { contractData } from '../../lib/expandTemplateContract.js';
import { nearestOption } from '../../lib/aspectShapes.mjs';
// Executed in Node by Jest so web dependencies use their own module resolver.
import { PRESETS } from '../../app/veyrnox/_lib/templates.js';
import { toPublicPresets } from '../../lib/publicPresets.js';
import { fallbackCapabilitiesFor } from '../../lib/fallbackModelCapabilities.js';
import { modelIdForName, templateModelId } from '../../app/veyrnox/_lib/tokens.js';
import { templateInputs, submitTemplate, templateRun } from '../../app/veyrnox/_lib/templateGenerate.js';
import data from '../../lib/templateFidelityContracts.json' with { type: 'json' };
import { checkTemplateRequest } from '../../lib/templateFidelity.js';
import { auditTemplate, packContracts, audit } from '../../scripts/audit-template-fidelity.mjs';
const { contracts } = audit();
const output = [];
const negativeSource = PRESETS.find(p => contracts[p.id]?.class === 'like-for-like-safe' && fallbackCapabilitiesFor(modelIdForName(p.model))?.inputs.negative_prompt);
const longNegative = { ...negativeSource, id: 'fix4-long-negative', negativePrompt: '  ' + 'blur '.repeat(600) + '  ' };
const longContract = auditTemplate(longNegative);
contracts[longNegative.id] = longContract;
const packed = packContracts({ [longNegative.id]: longContract });
const storedPrompts = contractData(data).prompts;
const offset = storedPrompts.length;
storedPrompts.push(...packed.prompts);
for (const key of ['sourcePromptIndex', 'promptIndex', 'photoPromptIndex']) packed.templates[longNegative.id][key] += offset;
contractData(data).templates[longNegative.id] = packed.templates[longNegative.id];
for (const original of [...PRESETS, longNegative]) {
  const c = contracts[original.id];
  if (!c) continue;
  const modelId = templateModelId(original);
  const cap = fallbackCapabilitiesFor(modelId);
  const p = original === longNegative ? { ...original, fidelity: longContract } : { ...original, negativePrompt: cap.inputs.negative_prompt ? 'blur, distortion' : '' };
  const model = { id: modelId, name: p.model, modality: cap.media.image ? 'image-to-video' : 'text-to-video', credits: 32, gated: false, durations: cap.lengths, capabilities: cap };
  const webModel = { ...model, kind: 'video', negativeMax: cap.inputs.negative_prompt?.max, takesNegative: !!cap.inputs.negative_prompt };
  const [feed] = toPublicPresets([model], [original === longNegative ? { ...p, id: negativeSource.id } : p]);
  feed.id = p.id;
  const references = cap.media.image ? [{ slot: 'image', origin: 'upload', key: 'uploads/photo.png' }] : [];
  const inputs = templateInputs(p, webModel, { prompt: p.sourcePrompt, aspect: nearestOption(c.aspect, cap.inputs.aspect_ratio?.values || []) || cap.inputs.aspect_ratio?.values?.[0] || null, aspectOptions: cap.inputs.aspect_ratio?.values || [], durationSeconds: c.duration, withPhoto: references.length > 0 });
  let body;
  await submitTemplate({ run: templateRun(null, 'parity', 32, () => 'parity-key'), quote: { ceilings: [32] }, model: webModel, preset: p, inputs, makeKey: () => 'parity-key', deps: { sources: async () => ({ references }), gatewayFetch: async (_, init) => { body = JSON.parse(init.body); return { job_id: 'job' }; }, onJob: () => {} } });
  output.push({ feed, model, body, contract: c, serverCheck: original === longNegative ? checkTemplateRequest(body) : undefined });
}
const boundInventory = [];
for (const p of PRESETS.filter(p => contracts[p.id]?.class === 'bound')) {
  const c = contracts[p.id];
  // Use default navigation, with no model injected from the contract.
  const modelId = templateModelId(p);
  const cap = fallbackCapabilitiesFor(modelId);
  const model = { id: modelId, modality: 'image-to-video', credits: 85, durations: cap.lengths, capabilities: cap };
  const [feed] = toPublicPresets([model], [p]);
  const references = Array.from({ length: c.slotCount }, (_, i) => ({ slot: 'image', origin: 'upload', key: `uploads/photo-${i}.png` }));
  const inputs = templateInputs(p, { ...model, kind: 'video', negativeMax: cap.inputs.negative_prompt?.max, takesNegative: !!cap.inputs.negative_prompt }, { prompt: p.sourcePrompt, aspect: c.aspect, aspectOptions: cap.inputs.aspect_ratio.values, durationSeconds: c.duration, withPhoto: true });
  let body;
  await submitTemplate({ run: templateRun(null, p.id, 85, () => 'bound-parity'), quote: { ceilings: [85] }, model, preset: p, inputs, deps: { sources: async () => ({ references }), gatewayFetch: async (_, init) => { body = JSON.parse(init.body); return { job_id: 'job' }; }, onJob() {} } });
  boundInventory.push({ feed, model, body, contract: c, serverCheck: checkTemplateRequest(body) });
}
console.log(JSON.stringify({ longNegative: output.pop(), inventory: output, boundInventory }));
