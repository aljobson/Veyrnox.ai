import type { FidelityUIContract as FidelityContract } from './templateFidelityRuntime';
export interface TemplateContractSource {
    id?: string | null;
    fidelity?: FidelityContract | null;
    sourcePrompt?: string | null;
    sourcePromptOrigin?: string | null;
}
export function templateContract(preset: TemplateContractSource | null | undefined): FidelityContract | null;
export { templatePhotoHints, templatePhotosUnavailable, templateBoundPrompt, fidelityBlocked, fidelityTemplateId, templatePhotoError } from './templateFidelityRuntime';
