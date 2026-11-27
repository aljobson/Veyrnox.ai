import { swapNeedsSourceVideo } from '../../../lib/templateSwapGuard.js';
import { TEMPLATE_SWAP_CLIPS } from './templateSwapClips.js';

// A swap recipe replaces a person in the template's own clip. On any other route the model never sees that clip, so while the
// prompt is still the template's own, Create must not charge for it. An edited prompt is the customer's own custom run.
export function swapTemplatePromptKept(template, prompt) {
  if (!template || (!TEMPLATE_SWAP_CLIPS.includes(template.id) && !swapNeedsSourceVideo(template.sourcePrompt))) return false;
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  return [template.prompt, template.sourcePrompt].some(own => typeof own === 'string' && own.trim() === text);
}

export const swapTemplateHref = id => `/app/create?preset=${encodeURIComponent(id)}`;
