import { type CelebrationAccount, captureCelebrationAccount, isCelebrationAccountCurrent, isLocalSubmission, milestonesOpen, settleMilestones } from './celebrate';
import { getCacheUser } from './appCache';
import { fetchAllCatalog, kindOf, mediaApi, type CatalogModel } from './media';
import type { ApiClient } from './api';

const PAGES = 3;
let checkedFor: string | null | undefined;

// Looks at the account's earlier finished creations and marks "first creation" / "first video" as used when they
// exist. Never throws: when the list cannot be read, the local flags decide as before. One look per sign-in.
export async function settleFirstMilestones(api: ApiClient, catalog?: readonly CatalogModel[], token: CelebrationAccount = captureCelebrationAccount()): Promise<void> {
    if (!isCelebrationAccountCurrent(token)) return;
    const owner = getCacheUser() ?? null;
    try {
        if (!milestonesOpen() || checkedFor === owner) return;
        const models = catalog ?? (await fetchAllCatalog().catch(() => []));
        const video = new Set(models.filter((m) => kindOf(m.modality) === 'video').map((m) => m.id));
        const media = mediaApi(api);
        let creation = false;
        let clip = false;
        let cursor: Parameters<typeof media.listJobs>[0];
        for (let page = 0; page < PAGES && !(creation && clip); page++) {
            const body = await media.listJobs(cursor);
            for (const job of body.jobs) {
                if (job.state !== 'succeeded' || isLocalSubmission(job.job_id)) continue;
                creation = true;
                if (video.has(job.model_id)) clip = true;
            }
            if (!body.next) break;
            cursor = body.next;
        }
        if (!isCelebrationAccountCurrent(token) || (getCacheUser() ?? null) !== owner) return;
        checkedFor = owner;
        settleMilestones({ creation, video: clip });
    } catch {
        /* Unreadable: the local flags decide. */
    }
}
