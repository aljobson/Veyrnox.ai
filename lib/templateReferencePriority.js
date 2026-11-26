export const TEMPLATE_REFERENCE_PRIORITY = "REFERENCE PRIORITY: Preserve the attached image's main subject, identity and appearance in every frame; ignore conflicting descriptions.";

/**
 * Give every photo-driven video template the same reference-first contract.
 * The captured community prompt remains intact after the priority line. A
 * null result means the model cannot fit the guard inside its prompt limit.
 */
export function withTemplateReferencePriority(prompt, withPhoto, max) {
  const text = typeof prompt === 'string' ? prompt : '';
  if (!withPhoto || text.startsWith(`${TEMPLATE_REFERENCE_PRIORITY}\n\n`)) return text;
  const guarded = `${TEMPLATE_REFERENCE_PRIORITY}\n\n${text}`;
  return Number.isInteger(max) && max > 0 && guarded.length <= max ? guarded : null;
}
