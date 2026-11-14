import { imageCategoriesOf, imageTemplatesIn, parseImageTemplates } from '../src/lib/imageTemplates';
const BASE = 'https://veyrnox.ai';
const body = { templates: [
    { id: 'forest-light', name: 'FOREST LIGHT', category: 'REALISTIC', modelId: 'nano-banana-kie', prompt: 'A forest portrait', previewImage: '/showcase/a.webp', previewAspect: '3 / 4' },
    { id: 'ornament', name: 'ORNAMENT', category: 'CHRISTMAS', modelId: 'nano-banana-pro-edit-grsai', prompt: 'Your photo as an ornament', previewImage: 'https://cdn.example/b.webp', photoRequired: true },
    { id: 'odd-picture', name: 'ODD', category: 'REALISTIC', modelId: 'm', prompt: 'p', previewImage: '//evil.example/x.webp', previewAspect: 'wide' },
    { id: 'no-prompt', name: 'NO PROMPT', category: 'REALISTIC', modelId: 'm' },
] };

test('parse keeps runnable image templates and resolves their pictures against the site', () => {
    const list = parseImageTemplates(body, BASE);
    expect(list.map(t => t.id)).toEqual(['forest-light', 'ornament', 'odd-picture']);
    expect(list[0]).toMatchObject({ previewUrl: `${BASE}/showcase/a.webp`, previewAspect: 0.75, photoRequired: false });
    expect(list[1]).toMatchObject({ previewUrl: 'https://cdn.example/b.webp', previewAspect: 1, photoRequired: true });
    expect(list[2].previewUrl).toBeNull();
    expect(list[2].previewAspect).toBe(1);
    expect(parseImageTemplates(null, BASE)).toEqual([]);
});

test('categories keep first-seen order; the chip and the search words both narrow the list', () => {
    const list = parseImageTemplates(body, BASE);
    expect(imageCategoriesOf(list)).toEqual(['REALISTIC', 'CHRISTMAS']);
    expect(imageTemplatesIn(list, 'ALL', '')).toHaveLength(3);
    expect(imageTemplatesIn(list, 'CHRISTMAS', '').map(t => t.id)).toEqual(['ornament']);
    expect(imageTemplatesIn(list, 'ALL', 'forest portrait').map(t => t.id)).toEqual(['forest-light']);
});
