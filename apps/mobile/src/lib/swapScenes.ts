import type { ApiClient } from './api';
import type { CatalogModel } from './media';

export interface SwapScene {
    readonly id: string;
    readonly name: string;
    readonly swapOffer: 'swap-recast' | 'swap-quick';
    readonly people: 1 | 2;
    readonly credits: number;
    readonly durationSeconds: 5;
}

export async function fetchSwapScene(api: ApiClient, id: string): Promise<SwapScene> {
    return api.request<SwapScene>(`/api/catalog?swap=${encodeURIComponent(id)}`);
}

export function swapSceneModel(model: CatalogModel, scene: SwapScene): CatalogModel {
    return { ...model, credits: scene.credits, durations: [5], capabilities: { ...model.capabilities,
        media: { image: { ...model.capabilities?.media?.image, required: true, maxFiles: scene.people } } } };
}
