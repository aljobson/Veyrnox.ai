/**
 * The error code a failed fal delivery is recorded under (ADR-0309, amendment 1).
 *
 * fal reports a request the model refused as status "ERROR" with the HTTP 422 body in
 * `payload.detail` (a list of `{loc, msg, type, ctx}`). Seedance's partner check answers
 * `type: "content_policy_violation"` / `ctx.extra_info.reason: "partner_validation_failed"` when a
 * reference picture shows a real person. Only our own short code leaves this function: the vendor's
 * message, location and context are never returned, stored on the job or sent to a client.
 */

export const REFERENCE_REJECTED_LIKENESS = 'reference_rejected_likeness';

/** The `detail` entries fal attached to a failed delivery, wherever the envelope put them. */
function detailEntries(event) {
    const candidates = [event?.payload?.detail, event?.detail, event?.error?.detail, event?.payload?.error?.detail];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
        if (candidate && typeof candidate === 'object') return [candidate];
    }
    return [];
}

/** True when fal's 422 says a reference picture was refused on content-policy / partner-validation grounds. */
export function isReferenceLikenessRejection(event) {
    return detailEntries(event).some((entry) => {
        if (!entry || typeof entry !== 'object') return false;
        const loc = Array.isArray(entry.loc) ? entry.loc : [];
        // Only a refused picture: a policy violation on the prompt (loc "prompt") keeps its generic code.
        const onImages = loc.some((part) => typeof part === 'string' && /^image_urls?$/.test(part));
        const policy = entry.type === 'content_policy_violation'
            || entry.ctx?.extra_info?.reason === 'partner_validation_failed';
        return onImages && policy;
    });
}

/** @returns {string} the code to hand to job_failed; always matches /^[a-z0-9_]{1,64}$/ */
export function falFailureCode(event) {
    if (isReferenceLikenessRejection(event)) return REFERENCE_REJECTED_LIKENESS;
    const raw = event && event.error && event.error.code;
    const s = raw == null ? '' : String(raw).slice(0, 128);
    return s || 'provider_error';
}
