import { act } from 'react';
import * as ReactNative from 'react-native';
import { createRoot } from 'test-renderer';
import { Directory } from 'expo-file-system';
import { AuthProvider } from '../src/auth/AuthProvider';
import { clearExportFiles, exportDirectory } from '../src/lib/appCache';

// Its own file, so the once-per-process launch cleanup has not run yet.
test('the AuthProvider launch effect survives an export-file delete that throws', async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    exportDirectory().create({ intermediates: true, idempotent: true });
    const failing = jest.spyOn(Directory.prototype, 'delete').mockImplementation(() => { throw new Error('io'); });
    const launch = createRoot();
    try {
        await act(async () => launch.render(<AuthProvider><ReactNative.Text>Launch</ReactNative.Text></AuthProvider>));
        expect(failing).toHaveBeenCalled();
        expect(launch.container.queryAll(n => n.children.includes('Launch')).length).toBeGreaterThan(0);
    } finally {
        await act(async () => launch.unmount());
        failing.mockRestore();
        clearExportFiles();
    }
});
