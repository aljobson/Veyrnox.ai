import type { Job } from './media';

// What a finished result offers next. The composer takes images and videos, Quick edit takes videos, and Make another
// only needs the model, so each step shows only when it can honour the file in front of the person.
export interface NextSteps {
    readonly edit: boolean;
    readonly publish: boolean;
    readonly makeAnother: boolean;
}

export function nextStepsFor(mime: string, modelId: string | null): NextSteps {
    const video = mime.startsWith('video/');
    const image = mime.startsWith('image/');
    return { edit: video, publish: video || image, makeAnother: !!modelId };
}

export const editHref = (jobId: string) => ({ pathname: '/edit', params: { jobId } }) as const;
export const publishHref = (jobId: string) => ({ pathname: '/publish/compose', params: { jobId } }) as const;
// The job route returns no prompt, so Make another reopens Create on the same model.
export const makeAnotherHref = (modelId: string) => ({ pathname: '/create/[modelId]', params: { modelId } }) as const;

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

// The video Quick edit should start with when it is opened from a result. Only an id of the expected shape is used;
// a creation older than the first Library page still works because adding a clip needs only the job id.
export function preloadJob(listed: readonly Job[], jobId: string | undefined): Job | null {
    if (!jobId || !SAFE_ID.test(jobId)) return null;
    const found = listed.find((j) => j.job_id === jobId);
    if (found) return found;
    return { job_id: jobId, state: 'succeeded', credits: 0, model_id: '', created_at: '', has_asset: true };
}
