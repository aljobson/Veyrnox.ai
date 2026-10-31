// What a finished result offers next. The composer takes images and videos, the Editor takes videos, and Make another
// only needs the model, so each step shows only when it can honour the file in front of the person.
export interface NextSteps {
    readonly edit: boolean;
    readonly publish: boolean;
    readonly makeAnother: boolean;
    readonly reuse: boolean;
}

export function nextStepsFor(mime: string, modelId: string | null): NextSteps {
    const video = mime.startsWith('video/');
    const image = mime.startsWith('image/');
    const audio = mime.startsWith('audio/');
    return { edit: video, publish: video || image, makeAnother: !!modelId, reuse: video || image || audio };
}

// Edit opens a new Editor project with the video already on the timeline.
export const editHref = (jobId: string) => ({ pathname: '/editor/new', params: { jobId } }) as const;
export const publishHref = (jobId: string) => ({ pathname: '/publish/compose', params: { jobId } }) as const;
// The job route returns no prompt, so Make another reopens Create on the same model.
export const makeAnotherHref = (modelId: string) => ({ pathname: '/create/[modelId]', params: { modelId } }) as const;

export const askAboutHref = (jobId: string) => ({ pathname: '/chat/new', params: { asset: jobId } }) as const;
