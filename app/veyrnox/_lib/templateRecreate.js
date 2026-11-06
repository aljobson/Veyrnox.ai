export const TEMPLATE_RECREATE_MODEL_ID = 'kling-o1-reference';
export const TEMPLATE_RECREATE_PROMPT_MAX = 2000;

export function templateRecreateEnabled(environment = process.env.APP_ENV) {
  return environment === 'staging';
}

const PREFIX = 'Recreate the source video using its shot order, camera path, action timing, composition and duration as the motion reference.';
const REFERENCES = 'Use @Image1 for the person, product or main subject identity. Use @Image2 for the setting, materials, colour palette and lighting.';
const SUFFIX = 'Keep motion and geometry stable across the shot. Do not copy names, logos, watermarks, captions or other readable text from the source video.';

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function withoutForeignReferences(value) {
  return value
    .replace(/@\s*(?:image|video|element)\s*_?\s*\d+/gi, 'the template reference')
    .replace(/\b(?:image|video|element)[-_ ]?\d+\.(?:png|jpe?g|webp|gif|mp4|mov|webm)\b/gi, 'the template reference')
    .replace(/https?:\/\/\S+/gi, '');
}

/**
 * Turn any Veyrnox video-template prompt into an editable reference-video
 * recipe. The source prompt may name its own numbered media, so those names
 * are deliberately neutralised before this recipe assigns @Image1/@Image2.
 */
export function recreatePromptForTemplate(preset, limit = TEMPLATE_RECREATE_PROMPT_MAX) {
  const max = Number.isInteger(limit) && limit > 0
    ? Math.min(limit, TEMPLATE_RECREATE_PROMPT_MAX)
    : TEMPLATE_RECREATE_PROMPT_MAX;
  const direction = clean(withoutForeignReferences(clean(preset?.prompt))) || 'Preserve the template’s visual idea and pacing.';
  const fixed = `${PREFIX}\n\n${REFERENCES}\n\nTemplate direction: `;
  const ending = `\n\n${SUFFIX}`;
  const budget = Math.max(0, max - fixed.length - ending.length);
  return `${fixed}${direction.slice(0, budget).trimEnd()}${ending}`.slice(0, max).trimEnd();
}

export function templateRecreateHref(templateId) {
  const id = String(templateId || '').trim();
  return `/app/create?model=${encodeURIComponent(TEMPLATE_RECREATE_MODEL_ID)}&recreate=${encodeURIComponent(id)}&duration=5s`;
}

export function templateRecreateAvailable(model) {
  return model?.id === TEMPLATE_RECREATE_MODEL_ID
    && model.kind === 'video'
    && !model.gated
    && !model.premium
    && model.media?.video?.required === true
    && model.media?.image?.required === true
    && Number(model.media.image.maxFiles || 1) >= 2;
}
