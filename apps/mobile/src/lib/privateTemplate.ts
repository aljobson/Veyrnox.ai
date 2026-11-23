import type { ApiClient } from './api';
import { rememberTemplateSource } from './templateSourceCache';
import { hasTemplatePlaceholder } from '../../../../lib/templatePromptPlaceholder';

// With templatePromptsPrivate on (ADR-0351 amendment 23) the feed carries a placeholder where a video template's prompt was. The phone
// treats it as the template's own unedited prompt and sends it as it is; the server puts the words in. Edit prompt reads them here,
// for the signed-in person only, and the contract the screen already holds is replaced by the full one so the run stays audited.
export { isTemplatePromptPlaceholder, placeholderTemplateId, hasTemplatePlaceholder } from '../../../../lib/templatePromptPlaceholder';

export interface PrivatePrompt { readonly prompt: string; readonly sourcePrompt: string | null; readonly own: string }

export async function fetchPrivatePrompt(api: ApiClient, id: string): Promise<PrivatePrompt | null> {
    if (!/^[a-z0-9-]{1,40}$/.test(id)) return null;
    try {
        const body = await api.request<{ template?: Record<string, unknown> }>(`/api/v1/templates/${encodeURIComponent(id)}/prompt`);
        const template = body?.template;
        if (!template || template.id !== id || typeof template.prompt !== 'string' || !template.prompt) return null;
        const sourcePrompt = template.sourcePromptOrigin === 'community-source-exact' && typeof template.sourcePrompt === 'string' && template.sourcePrompt ? template.sourcePrompt : null;
        rememberTemplateSource(template as unknown as Parameters<typeof rememberTemplateSource>[0]);
        return { prompt: template.prompt, sourcePrompt, own: sourcePrompt ?? template.prompt };
    } catch {
        return null;
    }
}

/** The words behind a text that holds a placeholder (the prompt, or the prompt with extras around it); any other text comes back as it is. */
export async function withTemplateWords(api: ApiClient, text: string): Promise<string | null> {
    if (!hasTemplatePlaceholder(text)) return text;
    const ids = [...new Set([...text.matchAll(/\[\[template-prompt:([a-z0-9-]{1,40})\]\]/g)].map(match => match[1]!))];
    const words = new Map<string, string>();
    for (const id of ids) {
        const full = await fetchPrivatePrompt(api, id);
        if (!full) return null;
        words.set(id, full.own);
    }
    return text.replace(/\[\[template-prompt:([a-z0-9-]{1,40})\]\]/g, (_whole, id: string) => words.get(id) ?? '');
}
