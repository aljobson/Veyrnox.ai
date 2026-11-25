import { createMemoryStorage } from '../src/lib/cache';
import { DEFAULT_EDITOR_SERVER_EXPORT_RESOLUTION, readEditorExportResolution, writeEditorExportResolution } from '../src/lib/editorExportPreferences';

const A = '11111111-1111-4111-8111-111111111111';

test('mobile export resolution is account-scoped, validated and durable', async () => {
    const storage = createMemoryStorage();
    expect(await readEditorExportResolution(storage, A)).toBe(DEFAULT_EDITOR_SERVER_EXPORT_RESOLUTION);
    expect(await writeEditorExportResolution('2160p', storage, A, () => A)).toBe(true);
    expect(await readEditorExportResolution(storage, A)).toBe('2160p');
    expect(await readEditorExportResolution(storage, '22222222-2222-4222-8222-222222222222')).toBe(DEFAULT_EDITOR_SERVER_EXPORT_RESOLUTION);
});

test('mobile export preferences fail closed when malformed', async () => {
    const storage = createMemoryStorage();
    await storage.set(`editor.export.preferences.v1:${A}`, JSON.stringify({ owner: A, resolution: '8k' }));
    expect(await readEditorExportResolution(storage, A)).toBe(DEFAULT_EDITOR_SERVER_EXPORT_RESOLUTION);
    expect(await storage.get(`editor.export.preferences.v1:${A}`)).toBeNull();
});
