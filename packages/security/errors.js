/** Safe, intentional boundary failure. Never wrap upstream messages here. */
export class ApiError extends Error {
    /** @param {number} status @param {string} code @param {string} message */
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

/** @param {unknown} error @param {string} requestId */
export function errorResponse(error, requestId) {
    const safe = error instanceof ApiError ? error : new ApiError(500, 'INTERNAL_ERROR', 'The request could not be completed.');
    return Response.json({ error: { code: safe.code, message: safe.message, requestId } }, {
        status: safe.status, headers: responseHeaders(requestId),
    });
}

/** @param {string} requestId */
export function responseHeaders(requestId) {
    return { 'x-request-id': requestId, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' };
}
