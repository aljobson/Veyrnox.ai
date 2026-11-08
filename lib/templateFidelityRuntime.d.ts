export interface FidelityContract {
    contractVersion: number; id: string; class: string; modelId: string; allowedModels: string[];
    slotCount?: number; boundHash?: string;
    tokenMap?: { token: string; target: string; slot: number; offset: number }[];
    sourcePrompt: string; sourceHash: string; prompt: string; promptHash: string;
    photoPrompt: string; photoPromptHash: string; identityLine: boolean;
    requiredReferences: { imageMin: number; imageMax: number; video: boolean };
    duration: number | null; aspect: string | null; negativePrompt: string; negativeMax?: number; photoGuidance: string; minPhotoDimension: number;
}
// The detail/API payload deliberately omits audit hashes and interned indices.
export type FidelityUIContract = Pick<FidelityContract, 'id' | 'class' | 'modelId' | 'allowedModels' | 'slotCount' | 'tokenMap' | 'sourcePrompt' | 'prompt' | 'requiredReferences' | 'duration' | 'aspect' | 'negativePrompt' | 'negativeMax' | 'photoGuidance' | 'minPhotoDimension'>;
export function fidelityBlocked(contract: Pick<FidelityContract, 'class'> | null | undefined, prompt?: string): boolean;
export function fidelityTemplateId(contract: FidelityUIContract | null | undefined, prompt: string, modelId: string, inputs?: { aspect_ratio?: string | null; duration_seconds?: number | null; negative_prompt?: string }): string | undefined;
export function templatePhotoError(contract: FidelityUIContract | null | undefined, width: number | undefined, height: number | undefined, count?: number): string | null;
export interface FidelityData { prompts: string[]; templates: Record<string, Omit<FidelityContract, 'prompt' | 'sourcePrompt' | 'photoPrompt'> & { promptIndex: number; sourcePromptIndex: number; photoPromptIndex: number }> }

export function templateBoundPrompt(contract: FidelityUIContract | null | undefined, prompt: string, modelId: string, count: number): string;

export function templatePhotosUnavailable(contract: FidelityUIContract | null | undefined, media?: { image?: { maxFiles?: number } }): boolean;

export function templatePhotoHints(contract: FidelityUIContract | null | undefined): string[];
