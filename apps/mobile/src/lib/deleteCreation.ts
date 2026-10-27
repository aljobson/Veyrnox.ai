import { t } from './i18n';
import { ApiError, type ApiClient } from './api';

// ADR-0116 (server) and ADR-0119 (app): deleting a creation erases its file and prompt and cannot be undone.
// The job row and the ledger stay, so credits are not refunded.
export const CONFIRM_TITLE = t('deleteCreation.deletethiscreation');
export const CONFIRM_MESSAGE =
    t('deleteCreation.thispermanentlyerasesthefileandthe');

// The job id is the key: a repeat answers `replayed: true`, which is a success here too.
export async function deleteCreation(api: ApiClient, jobId: string): Promise<void> {
    const r = await api.request<{ deleted?: unknown }>(`/api/v1/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    if (r.deleted !== true) throw new ApiError(502, 'internal');
}

// 404 is the same answer for "already deleted", "not yours" and "no such job": nothing is left to delete.
export const isAlreadyGone = (err: unknown): boolean => err instanceof ApiError && err.status === 404 && err.code === 'not_found';

export function deleteMessage(err: unknown): string {
    if (!(err instanceof ApiError)) return t('deleteCreation.couldnotdeleteitNothingwaschanged');
    switch (err.code) {
        case 'job_in_progress':
            return t('deleteCreation.thiscreationisstillbeingmadeDelete');
        case 'job_on_hold':
            return t('deleteCreation.thiscreationisheldforreviewso');
        case 'account_frozen':
            return t('deleteCreation.youraccountisonholdsodeleting');
        case 'used_by_post':
            return t('deleteCreation.aPublishpostusesthisfileRemove');
        case 'used_by_cinema':
            return t('deleteCreation.aCinemauploadwasmadefromthis');
        case 'used_by_library':
            return t('deleteCreation.aFilmLibrarymasterwasmadefrom');
        case 'rate_limited':
            return t('deleteCreation.toomanyrequestsWaitamomentand');
        case 'network':
            return t('deleteCreation.noconnectionCheckitandtryagain');
        default:
            return t('deleteCreation.couldnotdeleteitNothingwaschanged');
    }
}
