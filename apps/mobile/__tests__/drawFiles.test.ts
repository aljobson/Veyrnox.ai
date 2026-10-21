jest.mock('expo-crypto', () => { let id = 0; return { randomUUID: () => `drawing-${++id}` }; });
import { File, Directory, Paths } from 'expo-file-system';
import { resetCacheUser } from '../src/lib/appCache';
import { claimDrawFile, clearDrawFiles, deleteDrawFile, releaseDrawFile, writeDrawing } from '../src/lib/drawFiles';

// Use the same in-memory Expo filesystem supplied by the installed Jest preset as appCache.test.
test('first write sweeps leftovers, preserves claimed files, and never sweeps live forms again', async () => {
    const dir = new Directory(Paths.cache, 'veyrnox-draw');
    dir.create({ intermediates: true, idempotent: true });
    const stale = new File(dir, 'before.png'); stale.create(); stale.write(new Uint8Array([1]));
    const live = new File(dir, 'owned.png'); live.create(); live.write(new Uint8Array([2]));
    claimDrawFile(live.uri);
    const first = await writeDrawing(new Uint8Array([1, 2, 3]));
    expect(first).toMatchObject({ mimeType: 'image/png', size: 3 });
    expect(first.uri).toContain('/veyrnox-draw/');
    expect(new File(first.uri).exists).toBe(true);
    expect(stale.exists).toBe(false);
    expect(live.exists).toBe(true);
    claimDrawFile(first.uri);
    const second = await writeDrawing(new Uint8Array([4]));
    expect(new File(first.uri).exists).toBe(true);
    expect(new File(second.uri).exists).toBe(true);
    releaseDrawFile(first.uri);
    expect(new File(first.uri).exists).toBe(false);
    releaseDrawFile(live.uri);
});
test('deletion is confined to the drawing folder and owner counts prevent premature deletion', async () => {
    const outside = new File(Paths.cache, 'outside.png'); outside.create();
    deleteDrawFile(outside.uri);
    deleteDrawFile(new Directory(Paths.cache, 'veyrnox-draw').uri + '/../outside.png');
    expect(outside.exists).toBe(true);
    const file = await writeDrawing(new Uint8Array([1]));
    claimDrawFile(file.uri); claimDrawFile(file.uri);
    releaseDrawFile(file.uri);
    expect(new File(file.uri).exists).toBe(true);
    releaseDrawFile(file.uri);
    expect(new File(file.uri).exists).toBe(false);
    outside.delete();
});
test('account notification clears all drawing files', async () => {
    const file = await writeDrawing(new Uint8Array([1, 2]));
    claimDrawFile(file.uri);
    resetCacheUser();
    expect(new File(file.uri).exists).toBe(false);
    clearDrawFiles();
});
