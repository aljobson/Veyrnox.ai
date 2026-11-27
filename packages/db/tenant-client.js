// User JWT + public key: tenant operations do not inherit service-role bypass.
import { readConfig } from '../security/config.js';
import { ApiError } from '../security/errors.js';
import { readBody } from '../security/input.js';

export async function tenantRequest(request, context, path, { method = 'GET', body, maxBytes = 256 * 1024, limitAware = false, removalAware = false, beatAware = false, proFileAware = false, folderAware = false } = {}) {
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
        if (folderAware && [409, 429].includes(response.status)) {
            let code;
            try { code = JSON.parse(new TextDecoder().decode(await readBody(response, 4096)))?.message; }
            catch { /* Unrecognised vendor errors remain generic. */ }
            finally { await response.body?.cancel().catch(() => {}); }
            const allowed = response.status === 409
                ? ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'NAME_CONFLICT', 'FOLDER_NOT_EMPTY', 'FOLDER_DEPTH_LIMIT']
                : ['LIMIT_REACHED'];
            if (allowed.includes(code)) throw new ApiError(response.status, code, 'The folder operation could not be completed.');
        } else if (proFileAware && [409, 429].includes(response.status)) {
            let code;
            try { code = JSON.parse(new TextDecoder().decode(await readBody(response, 4096)))?.message; }
            catch { /* Unrecognised vendor errors remain generic. */ }
            finally { await response.body?.cancel().catch(() => {}); }
            const allowed = response.status === 409
                ? ['VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'UPLOAD_CLOSED', 'FILE_UNAVAILABLE']
                : ['STORAGE_QUOTA_EXCEEDED', 'LIMIT_REACHED'];
            if (allowed.includes(code)) throw new ApiError(response.status, code.toLowerCase().replaceAll('_', '-'), 'The file operation could not be completed.');
        } else if (beatAware && response.status === 409) {
            let code;
            try { code = JSON.parse(new TextDecoder().decode(await readBody(response, 4096)))?.message; }
            catch { /* Unknown errors stay generic. */ }
            finally { await response.body?.cancel().catch(() => {}); }
            if (['BEAT_WRITES_DISABLED', 'BEAT_CLIENT_OUTDATED', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'SIZE_MISMATCH', 'TAKE_CHANGED'].includes(code))
                throw new ApiError(409, code, 'The request conflicts with the saved state.');
        } else if (removalAware && [403, 409].includes(response.status)) {
            const removalErrors = {
                ACCOUNT_FROZEN: [403, 'This account is frozen.'],
                ON_HOLD: [409, 'This saved video is on hold.'],
                IN_PROGRESS: [409, 'This job is still in progress.'],
                USED_BY_POST: [409, 'This video is used by a post.'],
                USED_BY_CINEMA: [409, 'This video is used by Cinema.'],
                USED_BY_LIBRARY: [409, 'This video is used by a Library item.'],
            };
            let code;
            try { code = JSON.parse(new TextDecoder().decode(await readBody(response, 4096)))?.message; }
            catch { /* Retain the generic projection for malformed/unknown errors. */ }
            finally { await response.body?.cancel().catch(() => {}); }
            const mapped = Object.hasOwn(removalErrors, code) ? removalErrors[code] : null;
            if (mapped?.[0] === response.status) throw new ApiError(mapped[0], code, mapped[1]);
        } else if (limitAware && response.status === 429) {
            let limitReached = false;
            try {
                const bytes = await readBody(response, 4096);
                limitReached = JSON.parse(new TextDecoder().decode(bytes))?.message === 'LIMIT_REACHED';
            } catch { /* Malformed or oversized errors retain the generic throttle response. */ }
            finally { await response.body?.cancel().catch(() => {}); }
            if (limitReached) throw new ApiError(429, 'LIMIT_REACHED', 'A saved-item limit was reached.');
        } else await response.body?.cancel();
        const safe = safeErrors[response.status];
        throw new ApiError(safe ? response.status : 503, ...(safe || ['DATA_UNAVAILABLE', 'Data is temporarily unavailable.']));
    }
    // Bound upstream JSON before parsing; PostgREST returns objects or arrays.
    const bytes = await readBody(response, maxBytes);
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new ApiError(503, 'DATA_UNAVAILABLE', 'Data is temporarily unavailable.'); }
}
