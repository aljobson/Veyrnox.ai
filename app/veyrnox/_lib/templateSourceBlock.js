import { templateRouteContract } from '../../../lib/templateRoute.js';
import { fidelityBlocked } from '../../../lib/templateFidelityRuntime.js';
import { TEMPLATE_SWAP_CLIPS } from './templateSwapClips.js';
// Some exact community prompts say "use @video1 as the performance". Veyrnox has no video reference slot to pass a
// source video to the model, so generating them cannot reproduce the preview: the model never
// sees the footage and invents a different clip. Those templates stay readable as inspiration but do not generate.
// (A prompt that only needs the person's photo is not blocked: sourcePromptRunnable is about the input contract; this is
// about inputs we cannot supply at all.)
export const UNSUPPORTED_SOURCE_ISSUES = Object.freeze(['reference-video-not-supported']);

export function templateSourceUnsupported(template) {
  // Registered swaps need their reviewed source clip. If the live swap gate is unavailable, never fall back to a
  // prompt-only model: some captured community prompts are truncated and do not mention the missing video at all.
  if (typeof template?.id === 'string' && TEMPLATE_SWAP_CLIPS.includes(template.id)) return true;
  const contract = templateRouteContract(template?.id);
  if (contract) return fidelityBlocked(contract);
  return /@video\s*[_-]?\d|<<<\s*video/i.test(template?.sourcePrompt || '') || (template?.sourcePromptOrigin === 'community-source-exact'
    && Array.isArray(template.sourcePromptIssues)
    && template.sourcePromptIssues.some((issue) => UNSUPPORTED_SOURCE_ISSUES.includes(issue)));
}
