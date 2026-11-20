import { internalModelId, publicModelId } from '../src/lib/publicModelIds';

// Deep links carry the catalog's public ids; the app keys its catalog by the internal ones (QA build 59).
test.each([
    ['nano-banana-a1', 'nano-banana-kie'],
    ['nano-banana-pro-a2', 'nano-banana-pro-grsai'],
    ['nano-banana-pro-edit-a2', 'nano-banana-pro-edit-grsai'],
    ['flux-2-pro', 'flux-2-pro'],
    ['seedream-4', 'seedream-4'],
])('%s maps to %s and back', (publicId, key) => {
    expect(internalModelId(publicId)).toBe(key);
    expect(publicModelId(key)).toBe(publicId);
});
