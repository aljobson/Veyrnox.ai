// Models that are the same job at two output resolutions. fal's Kling 3.0 image-to-video has no resolution field
// (ADR-0350), so the choice is the endpoint: Standard is the 720p class, Pro the 1080p class. Each variant is its own
// catalog model with its own catalog price; this file only groups them for the Create page.
export const RESOLUTION_VARIANTS = Object.freeze([
  Object.freeze([
    Object.freeze({ label: '720p', id: 'kling-3.0-standard-i2v' }),
    Object.freeze({ label: '1080p', id: 'kling-3.0-i2v' }),
  ]),
]);

/**
 * The resolution choices for a model, lowest first, or [] when it has none. Only variants present in `models`
 * (the live, active catalog) count, so a switched-off variant never appears.
 * @param {string|undefined} modelId
 * @param {Array<{id:string}>} models
 * @returns {Array<{label:string, model:object}>}
 */
export function resolutionVariants(modelId, models) {
  const group = RESOLUTION_VARIANTS.find((variants) => variants.some((variant) => variant.id === modelId));
  if (!group) return [];
  const present = group.flatMap((variant) => {
    const model = models.find((item) => item.id === variant.id);
    return model ? [{ label: variant.label, model }] : [];
  });
  return present.length > 1 ? present : [];
}
