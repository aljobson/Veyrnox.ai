// ADR-0351 amendment 3: conservative documented endpoint budget, not an input cap.
export const TEMPLATE_FACE_WORDING_LIMIT = 2000;
export const TEMPLATE_FACE_WORDING = "The new person's face must match the reference exactly: same face shape, jawline, forehead, nose, lips, eye shape, skin tone, hairline, hair and facial hair, and the same natural expression character. Do not slim, smooth, retouch, beautify or idealise the face, and do not change the person's age or features.";
export const TEMPLATE_FACE_WORDING_COMPACT = "Match the reference person's face, age, features, hair and natural expression exactly, without slimming, smoothing, retouching or beautifying.";
export function templateFacePrompt(prompt) {
  if (prompt.includes(TEMPLATE_FACE_WORDING) || prompt.includes(TEMPLATE_FACE_WORDING_COMPACT)) return prompt;
  for (const wording of [TEMPLATE_FACE_WORDING, TEMPLATE_FACE_WORDING_COMPACT]) {
    if (!prompt.trim()) return wording;
    if (prompt.length + 1 + wording.length <= TEMPLATE_FACE_WORDING_LIMIT) return `${prompt} ${wording}`;
  }
  return null;
}
