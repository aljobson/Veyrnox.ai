// The text a client holds in place of a private video template's prompt (lib/templatePromptPrivacy.js, ADR-0351 amendment 23).
// No imports: the web app, the phone app and the Worker all load it.
const ID = '[a-z0-9-]{1,40}';
const PLACEHOLDER_SOURCE = `\\[\\[template-prompt:(${ID})\\]\\]`;
const PLACEHOLDER_RE = new RegExp(`^${PLACEHOLDER_SOURCE}$`);

export const templatePromptPlaceholder = (id) => `[[template-prompt:${id}]]`;

/** The template id when the whole text is exactly one placeholder, otherwise null. */
export const placeholderTemplateId = (text) => (typeof text === 'string' ? PLACEHOLDER_RE.exec(text)?.[1] ?? null : null);

export const isTemplatePromptPlaceholder = (text) => placeholderTemplateId(text) !== null;

/** Whether the text holds a placeholder anywhere (a client may add the photo line, a camera or character description around it). */
export const hasTemplatePlaceholder = (text) => typeof text === 'string' && new RegExp(PLACEHOLDER_SOURCE).test(text);

/** The text with every placeholder replaced by what `replacement(id)` gives; a null answer leaves the text unresolved (null overall). */
export function replaceTemplatePlaceholders(text, replacement) {
    let missing = false;
    const out = text.replace(new RegExp(PLACEHOLDER_SOURCE, 'g'), (_whole, id) => {
        const value = replacement(id);
        if (typeof value !== 'string') { missing = true; return ''; }
        return value;
    });
    return missing ? null : out;
}
