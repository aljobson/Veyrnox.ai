// ADR-0072: which template a generation started from, if it really did. Shared by the studio (to decide what to send) and the
// generations route (to decide what to believe). A template id is accepted only if it names a real template AND the template's own
// model is the model being used, so an id cannot be attached to an unrelated generation to push a template up the Popular list.
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { templateStartIdFor } from './templateStartCheck.js';

/** @returns {string|null} the template id when it is real and belongs to `modelId`, otherwise null (never an error). */
export function templateStartId(raw, modelId) {
    return templateStartIdFor(raw, typeof raw === 'string' ? templateById(raw) : null, modelId);
}
