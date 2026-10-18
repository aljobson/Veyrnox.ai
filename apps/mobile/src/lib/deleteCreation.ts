import { ApiError, type ApiClient } from './api';

// ADR-0116 (server) and ADR-0119 (app): deleting a creation erases its file and prompt and cannot be undone.
// The job row and the ledger stay, so credits are not refunded.
export const CONFIRM_TITLE = 'Delete this creation?';
export const CONFIRM_MESSAGE =
    'This permanently erases the file and the prompt. Your credits are not refunded, and it stays counted in your history. This cannot be undone.';

// The job id is the key: a repeat answers `replayed: true`, which is a success here too.
export async function deleteCreation(api: ApiClient, jobId: string): Promise<void> {
    const r = await api.request<{ deleted?: unknown }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    if (r.deleted !== true) throw new ApiError(502, 'internal');
}

// 404 is the same answer for "already deleted", "not yours" and "no such job": nothing is left to delete.
export const isAlreadyGone = (err: unknown): boolean => err instanceof ApiError && err.status === 404 && err.code === 'not_found';

export function deleteMessage(err: unknown): string {
    if (!(err instanceof ApiError)) return 'Could not delete it. Nothing was changed. Try again.';
    switch (err.code) {
        case 'job_in_progress':
            return 'This creation is still being made. Delete it when it is done. Nothing was changed.';
        case 'job_on_hold':
            return 'This creation is held for review, so it cannot be deleted right now. Nothing was changed.';
        case 'account_frozen':
            return 'Your account is on hold, so deleting is not available. Contact support. Nothing was changed.';
        case 'used_by_post':
            return 'A Publish post uses this file. Remove or finish the post first, then delete it. Nothing was changed.';
        case 'used_by_cinema':
            return 'A Cinema upload was made from this. Withdraw it from Cinema first. Nothing was changed.';
        case 'used_by_library':
            return 'A Film Library master was made from this, so it cannot be deleted. Nothing was changed.';
        case 'rate_limited':
            return 'Too many requests. Wait a moment and try again. Nothing was changed.';
        case 'network':
            return 'No connection. Check it and try again. Nothing was changed.';
        default:
            return 'Could not delete it. Nothing was changed. Try again.';
    }
}
