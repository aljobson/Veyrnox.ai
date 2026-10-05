// ADR-0072: which template a generation started from, if it really did. Shared by the studio (to decide what to send) and the
// generations route (to decide what to believe). A template id is accepted only if it names a real template AND the template's own
// model is the model being used, so an id cannot be attached to an unrelated generation to push a template up the Popular list.
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { modelIdForName } from '../app/veyrnox/_lib/tokens.js';

const TEMPLATE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** @returns {string|null} the template id when it is real and belongs to `modelId`, otherwise null (never an error). */
export function templateStartId(raw, modelId) {
    if (typeof raw !== 'string' || !TEMPLATE_ID_RE.test(raw) || typeof modelId !== 'string') return null;
    const template = templateById(raw);
    if (!template) return null;
    return modelIdForName(template.model) === modelId ? template.id : null;
}
