export const FAL_JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validFalWakeup = body => !!body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body).length === 2 && Object.hasOwn(body, 'version') && Object.hasOwn(body, 'job_id')
    && body.version === 1 && typeof body.job_id === 'string' && FAL_JOB_ID.test(body.job_id);
