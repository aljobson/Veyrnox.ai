// Separate from templates and presets. Publication requires the server gate.
// No scenes ship until their clips have passed the owner's rights/moderation review.
export const SWAP_SCENES = Object.freeze([]);
const PUBLIC_FIELDS = ['id', 'name', 'category', 'aspect', 'needs', 'swapOffer', 'people', 'model', 'credits', 'durationSeconds'];

export function publicSwapScene(id, scenes = SWAP_SCENES) {
  const scene = typeof id === 'string' && scenes.find(item => item.id === id);
  if (!scene) return null;
  return Object.fromEntries(PUBLIC_FIELDS.map(field => [field, field === 'durationSeconds' ? 5 : scene[field]]));
}
