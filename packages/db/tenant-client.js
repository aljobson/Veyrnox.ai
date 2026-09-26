// User JWT + public key: tenant operations do not inherit service-role bypass.
import { readConfig } from '../security/config.js';
import { ApiError } from '../security/errors.js';
import { readBody } from '../security/input.js';

export async function tenantRequest(request, context, path, { method = 'GET', body } = {}) {
    const cfg = readConfig(process.env);
    const authorization = request.headers.get('authorization');
    if (!authorization?.toLowerCase().startsWith('bearer ')) throw new ApiError(401, 'UNAUTHORIZED', 'Authentication required.');
    let response;
    try {
        response = await fetch(new URL(`/rest/v1/${path}`, cfg.supabaseUrl), {
            // Workers rejects redirect: 'error'. Return redirects unfollowed;
            // the non-ok branch below rejects them without forwarding the JWT.
            method, redirect: 'manual', signal: AbortSignal.timeout(8000),
            headers: { apikey: cfg.publishableKey, authorization, 'content-type': 'application/json', 'x-request-id': context.requestId },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
    } catch { throw new ApiError(503, 'DATA_UNAVAILABLE', 'Data is temporarily unavailable.'); }
    if (!response.ok) {
        const safeErrors = {
            400: ['INVALID_REQUEST', 'The request is invalid.'],
            401: ['UNAUTHORIZED', 'Authentication required.'],
            403: ['FORBIDDEN', 'This operation is not permitted.'],
            404: ['NOT_FOUND', 'The resource was not found.'],
            409: ['CONFLICT', 'The request conflicts with the saved state.'],
            429: ['RATE_LIMITED', 'Too many requests. Try again later.'],
        };
        await response.body?.cancel();
        const safe = safeErrors[response.status];
        throw new ApiError(safe ? response.status : 503, ...(safe || ['DATA_UNAVAILABLE', 'Data is temporarily unavailable.']));
    }
    // Bound upstream JSON before parsing; PostgREST returns objects or arrays.
    const bytes = await readBody(response, 256 * 1024);
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new ApiError(503, 'DATA_UNAVAILABLE', 'Data is temporarily unavailable.'); }
}
