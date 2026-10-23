import { listEditorProjectAssets } from '../src/lib/editorProjectAssets';

test('turns inspected project assets into editor media and ignores unsupported rows', async () => {
    const api = { request: jest.fn().mockResolvedValue({ assets: [
        { id: '11111111-1111-1111-1111-111111111111', content_type: 'video/mp4', duration_ms: 2500, width: 1920, height: 1080 },
        { id: '22222222-2222-2222-2222-222222222222', content_type: 'image/jpeg', width: 1000, height: 1000 },
        { id: 'not-an-id', content_type: 'video/mp4' },
        { id: '33333333-3333-3333-3333-333333333333', content_type: 'application/pdf' },
    ] }) };
    await expect(listEditorProjectAssets(api, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).resolves.toEqual([
        expect.objectContaining({ id: 'p-11111111-1111-1111-1111-111111111111', kind: 'video', frames: 75, assetSource: { projectId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', assetId: '11111111-1111-1111-1111-111111111111' } }),
        expect.objectContaining({ id: 'p-22222222-2222-2222-2222-222222222222', kind: 'image', frames: 90, hasAudio: false }),
    ]);
});

test('a closed project-assets surface does not hide timeline media', async () => {
    const api = { request: jest.fn().mockRejectedValue(new Error('closed')) };
    await expect(listEditorProjectAssets(api, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).resolves.toEqual([]);
});
