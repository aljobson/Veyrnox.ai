import { bind } from './templateBinding.js';
import { hasExactPromptOrigin } from './templatePromptOrigin.mjs';
import { TEMPLATE_REFERENCE_PRIORITY } from './templateReferencePriority.js';
export { templatePhotoHints, templatePhotosUnavailable, templateBoundPrompt, fidelityBlocked, fidelityTemplateId, templatePhotoError } from './templateFidelityRuntime.js';

// Only the selected template's API/source response is expanded. No full contract
// table or prompt catalog is imported into the browser or native runtime.
export function clientContractFor(preset, route) {
  if (!preset || typeof preset !== 'object') return null;
  if (preset.fidelity?.id === preset.id) return preset.fidelity;
  const sourcePrompt = hasExactPromptOrigin(preset.sourcePromptOrigin) ? preset.sourcePrompt : null;
  if (!route || typeof sourcePrompt !== 'string') return null;
  const binding = route.class === 'bound' ? bind(sourcePrompt, route.slotCount) : null;
  if (binding?.error) return null;
  const basePrompt = binding?.text ?? sourcePrompt;
  const prompt = route.identityLine ? `${TEMPLATE_REFERENCE_PRIORITY}\n\n${basePrompt}` : basePrompt;
  return { ...route, id: preset.id, allowedModels: [route.modelId], sourcePrompt, prompt,
    ...(binding ? { tokenMap: binding.map } : {}) };
}
