import { templateRoute } from './templateRoute.js';
// The rule behind templateStartId (lib/templateStart.js) without the template catalog, for the studio, which already holds the one
// template it was opened with. A template id counts only when it names that template and the template's own model is the model in use.
import { templateModelId } from '../app/veyrnox/_lib/tokens.js';

const TEMPLATE_ID_RE = /^[a-z0-9-]{1,40}$/;

/** Selection is independent of ranking attribution; image recipes still appear in Create. */
export function templateSelectionMatches(raw, template, modelId) {
    if (typeof raw !== 'string' || !TEMPLATE_ID_RE.test(raw) || typeof modelId !== 'string') return false;
    if (!template || template.id !== raw) return false;
    if (template.kind === 'image') return templateModelId(template) === modelId;
    return [templateModelId(template), templateRoute(template, null).boundModelId].includes(modelId);
}

/** Ranking attribution is video-only. Image runs are ordinary text-to-image runs. */
export function templateStartIdFor(raw, template, modelId) {
    if (template?.kind === 'image') return null;
    return templateSelectionMatches(raw, template, modelId) ? template.id : null;
}
