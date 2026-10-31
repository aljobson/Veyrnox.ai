import { t } from './i18n';
import type { ApiClient } from './api';
import { mediaApi, type CatalogModel, type Job } from './media';
import { mediaTypeOf } from './publishCompose';
import type { CreationPick } from './publishMediaChoice';

export function publishPick(job: Job, catalog: readonly CatalogModel[]): CreationPick | null {
    const model = catalog.find(m => m.id === job.model_id);
    const mediaType = job.output_type === 'editor-render' ? 'video' : model ? mediaTypeOf(model.modality) : null;
    return job.state === 'succeeded' && job.has_asset && !job.held && mediaType
        ? { kind: 'job', job, mediaType, name: job.label || model?.name || (job.output_type === 'editor-render' ? t('handoff.editedVideo') : job.job_id) } : null;
}

// The detail response has no has_asset field. Confirm availability through the existing asset endpoint;
// never retain its signed URL in navigation or local storage.
export async function resolvePublishPick(api: ApiClient, id: string, listed: readonly Job[], catalog: readonly CatalogModel[], current: () => boolean) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !current()) return { error: 'handoff.publishMissing' } as const;
    try {
        const found = listed.find(j => j.job_id === id);
        let job = found;
        if (!job || !publishPick(job, catalog)) {
            const detail = await mediaApi(api).getJob(id);
            if (!current()) return null;
            job = { ...found, ...detail, job_id: id, created_at: found?.created_at ?? '', has_asset: detail.state === 'succeeded' };
        }
        if (job.state !== 'succeeded') return { error: 'handoff.publishPending' } as const;
        const pick = publishPick(job, catalog);
        if (!pick) return { error: 'handoff.publishUnsupported' } as const;
        await mediaApi(api).getAsset(id);
        return current() ? { pick } : null;
    } catch { return current() ? { error: 'handoff.publishMissing' } as const : null; }
}
