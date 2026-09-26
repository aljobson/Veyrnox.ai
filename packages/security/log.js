/** An allowlist deliberately prevents exception/payload/credential serialization.
 * @param {string} event
 * @param {{requestId?: string, userId?: string, resourceId?: string, status?: number}} [fields]
 */
export function securityLog(event, fields = {}) {
    const safeId = (/** @type {unknown} */ value) => typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value) ? value : undefined;
    console.info(JSON.stringify({ event: /^[A-Z_]{1,64}$/.test(event) ? event : 'INTERNAL_ERROR',
        requestId: safeId(fields.requestId), userId: safeId(fields.userId), resourceId: safeId(fields.resourceId),
        status: Number.isInteger(fields.status) ? fields.status : undefined }));
}
