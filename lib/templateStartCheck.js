// The rule behind templateStartId (lib/templateStart.js) without the template catalog, for the studio, which already holds the one
// template it was opened with. A template id counts only when it names that template and the template's own model is the model in use.
import { modelIdForName } from '../app/veyrnox/_lib/tokens.js';

const TEMPLATE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** @returns {string|null} the template id when `template` is the one `raw` names and belongs to `modelId`, otherwise null. */
export function templateStartIdFor(raw, template, modelId) {
    if (typeof raw !== 'string' || !TEMPLATE_ID_RE.test(raw) || typeof modelId !== 'string') return null;
    if (!template || template.id !== raw) return null;
    return modelIdForName(template.model) === modelId ? template.id : null;
}
