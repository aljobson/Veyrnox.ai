import { IMAGE_TEMPLATES, imageTemplatesEnabled } from '../app/veyrnox/_lib/imageTemplates.js';
import { templateContract } from './templateContract.js';
import { fidelityBlocked } from './templateFidelityRuntime.js';
import { readGenerationSources } from './generationSources.js';
export { fidelityBlocked, fidelityTemplateId, templatePhotoError } from './templateFidelityRuntime.js';


// Runs before rate-limit RPCs, media resolution, allowance consumption or debit.
export function checkTemplateRequest(body) {
  // Image recipes never enter video fidelity, including stale explicitly attributed requests.
  if (IMAGE_TEMPLATES.some(template => template.id === body.template_id)) {
    return { ok: false, error: imageTemplatesEnabled() ? 'image_template_unattributed' : 'image_templates_disabled' };
  }
  // Clients send the public template id verbatim as preset (templateStartIdFor).
  // Ranking provenance cannot bypass the video guard by omitting template_id.
  const preset = IMAGE_TEMPLATES.some(template => template.id === body.preset) ? null : templateContract(body.preset);
  if (preset && ((preset.class === 'blocked-needs-video' && body.inputs?.prompt === preset.sourcePrompt)
      || fidelityBlocked(null, body.inputs?.prompt))) return { ok: false, error: 'template_blocked' };
  if (body.template_id === undefined) return { ok: true };
  const c = templateContract(body.template_id);
  if (!c) return { ok: false, error: 'template_mismatch' };
  if (fidelityBlocked(null, body.inputs?.prompt) || (c.class === 'blocked-needs-video' && (body.inputs?.prompt === undefined || body.inputs?.prompt === c.sourcePrompt))) return { ok: false, error: 'template_blocked' };
  // Unsupported and literal-token runs retain normal admission, without an audited identity.
  if (!['like-for-like-safe', 'bound'].includes(c.class)) return { ok: true };
  const sources = readGenerationSources(body);
  const refs = sources.references || [];
  // Contract calls use explicit slots: do not guess legacy descriptors or accept an end-frame/video override.
  if (!sources.ok || (c.class === 'bound' && refs.length !== c.slotCount) || refs.some(r => r.slot !== 'image') || refs.length < c.requiredReferences.imageMin
      || refs.length > c.requiredReferences.imageMax || body.video_url !== undefined
      || ['image_url', 'endImage_url', 'video_url', 'audio_url'].some(k => body.inputs?.[k] !== undefined)) {
    return { ok: false, error: 'template_references_invalid' };
  }
  const inputs = body.inputs || {};
  const expected = c.prompt;
  if (!c.allowedModels.includes(body.model_id) || inputs.prompt !== expected
      || (inputs.aspect_ratio ?? null) !== c.aspect || (inputs.duration_seconds ?? null) !== c.duration
      || (inputs.negative_prompt || '') !== c.negativePrompt || body.swap !== undefined) {
    return { ok: false, error: 'template_mismatch' };
  }
  return { ok: true, metadata: { template_id: c.id, contract_version: c.contractVersion,
    source_hash: c.sourceHash } };
}
