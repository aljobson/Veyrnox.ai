// The server's own template prompt for a run whose request does not carry the text (ADR-0351 amendment 23).
// A request names a video template's prompt in one of two ways, and the text is filled in here, before every check, so the limits,
// refusals, price, fingerprint and stored job inputs all see the same words a client-sent prompt would have given them:
//   1. inputs.prompt holds the placeholder lib/templatePromptPrivacy.js hands out. A client may put the photo line, a camera or a
//      character description around it; whatever surrounds it is kept, and the placeholder becomes the template's text.
//   2. inputs.prompt is absent and body.template_id names the template (the audited contract id).
// Any other prompt is the customer's own words and is returned untouched, including a client-sent copy of the template's text.
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { exactSourcePromptRecord } from '../app/veyrnox/_lib/sourcePromptRecords.js';
import { isVideoTemplate } from '../app/veyrnox/_lib/templatePromptVisibility.js';
import { templateContract } from './templateContract.js';
import { templateBoundPrompt } from './templateFidelityRuntime.js';
import { readGenerationSources } from './generationSources.js';
import { hasTemplatePlaceholder, placeholderTemplateId, replaceTemplatePlaceholders } from './templatePromptPlaceholder.js';

const TEMPLATE_ID_RE = /^[a-z0-9-]{1,40}$/;
const OWN_PATHS = ['template_swap', 'template_clip', 'swap'];

/** The text a client would have sent for this template: the community prompt when one is recorded, otherwise the recipe. */
export function ownTemplatePrompt(template) {
    return exactSourcePromptRecord(template.id)?.prompt || template.prompt;
}

/** A video template by its own id, or null (an old id, an image or audio start or an unknown id is not one). */
function videoTemplate(id) {
    if (typeof id !== 'string' || !TEMPLATE_ID_RE.test(id)) return null;
    const template = templateById(id);
    return template && template.id === id && isVideoTemplate(template) ? template : null;
}

/** @returns {{ body: object } | { error: string }} the body to run (a copy with the prompt filled in, or the same object). */
export function resolveTemplatePrompt(body, modelId) {
    const inputs = body?.inputs;
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return { body };
    // Server-held clips and swaps replace or tag the prompt on their own paths.
    if (OWN_PATHS.some(key => Object.hasOwn(body, key))) return { body };
    const sent = inputs.prompt;
    // No prompt and no audited template: nothing to fill, and validation answers as it always did.
    if (sent === undefined && typeof body.template_id !== 'string') return { body };
    if (sent !== undefined && !hasTemplatePlaceholder(sent)) return { body };
    const refs = readGenerationSources(body).references || [];
    // Only a prompt that is the template's text and nothing else is bound to photo slots, as the clients do (templateBoundPrompt).
    const whole = sent === undefined ? body.template_id : placeholderTemplateId(sent);
    if (whole !== null && body.template_id !== undefined && body.template_id !== whole) return { error: 'template_mismatch' };
    if (whole !== null) {
        const template = videoTemplate(whole);
        if (!template) return sent === undefined ? { body } : { error: 'template_not_found' };
        const prompt = templateBoundPrompt(templateContract(whole), ownTemplatePrompt(template), modelId, refs.length);
        return { body: { ...body, inputs: { ...inputs, prompt } } };
    }
    const prompt = replaceTemplatePlaceholders(sent, id => { const template = videoTemplate(id); return template ? ownTemplatePrompt(template) : null; });
    return prompt === null ? { error: 'template_not_found' } : { body: { ...body, inputs: { ...inputs, prompt } } };
}
