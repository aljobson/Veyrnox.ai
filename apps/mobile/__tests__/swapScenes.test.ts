import { slotsFor } from '../src/lib/sources';
import { fetchSwapScene, swapSceneModel, type SwapScene } from '../src/lib/swapScenes';
import { generationSignature } from '../src/lib/generationSubmit';
import type { ApiClient } from '../src/lib/api';
import type { CatalogModel } from '../src/lib/media';
const scene: SwapScene = { id: 'scene-a', name: 'Scene', swapOffer: 'swap-recast', people: 2, credits: 134, durationSeconds: 5 };
const model: CatalogModel = { id: 'swap-recast', name: 'Swap · Pro', modality: 'video-to-video', credits: 134, durations: [5], gated: false,
    capabilities: { inputs: {}, media: { image: { required: true, maxFiles: 2 }, video: { required: true } } } };
test('scene slots are photo-only and carry the exact required people count', () => {
    const projected = swapSceneModel(model, scene);
    expect(slotsFor(projected, scene).map(slot => [slot.slot, slot.required, slot.maxFiles])).toEqual([['image', true, 2]]);
    expect(projected.credits).toBe(134); expect(projected.durations).toEqual([5]);
});
test('config uses the public catalog lookup and refuses unavailable scenes', async () => {
    const request = jest.fn().mockResolvedValueOnce(scene).mockRejectedValueOnce(new Error('not found'));
    const api = { request } as unknown as ApiClient;
    expect(await fetchSwapScene(api, scene.id)).toBe(scene);
    expect(request).toHaveBeenCalledWith('/api/catalog?swap=scene-a');
    await expect(fetchSwapScene(api, 'missing')).rejects.toThrow('not found');
});
test('same photo/model with another scene changes the continuation signature', () => {
    const request = { modelId: model.id, prompt: '', durationSeconds: null, swap: scene.id };
    expect(generationSignature(request, 1)).toBe(generationSignature({ ...request }, 1));
    expect(generationSignature(request, 1)).not.toBe(generationSignature({ ...request, swap: 'scene-b' }, 1));
});
