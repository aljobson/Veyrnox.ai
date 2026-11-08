import { templateVideoDependency } from './templateVideoDependency.js';
// Shared by browser and native request builders. No catalog, crypto, environment or provider dependency.
export function fidelityBlocked(contract, prompt = '') {
  return contract?.class === 'blocked-needs-video' || templateVideoDependency(prompt);
}
export function fidelityTemplateId(contract, prompt, modelId, inputs) {
  return ['like-for-like-safe', 'bound'].includes(contract?.class) && contract.allowedModels.includes(modelId)
    && prompt === contract.prompt
    && inputs && ((inputs.aspect_ratio ?? null) === contract.aspect
      && (inputs.duration_seconds ?? null) === contract.duration
      && (inputs.negative_prompt || '').slice(0, contract.negativeMax ?? 2000).trimEnd() === contract.negativePrompt) ? contract.id : undefined;
}
export function templatePhotoError(contract, width, height, count = 1) {
  if (!contract) return null;
  if (count !== (contract.class === 'bound' ? contract.slotCount : 1) || !contract.requiredReferences.imageMax) return 'presets.fidelity.singlePhoto';
  const min = contract.minPhotoDimension;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < min || height < min) return 'presets.fidelity.photoMinimum';
  return null;
}

// Bind only an unchanged source on the target model with every slot supplied.
export function templateBoundPrompt(contract, prompt, modelId, count) {
  return contract?.class === 'bound' && modelId === contract.modelId && count === contract.slotCount
    && prompt === contract.sourcePrompt ? contract.prompt : prompt;
}

// Public capabilities carry the live, flag-aware maximum. Never enlarge it to fit a recipe.
export function templatePhotosUnavailable(contract, media) {
  return contract?.class === 'bound' && (!media?.image || (media.image.maxFiles ?? 1) < contract.slotCount);
}

// Original source excerpts explain every photo role, including already ordered tokens.
// These are user/source text, not translatable interface copy.
export function templatePhotoHints(contract) {
  if (contract?.class !== 'bound') return [];
  return Array.from({ length: contract.slotCount }, (_, index) => {
    const item = contract.tokenMap.find(item => item.slot === index + 1);
    if (!item) return '';
    return contract.sourcePrompt.slice(Math.max(0, item.offset - 40), item.offset + item.token.length + 40).replace(/\s+/g, ' ').trim();
  });
}
