import type { Job } from './media';
import type { MediaType } from './publishCompose';

export type CreationPick = { kind: 'job'; job: Job; mediaType: MediaType; name: string };
export type UploadPick = { uploadId: string; mediaType: MediaType };
export type MediaChoice = CreationPick | ({ kind: 'upload' } & UploadPick);
export const choose = (_current: MediaChoice | null, next: MediaChoice): MediaChoice => next;
export const clearUpload = (choice: MediaChoice | null, uploadId: string | null): MediaChoice | null =>
    choice?.kind === 'upload' && choice.uploadId === uploadId ? null : choice;
