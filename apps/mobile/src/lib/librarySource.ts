import type { SlotKind, SlotName } from './sources';
import { kindOf, type CatalogModel, type Job } from './media';

// ADR-0190: a Library creation can be the file for a Create slot without being downloaded and uploaded again. The server
// takes `source_assets: [{asset_id, slot}]` (lib/generationSources.js) and checks ownership, kind and expiry itself;
// this only decides which of the person's creations to offer.

// Past its date the file is gone. No date means unknown, so it is offered and the server decides.
const isExpired = (j: Job, now: number): boolean => {
    const at = j.asset_expires_at ? Date.parse(j.asset_expires_at) : NaN;
    return Number.isFinite(at) && at <= now;
};

export interface LibraryChoice {
    readonly jobId: string;
    readonly name: string;
    readonly createdAt: string;
}

// Finished, stored, unheld, unexpired creations of the kind the slot needs. A job on a model the catalog no longer lists
// has no known kind and is not offered.
export function libraryChoices(jobs: readonly Job[], models: readonly CatalogModel[], kind: SlotKind, now: number = Date.now()): LibraryChoice[] {
    const byId = new Map(models.map((m) => [m.id, m]));
    const out: LibraryChoice[] = [];
    for (const j of jobs) {
        const model = byId.get(j.model_id);
        if (!model || kindOf(model.modality) !== kind) continue;
        if (j.state !== 'succeeded' || !j.has_asset || j.held || isExpired(j, now)) continue;
        out.push({ jobId: j.job_id, name: j.label || model.name, createdAt: j.created_at });
    }
    return out;
}

export function toSourceAssets(assets: Partial<Record<SlotName, string>>, order: readonly SlotName[]): { assetId: string; slot: SlotName }[] {
    return order.flatMap((slot) => (assets[slot] ? [{ assetId: assets[slot] as string, slot }] : []));
}
