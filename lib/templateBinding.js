// The only editable bytes in an exact source are these explicit image-slot tokens.
export const BINDING_MODEL = 'seedance-2.0-reference';
// Bare labels require capital Image and a label delimiter; narrative quantities are not slots.
export const imageTokenPattern = () => /@[iI][mM][aA][gG][eE]\s*[_-]?(\d+)\b|<<<\s*[iI][mM][aA][gG][eE][_\s-]*(\d+)\s*>>>|\bImage\s+(\d+)\b(?=\s*(?::(?!\s*\d)|[-–—](?!\s*\d)))|\b[iI][mM][aA][gG][eE][_-](\d+)\.(?:[pP][nN][gG]|[jJ][pP][eE]?[gG]|[wW][eE][bB][pP]|[gG][iI][fF])\b/g;
export function imageSlots(source) {
  return [...new Set([...String(source).matchAll(imageTokenPattern())].map(m => Number(m[1] || m[2] || m[3] || m[4])))];
}
export function bind(source, slotCount, modelId = BINDING_MODEL) {
  if (modelId !== BINDING_MODEL) return { error: 'unsupported-binding-model' };
  if (typeof source !== 'string') return { error: 'invalid-source' };
  const slots = imageSlots(source);
  if (!slots.length || slots.some(n => !Number.isSafeInteger(n) || n < 1)) return { error: 'invalid-image-slots' };
  if (slots.length > 9) return { error: 'too-many-image-slots' };
  if (slotCount !== slots.length) return { error: 'image-slot-count-mismatch' };
  const remainder = source.replace(imageTokenPattern(), '');
  if (/<[^>]+>/.test(remainder)) return { error: 'unmapped-placeholder' };
  if (/@\s*image|\bimage[_-]\d/i.test(remainder) || /\b(?:Image|IMAGE)\s+\d+\b(?!\s*(?::\s*\d|[-–—]\s*\d|of\s+the\s+(?:set|series)\b|meters?\b|seconds?\b|secs?\b|px\b|pixels?\b|k\b))/.test(remainder)) return { error: 'unmapped-image-reference' };
  const map = [];
  const text = source.replace(imageTokenPattern(), (token, a, b, c, d, offset) => {
    const slot = slots.indexOf(Number(a || b || c || d)) + 1;
    const target = `@Image${slot}`;
    map.push({ token, target, slot, offset });
    return target;
  });
  return { text, map };
}
