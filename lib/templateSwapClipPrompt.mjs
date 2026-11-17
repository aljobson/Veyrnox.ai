import { TEMPLATE_FACE_WORDING } from './templateFaceWording.mjs';
// Face-fidelity wording, tested on the owner's fal account (ADR-0351 amendment 1). Not a pixel guarantee. Tagged references remain unproven.
export const TEMPLATE_SWAP_CLIP_PROMPT = `Replace the main character in the video with the person in the reference image or images. ${TEMPLATE_FACE_WORDING} Keep the same body build and clothing as in the reference. Keep the video's motion, camera, scene, lighting and timing unchanged.`;
