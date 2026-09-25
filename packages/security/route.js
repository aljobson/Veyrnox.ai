import { readConfig } from './config.js';
import { checkOrigin } from './context.js';
import { requestContext } from './context.js';
import { errorResponse, responseHeaders, ApiError } from './errors.js';
import { securityLog } from './log.js';

/** @param {Request} request @param {(context: import('./context').RequestContext) => Promise<Response>} action */
export async function protectedRoute(request, action) {
    /** @type {string} */
    let requestId = crypto.randomUUID();
    try {
        if (process.env.TENANT_PROJECTS_ENABLED !== 'true') throw new ApiError(404, 'NOT_FOUND', 'The resource was not found.');
        const config = readConfig(process.env);
        checkOrigin(request, config.publicOrigin);
        const context = requestContext(request);
        requestId = context.requestId;
        const response = await action(context);
        for (const [key, value] of Object.entries(responseHeaders(requestId))) response.headers.set(key, value);
        return response;
    } catch (error) {
        securityLog('API_REQUEST_FAILED', { requestId, status: error instanceof ApiError ? error.status : 500 });
        const response = errorResponse(error, requestId);
        if (response.status === 429) response.headers.set('retry-after', '60');
        return response;
    }
}
