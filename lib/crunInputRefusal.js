// Kling 3.0 Pro at Crun has no negative prompt field (ADR-0256 amendment 2026-11-22). Refused before the debit, never dropped:
// a typed one by its key, and a template's own one by the template, because clients omit it once the control is hidden.
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { templateStartId } from './templateStart.js';

const KLING_PRO_OFFER = 'kling-3.0-i2v';
const hasText = value => typeof value === 'string' && value.trim().length > 0;

export function crunInputRefusal(modelRow, inputs, body) {
    if (modelRow?.id !== KLING_PRO_OFFER || modelRow.provider !== 'crun') return null;
    if (hasText(inputs?.negative_prompt)) return 'inputs_key_not_allowed:negative_prompt';
    for (const id of [body?.template_id, body?.preset]) {
        if (templateStartId(id, KLING_PRO_OFFER) && hasText(templateById(id)?.negativePrompt)) return 'template_blocked';
    }
    return null;
}
