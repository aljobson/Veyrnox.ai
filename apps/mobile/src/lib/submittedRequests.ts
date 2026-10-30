import type { ApiClient } from './api';
import { accountHandoffStore } from './accountHandoffStore';
import { createHandoff, type FormSnapshot } from './createHandoff';
import type { SubmitRequest } from './generationSubmit';
import { fetchCatalog, mediaApi } from './media';
import type { GenerationReference } from './sources';
import { makeAnotherHref } from './nextSteps';

interface Submitted { omittedReferences: number; id: string; request: SubmitRequest; carry: Record<string, string>; settings: FormSnapshot }
export const submittedRequests = accountHandoffStore<Submitted>('requests', 100);
export function rememberSubmitted(id: string, request: SubmitRequest, carry: Record<string, string>, settings: FormSnapshot) {
    // Uploaded sources expire separately. Retain only Library asset ids, never signed URLs or upload keys.
    return submittedRequests.put({ id, omittedReferences: request.references?.filter(r => r.origin === 'upload').length ?? 0, request: { ...request, references: request.references?.filter(r => r.origin === 'asset') }, carry, settings });
}
export async function submittedHref(api: ApiClient, jobId: string, modelId: string, current: () => boolean) {
    const saved = (await submittedRequests.list()).find(r => r.id === jobId);
    if (!current()) return null;
    if (!saved) return { ...makeAnotherHref(modelId), params: { modelId, prompt: '', kind: 'prompt-unavailable' } };
    const catalog = await fetchCatalog();
    if (!current()) return null;
    const model = catalog.find(m => m.id === saved.request.modelId);
    if (!model) return { ...makeAnotherHref(modelId), params: { ...saved.carry, modelId } };
    const references: GenerationReference[] = [];
    for (const ref of saved.request.references ?? []) {
        if (ref.origin !== 'asset') continue;
        try {
            await mediaApi(api).getAsset(ref.asset_id);
            if (!current()) return null;
            references.push(ref);
        } catch { if (!current()) return null; }
    }
    return createHandoff(model, saved.carry, saved.settings, references, { rightsConfirmed: saved.request.sourceRights }, (saved.omittedReferences ?? 0) + (saved.request.references?.length ?? 0) - references.length);
}
