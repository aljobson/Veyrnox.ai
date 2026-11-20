import { normaliseSwapRole } from './templateSwapClipRoles.mjs';
import { TEMPLATE_FACE_WORDING } from './templateFaceWording.mjs';
// Face-fidelity wording (ADR-0351 amendment 1) plus the background clause (amendment 4). Tested on the owner's fal account, not a pixel guarantee. Tagged references remain unproven.
export const TEMPLATE_SWAP_CLIP_PROMPT = `Replace the main character in the video with the person in the reference image or images. ${TEMPLATE_FACE_WORDING} Keep the same body build and clothing as in the reference. Use the reference image only for the person: ignore its background, setting and lighting completely. Keep the video's scene, background, camera, lighting, motion and timing unchanged.`;

// Revision 2: one reviewed character; these bytes also define the owner's A/B.
export function templateSwapPrompt(role) {
  const safe = normaliseSwapRole(role);
  if (!safe) throw new Error('template_swap_role_invalid');
  return `Change ${safe} in @Video1 to @Element1. Leave every other person, object and the whole scene exactly as in @Video1, including the environment, background, sky, camera movement, lighting and timing. Do not alter @Element1's facial features, face shape, age or body proportions. Use the element images only for the person; ignore their background, setting and lighting.`;
}

// Two people (ADR-0351 amendment 12, behind the templateSwapPeople key). Slot order is fixed: first role = @Element1, second = @Element2.
export function templateSwapPeoplePrompt(roles) {
  const [first, second] = Array.isArray(roles) && roles.length === 2 ? roles.map(normaliseSwapRole) : [];
  if (!first || !second || first === second) throw new Error('template_swap_role_invalid');
  return `Change ${first} in @Video1 to @Element1 and change ${second} in @Video1 to @Element2. They are two different people: keep both, do not merge them, swap them or drop either one. Leave every other person, object and the whole scene exactly as in @Video1, including the environment, background, sky, camera movement, lighting and timing. Do not alter @Element1's or @Element2's facial features, face shape, age or body proportions. Use the element images only for the people; ignore their background, setting and lighting.`;
}
