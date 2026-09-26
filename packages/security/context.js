import { ApiError } from './errors.js';
import { UUID_RE } from './input.js';
/** @typedef {{requestId: string, userId: string, authLevel: 'aal1' | 'aal2', sessionId?: string}} RequestContext */
/** Remove every private context header, including future fields.
 * @param {Headers} input
 */
export function stripContext(input) {
    const headers = new Headers(input);
    for (const name of [...headers.keys()]) if (name.startsWith('x-veyrnox-') || name === 'x-request-id') headers.delete(name);
    return headers;
}
/** Only call with claims after cryptographic verification + standard claim checks.
 * @param {Record<string, unknown>} claims @param {string} requestId @returns {RequestContext}
 */
export function verifiedContext(claims, requestId) {
    if (typeof claims.sub !== 'string' || !UUID_RE.test(claims.sub)) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
    return Object.freeze({ requestId, userId: claims.sub, authLevel: claims.aal === 'aal2' ? 'aal2' : 'aal1',
        ...(typeof claims.session_id === 'string' && UUID_RE.test(claims.session_id) ? { sessionId: claims.session_id } : {}) });
}
/** For routes matched by middleware only; never use on public callbacks.
 * @param {Request} request @returns {RequestContext}
 */
export function requestContext(request) {
    const userId = request.headers.get('x-veyrnox-auth-id');
    const requestId = request.headers.get('x-request-id');
    if (!userId || !UUID_RE.test(userId) || !requestId || !UUID_RE.test(requestId)) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
    return { userId, requestId, authLevel: request.headers.get('x-veyrnox-auth-aal') === 'aal2' ? 'aal2' : 'aal1' };
}
/** @param {RequestContext} context */
export function requireAal2(context) {
    if (context.authLevel !== 'aal2') throw new ApiError(403, 'MFA_REQUIRED', 'Multi-factor authentication is required.');
}
/** Bearer-only API: native clients may omit Origin; browser origins must match configuration.
 * @param {Request} request @param {string} allowedOrigin
 */
export function checkOrigin(request, allowedOrigin) {
    const supplied = request.headers.get('origin');
    if (supplied && supplied !== allowedOrigin) throw new ApiError(403, 'ORIGIN_DENIED', 'Request origin is not allowed.');
}
