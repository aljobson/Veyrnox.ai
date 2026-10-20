/**
 * Upload admission: known-CSAM hash matching has to pass before an upload is
 * accepted (ADR-0025 section 8.1; docs/operations/upload-scanning-enrollment-2026-10-10.md).
 *
 * No matching service is enrolled, so no adapter exists and this module cannot
 * say "clean" for anything. It is the fail-closed seam the adapter plugs into:
 *
 *   - UPLOAD_HASH_MATCH_REQUIRED is not "true" (the default, and the only state
 *     production has today): every upload path behaves exactly as it did.
 *   - It is "true" and no adapter is registered: every path that would accept a
 *     user file refuses with `upload_admission_unavailable`. A missing, broken
 *     or unenrolled provider can only ever close uploads, never open them.
 *
 * An adapter is added to ADMISSION_PROVIDERS only against an approved account's
 * documented contract (never guessed from older examples), together with the
 * receipt that binds an inspected SHA-256 to one owner and reservation. Until
 * then, turning the flag on is a way to close every public upload surface.
 *
 * Our own finished generations are not uploads and do not pass through here.
 */

export const ADMISSION_FLAG = 'UPLOAD_HASH_MATCH_REQUIRED';
export const ADMISSION_ERROR = 'upload_admission_unavailable';

/** Enrolled matching services by name. Empty until an account is approved. */
export const ADMISSION_PROVIDERS = Object.freeze({});

/** True only for the exact string "true"; anything else leaves uploads as they are. */
export function admissionRequired(env = process.env) {
    return env[ADMISSION_FLAG] === 'true';
}

/**
 * Whether an upload may be accepted right now.
 *
 * @returns {{required:false, ok:true}|{required:true, ok:true, provider:string}|{required:true, ok:false, error:string}}
 */
export function admissionAvailable(env = process.env) {
    if (!admissionRequired(env)) return { required: false, ok: true };
    const name = env.UPLOAD_HASH_MATCH_PROVIDER;
    if (typeof name === 'string' && Object.hasOwn(ADMISSION_PROVIDERS, name)) return { required: true, ok: true, provider: name };
    return { required: true, ok: false, error: ADMISSION_ERROR };
}
