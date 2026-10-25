import type { Job } from './media';
import type { MediaType } from './publishCompose';

export type CreationPick = { kind: 'job'; job: Job; mediaType: MediaType; name: string };
export type UploadPick = { uploadId: string; mediaType: MediaType };
export type MediaChoice = CreationPick | ({ kind: 'upload' } & UploadPick);
export const choose = (_current: MediaChoice | null, next: MediaChoice): MediaChoice => next;
export const clearUpload = (choice: MediaChoice | null, uploadId: string | null): MediaChoice | null =>
    choice?.kind === 'upload' && choice.uploadId === uploadId ? null : choice;

export const choiceId = (item: MediaChoice): string => item.kind === 'upload' ? `upload:${item.uploadId}` : `job:${item.job.job_id}`;
export function toggleChoice(items: MediaChoice[], item: MediaChoice, max: number): MediaChoice[] {
    if (items.some(value => choiceId(value) === choiceId(item))) return items.filter(value => choiceId(value) !== choiceId(item));
    return max === 1 ? [item] : items.length < max ? [...items, item] : items;
}
export const choiceMedia = (items: readonly MediaChoice[]) => items.map(item => ({ mediaType: item.mediaType, ...(item.kind === 'upload' ? { uploadId: item.uploadId } : { jobId: item.job.job_id }) }));
