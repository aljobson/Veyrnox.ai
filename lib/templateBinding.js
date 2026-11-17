// The only editable bytes in an exact source are these explicit image-slot tokens.
export const BINDING_MODEL = 'seedance-2.0-reference';
// ADR-0309 amendment 2: BINDING_MODEL refuses pictures of real people. A single-photo template is bound to the Kling frame model (same
// token rewrite); recipes that need several pictures have no people-safe target and take the legacy route.
export const PEOPLE_BINDING_MODEL = 'kling-3.0-i2v';
// Bare labels require capital Image and a label delimiter; narrative quantities are not slots.
export const imageTokenPattern = () => /@[iI][mM][aA][gG][eE](?:\s*[_-]?(\d+|[xX])\b|\b(?![_-]))|<<<\s*[iI][mM][aA][gG][eE][_\s-]*(\d+)\s*>>>|\bImage\s+(\d+)\b(?=\s*(?::(?!\s*\d)|[-–—](?!\s*\d)))|\b[iI][mM][aA][gG][eE][_-](\d+)\.(?:[pP][nN][gG]|[jJ][pP][eE]?[gG]|[wW][eE][bB][pP]|[gG][iI][fF])\b/g;
// Reserve every explicit number first; each x occurrence gets the next unused number.
function imageTokens(source) {
  const matches = [...String(source).matchAll(imageTokenPattern())];
  const value = m => m[1] || m[2] || m[3] || m[4];
  const numbered = matches.some(m => value(m));
  const used = new Set(matches.filter(m => /^\d+$/.test(value(m))).map(m => Number(value(m))));
  let next = 1;
  return matches.filter(m => value(m) || !numbered).map(m => {
    let number = Number(value(m) || 1);
    if (/^x$/i.test(value(m))) {
      while (used.has(next)) next++;
      number = next++; used.add(number);
    }
    return { token: m[0], offset: m.index, number };
  });
}
function replaceTokens(source, tokens, replacement) {
  let text = '', start = 0;
  for (const token of tokens) {
    text += source.slice(start, token.offset) + replacement(token);
    start = token.offset + token.token.length;
  }
  return text + source.slice(start);
}
export function imageSlots(source) {
  return [...new Set(imageTokens(source).map(t => t.number))];
}
export function bind(source, slotCount, modelId = BINDING_MODEL) {
  if (modelId !== BINDING_MODEL) return { error: 'unsupported-binding-model' };
  if (typeof source !== 'string') return { error: 'invalid-source' };
  const tokens = imageTokens(source);
  const slots = [...new Set(tokens.map(t => t.number))];
  if (!slots.length || slots.some(n => !Number.isSafeInteger(n) || n < 1)) return { error: 'invalid-image-slots' };
  if (slots.length > 9) return { error: 'too-many-image-slots' };
  if (slotCount !== slots.length) return { error: 'image-slot-count-mismatch' };
  const remainder = replaceTokens(source, tokens, () => '');
  if (/<[^>]+>/.test(remainder)) return { error: 'unmapped-placeholder' };
  if (/@\s*image|\bimage[_-]\d/i.test(remainder) || /\b(?:Image|IMAGE)\s+\d+\b(?!\s*(?::\s*\d|[-–—]\s*\d|of\s+the\s+(?:set|series)\b|meters?\b|seconds?\b|secs?\b|px\b|pixels?\b|k\b))/.test(remainder)) return { error: 'unmapped-image-reference' };
  const map = [];
  const text = replaceTokens(source, tokens, ({ token, number, offset }) => {
    const slot = slots.indexOf(number) + 1;
    const target = `@Image${slot}`;
    map.push({ token, target, slot, offset });
    return target;
  });
  return { text, map };
}
