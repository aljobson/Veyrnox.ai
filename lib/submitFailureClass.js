/**
 * Why did a provider refuse a submit? (ADR-0066)
 *
 * fal and kie reject with a log string, not a code, so every refusal used to
 * reach the user as provider_submit_failed: a content-policy refusal read as
 * an outage. Jev sorts the vendor text into a typed code. The refund is the
 * same whatever the answer, so a wrong label only changes the copy shown.
 *
 * Mode comes from JEV_SUBMIT_ERRORS_MODE:
 *   off      no call (default)
 *   shadow   call and log the label, return null
 *   enforce  return the code when the label is confident enough
 */

import { decide, confidentChoice, jevMode } from './jev.js';

// Below this probability the generic code stands.
const MIN_PROBABILITY = 0.8;
// The prefix fal.js and kie.js put on a non-2xx provider answer.
const VENDOR_RESPONSE_RE = /^(fal|kie) \d{3}\b/;

export const SUBMIT_FAILURE_CODES = {
    content_policy: 'provider_moderation',
    invalid_input: 'provider_input_rejected',
};

const QUESTIONS = {
    cause: {
        type: 'choice',
        instructions: 'An image or video generation provider refused to accept a job. The state is the error it returned. Why did it refuse?',
        criteria: {
            content_policy: 'The prompt or an input image was refused on safety, content-policy, moderation, NSFW or prohibited-content grounds.',
            invalid_input: 'An input value was malformed, unsupported, missing or out of range, or failed validation.',
            other: 'Authentication, billing, quota, rate limiting, timeouts, outages, network errors, or anything else.',
        },
    },
};

/**
 * @param {string|undefined} errorText the adapter's log string, e.g. 'fal 422: {...}'
 * @param {{JEV_SUBMIT_ERRORS_MODE?: string, TYPESAFE_API_KEY?: string}} env
 * @returns {Promise<string|null>} a typed error code, or null to keep the generic one
 */
export async function classifySubmitFailure(errorText, env) {
    // Runs in front of the refund, so it must never throw.
    try {
        const mode = jevMode(env && env.JEV_SUBMIT_ERRORS_MODE);
        // Only a provider's own answer ('fal 422: ...', 'kie 400/422: ...') is
        // sent. Transport failures and the adapters' local validation strings
        // ('inputs_invalid:prompt') are ours, and stay off the wire.
        if (mode === 'off' || typeof errorText !== 'string' || !VENDOR_RESPONSE_RE.test(errorText)) return null;
        return await classify(errorText, mode, env.TYPESAFE_API_KEY);
    } catch (err) {
        console.error('[jev] submit_failure classify threw:', err && err.name);
        return null;
    }
}

async function classify(errorText, mode, apiKey) {
    const started = Date.now();
    const answers = await decide({ apiKey, state: errorText, questions: QUESTIONS });
    if (!answers) return null;

    const verdict = confidentChoice(answers.cause, Object.keys(SUBMIT_FAILURE_CODES), MIN_PROBABILITY);
    const p = Number(answers.cause && answers.cause.probabilities && answers.cause.probabilities[answers.cause.choice]);
    // Label, probability and latency only; never the vendor text.
    console.error('[jev] submit_failure', JSON.stringify({
        mode,
        label: answers.cause && answers.cause.choice,
        p: Number.isFinite(p) ? Math.round(p * 100) / 100 : null,
        ms: Date.now() - started,
    }));
    if (mode !== 'enforce' || !verdict) return null;
    return SUBMIT_FAILURE_CODES[verdict.choice];
}
