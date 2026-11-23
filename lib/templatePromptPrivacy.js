import { appRuntimeFlag } from './appRuntime.js';
import { templatePhotoHints } from './templateFidelityRuntime.js';
import { phoneHints } from './templatePhotoHintAround.js';
import { templatePromptPlaceholder } from './templatePromptPlaceholder.js';
export * from './templatePromptPlaceholder.js';
/**
 * Private video-template prompts (ADR-0351 amendment 23).
 *
 * With the APP_RUNTIME_FLAGS key `templatePromptsPrivate` on, the public template routes and the /presets/:id page data stop carrying
 * a video template's prompt text. In its place they carry a placeholder that names the template. Clients treat it as the template's
 * own unedited prompt (they compare it for equality and never read it); the generations route swaps the real text in on the server.
 * Light on purpose: web, mobile and the Worker all import it.
 */
export const TEMPLATE_PROMPT_PRIVATE_KEY = 'templatePromptsPrivate';

/** Absent or anything but a literal true is off, so every public answer is what it was before the key existed. */
export const templatePromptsPrivate = (env = process.env) => appRuntimeFlag(TEMPLATE_PROMPT_PRIVATE_KEY, env);

const placeholderFor = (id, value) => (typeof value === 'string' && value ? templatePromptPlaceholder(id) : value);

/**
 * One video template (a catalog entry, a recipe or a detail answer) without its prompt text. Photo-slot hints of a bound template are
 * worked out here, from the text, because the client can no longer cut them out of it. Same shape otherwise.
 */
export function withoutPromptText(template) {
    if (!template || typeof template !== 'object') return template;
    const { id } = template;
    const out = { ...template, promptPrivate: true };
    if ('prompt' in out) out.prompt = placeholderFor(id, out.prompt);
    if ('sourcePrompt' in out) out.sourcePrompt = placeholderFor(id, out.sourcePrompt);
    if (out.fidelity && typeof out.fidelity === 'object') {
        const f = out.fidelity;
        const hints = templatePhotoHints(f);
        out.fidelity = { ...f, prompt: placeholderFor(id, f.prompt), sourcePrompt: placeholderFor(id, f.sourcePrompt),
            ...(hints.length ? { photoHints: hints, photoHintsPhone: phoneHints(f) } : {}) };
        delete out.fidelity.photoPrompt;
    }
    return out;
}
