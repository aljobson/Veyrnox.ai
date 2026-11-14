// Shared UI contract. Provider spelling lives only in templateClipProviderPrompt.
export const TEMPLATE_CLIP_PROMPT = 'Use @video1 as the scene reference. Preserve its setting, composition, camera movement, timing and lead character motion. Replace only the lead character with the person from @image1. Keep the person’s face, hair, clothing and identity consistent throughout every frame, expression and turn.';
export const TEMPLATE_CLIP_PROMPT_MAX = 2000;
// Unicode word boundaries also reject email-like and nested @ tokens.
// Consume a separator instead of lookbehind so native regex engines can share this contract.
const tokenPattern = () => /(^|[^\p{L}\p{M}\p{N}_@])@(video1|image1)(?![\p{L}\p{M}\p{N}_])/giu;
export function normalizeTemplateClipPrompt(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ').replace(tokenPattern(), (_match, prefix, tag) => prefix + '@' + tag.toLowerCase()) : '';
}
export function templateClipSegments(text) {
  const segments = []; let start = 0;
  for (const match of text.matchAll(tokenPattern())) {
    const index = match.index + match[1].length;
    const token = '@' + match[2].toLowerCase();
    segments.push({ text: text.slice(start, index) });
    segments.push({ token });
    start = index + token.length;
  }
  segments.push({ text: text.slice(start) });
  return segments;
}
export function validTemplateClipPrompt(value) {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > TEMPLATE_CLIP_PROMPT_MAX) return false;
  const tokens = templateClipSegments(value).filter(s => s.token).map(s => s.token);
  return tokens.filter(t => t === '@video1').length === 1 && tokens.filter(t => t === '@image1').length === 1;
}
export function templateClipPhotoPrompt(text, attached) {
  const segments = templateClipSegments(text);
  if (!attached) return segments.map(s => s.token === '@image1' ? '' : s.token ?? s.text).join('');
  if (segments.some(s => s.token === '@image1')) return text;
  // Restore the original insertion point when the surrounding default words remain.
  return text.includes('person from .') ? text.replace('person from .', 'person from @image1.') : `${text.trimEnd()} @image1`;
}
export function templateClipProviderPrompt(value, model) {
  if (value !== undefined && typeof value !== 'string') return null;
  const text = typeof value === 'string' && value.trim() ? value : TEMPLATE_CLIP_PROMPT;
  if (!validTemplateClipPrompt(text)) return null;
  const mappings = {
    'seedance-2.0-reference': { '@video1': '@Video1', '@image1': '@Image1' },
    'seedance-2.0-reference-kie': { '@video1': '@Video1', '@image1': '@Image1' },
  };
  const mapping = mappings[model];
  return mapping ? normalizeTemplateClipPrompt(text).replace(tokenPattern(), (_match, prefix, tag) => prefix + mapping['@' + tag]) : null;
}
