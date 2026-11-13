// Keep this small: the client resolver must not import the prompt registry.
export const IMAGE_TEMPLATE_MODELS = Object.freeze(['nano-banana-kie', 'nano-banana-pro-grsai', 'nano-banana-pro-edit-grsai', 'seedream-4']);

export const imageTemplateNeedsPhoto = preset => preset?.kind === 'image' && preset.photo?.required === true;

// A missing or changed catalog capability must never silently turn a photo recipe into text-only generation.
export const imageTemplateModelAvailable = (preset, model) => !imageTemplateNeedsPhoto(preset) || Boolean(
  model?.kind === 'image' && model.media?.image && !(model.media.image.minFiles > 1)
  && !Object.entries(model.media).some(([slot, spec]) => slot !== 'image' && spec?.required));
