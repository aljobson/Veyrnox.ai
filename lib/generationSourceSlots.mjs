// Public slot names describe media type; provider field names remain server-only.
const kinds = Object.freeze({ image: 'image', endImage: 'image', video: 'video', audio: 'audio' });
const mimeTypes = Object.freeze({ image: Object.freeze(['image/jpeg','image/png','image/webp']), video: Object.freeze(['video/mp4']), audio: Object.freeze(['audio/mpeg','audio/wav']) });
export const generationSlotKind = slot => Object.hasOwn(kinds,slot) ? kinds[slot] : null;
export const generationMimeTypes = kind => Object.hasOwn(mimeTypes,kind) ? mimeTypes[kind] : [];
export const mediaInputKey = slot => generationSlotKind(slot) ? `${slot}_url` : null;
