jest.mock('../src/lib/crash', () => ({ captureIssue: jest.fn() }));
import { act } from 'react';
import * as ReactNative from 'react-native';
import { createRoot } from 'test-renderer';
import { File } from 'expo-file-system';
import { bindCacheUser, clearExportFiles, exportDirectory, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';

// Export files from an earlier app version are still swept on launch, sign-out and account switch.
const localFile = () => new File(exportDirectory(), 'veyrnox-data-11111111.json');
beforeEach(async () => { resetCacheUser(); clearExportFiles(); await bindCacheUser('alice'); });
afterEach(() => clearExportFiles());
test('launch cleanup, sign-out and account switch clear orphan files', async () => {
    const seed = () => { exportDirectory().create({ intermediates: true, idempotent: true }); const f = localFile(); f.create(); return f; };
    const orphan = seed(); clearExportFiles(); expect(orphan.exists).toBe(false);
    seed(); await wipeCache(); expect(orphan.exists).toBe(false);
    const storage = createMemoryStorage(), cache = createCache(storage);
    await bindCacheUser('alice', cache, storage); seed(); await bindCacheUser('bob', cache, storage);
    expect(orphan.exists).toBe(false);
});

test('the real AuthProvider launch effect removes a previous-process file before session restoration', async () => {
    exportDirectory().create({ intermediates: true, idempotent: true }); localFile().create();
    expect(localFile().exists).toBe(true);
    const { AuthProvider } = jest.requireActual('../src/auth/AuthProvider') as typeof import('../src/auth/AuthProvider');
    const launch = createRoot();
    try {
        await act(async () => launch.render(<AuthProvider><ReactNative.Text>Launch</ReactNative.Text></AuthProvider>));
        expect(localFile().exists).toBe(false);
    } finally { await act(async () => launch.unmount()); }
});
