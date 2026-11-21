import type { ApiClient } from './api';
import { accountHandoffStore } from './accountHandoffStore';
import { createHandoff, type FormSnapshot } from './createHandoff';
import type { SubmitRequest } from './generationSubmit';
import { fetchCatalog, mediaApi } from './media';
import type { GenerationReference } from './sources';
import { makeAnotherHref } from './nextSteps';
import { normalizeTemplateCarry } from './templateHandoff';
import { speechModel, SPEECH_MODEL_ID } from './speech/model';
import { dialogueModel, restoreDialogue } from './speech/dialogue';
import { restoreSpeech } from './speech/restore';
import { DIALOGUE_MODEL_ID } from './speech/dialogueShared';

interface Submitted { omittedReferences: number; id: string; request: SubmitRequest; carry: Record<string, string>; settings: FormSnapshot }
export const submittedRequests = accountHandoffStore<Submitted>('requests', 100);
export function rememberSubmitted(id: string, request: SubmitRequest, carry: Record<string, string>, settings: FormSnapshot) {
    // Uploaded sources expire separately. Retain only Library asset ids, never signed URLs or upload keys.
    return submittedRequests.put({ id, omittedReferences: request.references?.filter(r => r.origin === 'upload').length ?? 0, request: { ...request, references: request.references?.filter(r => r.origin === 'asset') }, carry, settings });
}
// ADR-0309 amendment 1: after the provider refuses a real-person reference picture, the same request reopens on the frame model.
export const SEEDANCE_REFERENCE_MODEL_ID = 'seedance-2.0-reference';
export const FRAME_MODEL_ID = 'kling-3.0-i2v';
// `targetModelId` reopens the saved request (prompt, settings, Library pictures) on another model instead of the one it ran on.
export async function submittedHref(api: ApiClient, jobId: string, modelId: string, current: () => boolean, targetModelId?: string) {
    const saved = (await submittedRequests.list()).find(r => r.id === jobId);
    if (!current()) return null;
    const missing = () => ({ ...makeAnotherHref(targetModelId ?? modelId), params: { modelId: targetModelId ?? modelId, prompt: '', kind: 'prompt-unavailable' } });
    const sourceModelId = saved?.request?.modelId ?? modelId;
    const studio = sourceModelId === DIALOGUE_MODEL_ID || sourceModelId === SPEECH_MODEL_ID;
    if (!saved && !studio) return missing();
    let catalog: Awaited<ReturnType<typeof fetchCatalog>>;
    try { catalog = await fetchCatalog(); }
    catch (error) {
        if (!saved?.request && studio) return current() ? missing() : null;
        throw error;
    }
    if (!current()) return null;
    const switching = targetModelId !== undefined && targetModelId !== sourceModelId;
    const hasStudioInputs = Object.keys(saved?.request?.extraInputs ?? {}).some(key => key.startsWith('dialogue_voice_') || key.startsWith('tts_'));
    const restorable = saved?.request && (sourceModelId === DIALOGUE_MODEL_ID ? restoreDialogue(saved.request)
        : sourceModelId === SPEECH_MODEL_ID ? restoreSpeech(saved.request) : null);
    // Generic Create jobs have no studio controls: keep their original prompt handoff.
    // Corrupt studio controls still open the studio, which explains why restoration failed.
    if (!switching && (!saved?.request || restorable || hasStudioInputs)) {
        if (sourceModelId === DIALOGUE_MODEL_ID && dialogueModel(catalog)) return { pathname: '/dialogue' as const, params: { reopen: jobId } };
        if (sourceModelId === SPEECH_MODEL_ID && speechModel(catalog)) return { pathname: '/speech' as const, params: { reopen: jobId } };
    }
    if (!saved?.request) return missing();
    const carry = normalizeTemplateCarry(saved.carry, switching ? targetModelId : saved.request.modelId);
    const model = catalog.find(m => m.id === (targetModelId ?? saved.request.modelId));
    if (!model) return { ...makeAnotherHref(modelId), params: { ...carry, modelId } };
    const references: GenerationReference[] = [];
    for (const ref of saved.request.references ?? []) {
        if (ref.origin !== 'asset') continue;
        try {
            await mediaApi(api).getAsset(ref.asset_id);
            if (!current()) return null;
            references.push(ref);
        } catch { if (!current()) return null; }
    }
    return createHandoff(model, carry, saved.settings, references, { rightsConfirmed: saved.request.sourceRights }, (saved.omittedReferences ?? 0) + (saved.request.references?.length ?? 0) - references.length, switching);
}
