// Inventory captured public text, never redact or rewrite it. These patterns flag
// candidates, not ownership or personal identity; reference slots are not handles.
const fileExtension = /\.(?:png|jpe?g|webp|gif|mp4|mov|webm|heic|pdf)$/i;
const domain = /\b(?:[a-z\d-]+\.)+(?:com|org|net|ai|io|co|uk|de|ru|fr|app|dev|online|site|xyz)\b/gi;
export function promptHygieneKinds(prompt) {
  const kinds = new Set();
  if (/(?:https?:\/\/|www\.)\S+/i.test(prompt) || [...prompt.matchAll(domain)].length) kinds.add('domain');
  const handles = [...prompt.matchAll(/@[a-z][\w.]*/gi)].map(m => m[0]);
  if (handles.some(s => !/^@(?:image|video|audio)(?:[_-]?\d+)?\.?$/i.test(s))) kinds.add('handle');
  // Lowercase dotted social handles; sentence boundaries like "motion.Red" do
  // not match. Domains and upload filenames get their own inventory kinds.
  for (const m of prompt.matchAll(/(?<![\w.])[a-z][a-z\d_-]*\.[a-z][a-z\d_-]*(?![\w.])/g)) {
    if (!fileExtension.test(m[0]) && !new RegExp('^(?:' + domain.source + ')$', 'i').test(m[0])) kinds.add('handle');
  }
  if (/\b[\p{L}][\p{L} .'-]*(?:str\.|stra(?:ss|ß)e|street|road|avenue|st\.|rd\.)\s*\d+[a-z]?[,\s]+\d{4,6}\s+[\p{L}][\p{L}-]+/iu.test(prompt)
    || /\b\d+\s+[\p{L} .'-]+(?:street|road|avenue|st\.|rd\.)[^\n]{0,60}\b\d{5}(?:-\d{4})?\b/iu.test(prompt)) kinds.add('address');
  if (/\b(?:license|licence|number)\s+plate(?:\s+reading)?\s*[:“"']*\s*(?=[A-Z\d -]{0,16}\d)[A-Z\d]+(?:[ -][A-Z\d]+){0,4}\b/.test(prompt)
    || /\b(?:License|Licence|Number)\s+plate(?:\s+reading)?\s*[:“"']*\s*(?=[A-Z\d -]{0,16}\d)[A-Z\d]+(?:[ -][A-Z\d]+){0,4}\b/.test(prompt)) kinds.add('plate');
  if (/\b(?:(?:promo(?:tional)?|discount|coupon)\s+code|code)\s*[:=]\s*["'“„]?\s*[a-z\d_-]*\d[a-z\d_-]*/i.test(prompt)) kinds.add('promo code');
  if (/\b[\w-]+\.(?:png|jpe?g|webp|gif|mp4|mov|webm|heic|pdf)\b/i.test(prompt)) kinds.add('upload filename');
  return [...kinds].sort();
}
export function publicPromptHygiene(records) {
  return {
    policy: 'Captured public community prompts preserve third-party handles, plates, addresses, domains, promo codes and upload filenames verbatim by owner decision. Byte-exactness forbids redacting in place; this inventory does not change publication.',
    method: 'scripts/lib/public-prompt-hygiene.mjs scans raw text for named @handles and lowercase dotted social handles (excluding reference slots), domains/URLs, postal-code-plus-street addresses, numbered license plates, promotional codes and upload filenames. Pattern matches are candidates, not identity verification or a guarantee that all such text is detectable.',
    inventory: records.map(r => ({id:r.id, kinds:promptHygieneKinds(r.prompt)})).filter(r => r.kinds.length),
  };
}
