import { appRuntimeFlag, templateSwapSwitchOn } from './appRuntime.js';

// Full-body photos for one-person swap templates (ADR-0351 amendment 18). Own runtime key inside APP_RUNTIME_FLAGS (no new
// binding); absent = off, and it needs the swap switch too. With the key on the client sends a third image of the same
// person: [tight face crop, head-and-shoulders crop, full-body cut-out]. The server builds ONE element from them:
// frontal_image_url = the face crop, reference_image_urls = [head-and-shoulders, full body]. fal's OmniVideoElementInput
// allows 1 to 3 reference_image_urls per element (OpenAPI read 2026-11-20). Two-person clips keep two images per person.
export const templateSwapFullBodyOn = (env = process.env) => templateSwapSwitchOn(env) && appRuntimeFlag('templateSwapFullBody', env);

export const TEMPLATE_SWAP_FULL_BODY_IMAGES = 3;

/** Image counts the route accepts for one admission. Key on keeps the two-image request valid, so older clients still work. */
export function templateSwapImageCounts(people, fullBody) {
  return people === 1 && fullBody === true ? [2, TEMPLATE_SWAP_FULL_BODY_IMAGES] : [people * 2];
}

/** Largest side the route accepts per position. Two images: [whole cut-out 1536, crop 1024]. Three: [face 1024, crop 1024, whole cut-out 1536]. */
export function templateSwapImageCaps(count) {
  return count === TEMPLATE_SWAP_FULL_BODY_IMAGES ? [1024, 1024, 1536] : Array.from({ length: count }, (_, i) => (i % 2 === 0 ? 1536 : 1024));
}
