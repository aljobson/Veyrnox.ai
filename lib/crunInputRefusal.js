import { seedance25RawRefusal } from './seedance25Billing.js';
// Kling 3.0 Pro at Crun has no negative prompt field (ADR-0256 amendment 2026-11-22, owner decision: templates run without theirs).
// A customer's negative prompt is refused before the debit. The only value let through is the named template's own, sent with that
// template's own prompt by a client that still has the old controls. It is then dropped by declaredInputs, so it is neither stored nor sent.
import { templateById } from '../app/veyrnox/_lib/templates.js';
import { templateStartId } from './templateStart.js';
import { TEMPLATE_REFERENCE_PRIORITY } from './templateReferencePriority.js';

// The line the web and mobile template pages add to a photo run; tests/crunPrimaryKlingSeedance.test.mjs pins all three copies.
export const PHOTO_CHARACTER_LINE = 'The person in the attached photo is the main character; keep their face, hair and clothing the same throughout.';
const KLING_PRO_OFFER = 'kling-3.0-i2v';
const SEEDANCE_REFERENCE_OFFER = 'seedance-2.0-reference';
const NEGATIVE_MAX = 2000;
const REFUSED = 'inputs_key_not_allowed:negative_prompt';
const hasText = value => typeof value === 'string' && value.trim().length > 0;
const clientNegative = value => value.trim().slice(0, NEGATIVE_MAX).trimEnd();

function namedTemplate(body) {
    const ids = [body?.template_id, body?.preset].filter(id => id !== undefined && id !== null);
    if (!ids.length || ids.some(id => id !== ids[0]) || !templateStartId(ids[0], KLING_PRO_OFFER)) return null;
    return templateById(ids[0]);
}

function isTemplatePrompt(template, prompt) {
    if (typeof prompt !== 'string') return false;
    const sent = prompt.trim();
    return [template.prompt, template.sourcePrompt].filter(hasText)
        .some(own => sent === own.trim()
            || sent === `${own.trim()}\n\n${PHOTO_CHARACTER_LINE}`
            || sent === `${TEMPLATE_REFERENCE_PRIORITY}\n\n${own.trim()}`);
}

/** The typed refusal for this request on the Crun Kling offer, or null. Never trusts a client statement about the source. */
export function crunInputRefusal(modelRow, inputs, body) {
    const seedance25 = seedance25RawRefusal(modelRow?.id, inputs);
    if (seedance25) return seedance25;
    // The Crun record has no tiers, so declaredInputs would drop a dearer tier and quietly serve 720p. Refuse it instead (0583).
    if (modelRow?.id === SEEDANCE_REFERENCE_OFFER && modelRow.provider === 'crun') {
        return [undefined, null, '720p'].includes(inputs?.resolution) ? null : 'resolution_not_supported';
    }
    if (modelRow?.id !== KLING_PRO_OFFER || modelRow.provider !== 'crun') return null;
    const negative = inputs?.negative_prompt;
    if (negative === undefined || negative === null || (typeof negative === 'string' && !negative.trim())) return null;
    if (typeof negative !== 'string') return REFUSED;
    const template = namedTemplate(body);
    const own = template?.negativePrompt;
    return hasText(own) && clientNegative(negative) === clientNegative(own) && isTemplatePrompt(template, inputs.prompt) ? null : REFUSED;
}
