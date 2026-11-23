import { internalModelId } from '../../../lib/publicModelIds.js';
import { hasTemplatePlaceholder, placeholderTemplateId } from '../../../lib/templatePromptPlaceholder.js';

// With templatePromptsPrivate on (ADR-0351 amendment 23) a video template reaches the browser with a placeholder where its prompt was.
// The browser treats the placeholder as the template's own unedited prompt and never reads it; the server swaps the real text in when
// the run is submitted. These are the only places the text is fetched: Edit prompt, and the two handoffs that need the words themselves.
export const isPrivateTemplate = (template) => template?.promptPrivate === true;

/** The prompt Create and the template page start from: the community prompt when one is recorded, otherwise the recipe. */
export const ownPromptOf = (template) => (template?.sourcePromptOrigin === 'community-source-exact' && typeof template.sourcePrompt === 'string' ? template.sourcePrompt : template?.prompt);

/** The whole template, prompt included, for the signed-in caller; null when it cannot be read. A signed-out caller is asked to sign in (gatewayFetch). */
export async function fetchPrivateTemplate(id) {
  try {
    // Loaded when needed: the gateway is browser-only, and this module is also read by code that runs under Node tests.
    const { gatewayFetch } = await import('./gateway');
    const { template } = await gatewayFetch(`/templates/${encodeURIComponent(id)}/prompt`);
    if (!template || template.id !== id) return null;
    return { ...template, modelId: internalModelId(template.modelId), boundModelId: internalModelId(template.boundModelId) };
  } catch {
    return null;
  }
}

/** The words behind a text that holds a placeholder (a template's own prompt, or the prompt with extras around it); other text comes back as it is. */
export async function withTemplateText(text) {
  if (!hasTemplatePlaceholder(text)) return text;
  const ids = new Set();
  text.replace(/\[\[template-prompt:([a-z0-9-]{1,40})\]\]/g, (_whole, id) => { ids.add(id); return ''; });
  const texts = new Map();
  for (const id of ids) {
    const full = await fetchPrivateTemplate(id);
    if (!full) return null;
    texts.set(id, ownPromptOf(full));
  }
  return text.replace(/\[\[template-prompt:([a-z0-9-]{1,40})\]\]/g, (_whole, id) => texts.get(id));
}

export { placeholderTemplateId };
