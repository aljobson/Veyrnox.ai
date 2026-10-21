import { act } from 'react';
import * as ReactNative from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import Screen from '../src/app/(app)/privacy-export';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, clearExportFiles, exportDirectory, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { createCache, createMemoryStorage } from '../src/lib/cache';
import strings from '../src/lib/i18n/messages/en/privacyExport';

const mockRequest = jest.fn();
jest.mock('expo-router', () => ({ Stack: { Screen: () => null } }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: { request: mockRequest }, getAccessToken: jest.fn(), adoptSession: jest.fn() }) }));
jest.mock('../src/lib/auth/accountCalls', () => ({ fetchProfile: jest.fn(), verifyFactor: jest.fn() }));
// Use the same in-memory filesystem provided by jest-expo as appCache.test.ts.
void [ReactNative.ScrollView, ReactNative.Text, ReactNative.TextInput, ReactNative.Pressable, ReactNative.StyleSheet, ReactNative.View];
let root: Root;
const id = '11111111-1111-4111-8111-111111111111';
const label = (key: keyof typeof strings) => strings[key];
async function press(text: string) {
    const controls = root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === text);
    expect(controls).toHaveLength(1);
    await act(async () => { controls[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
function has(text: string) { return root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0; }
const localFile = () => new File(exportDirectory(), 'veyrnox-data-11111111.json');
beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); resetCacheUser(); clearExportFiles();
    await bindCacheUser('alice');
    mockRequest.mockImplementation(async (path: string) => path.includes('?') ? { rows: [{ email: 'mine@example.invalid' }], next: null } :
        { export_id: id, as_of: new Date().toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString(), resumed: false, sections: ['profile'] });
    root = createRoot(); await act(async () => root.render(<Screen />));
});
afterEach(async () => { await act(async () => root.unmount()); clearExportFiles(); });
test('idle explains the file and offers preparation', () => {
    expect(has(label('privacyExport.explanation'))).toBe(true); expect(has(label('privacyExport.storage'))).toBe(true);
    expect(has(label('privacyExport.prepare'))).toBe(true); expect(mockRequest).not.toHaveBeenCalled();
});
test('404 shows the email route without a code', async () => {
    mockRequest.mockRejectedValue(new ApiError(404, 'not_found'));
    await press(label('privacyExport.prepare'));
    expect(has('Not available in the app yet. Email privacy@veyrnox.com')).toBe(true); expect(has('not_found')).toBe(false);
});
test('ready opens the share sheet as JSON, and unmount removes the file', async () => {
    await press(label('privacyExport.prepare')); expect(has(label('privacyExport.ready'))).toBe(true);
    expect(localFile().exists).toBe(true);
    await press(label('privacyExport.share'));
    expect(Sharing.shareAsync).toHaveBeenCalledWith(localFile().uri, { mimeType: 'application/json' });
    await act(async () => root.unmount()); expect(localFile().exists).toBe(false);
});
test('account switch aborts and deletes the file', async () => {
    await press(label('privacyExport.prepare'));
    await act(async () => bindCacheUser('bob'));
    expect(localFile().exists).toBe(false); expect(has(label('privacyExport.ready'))).toBe(false);
});
test('mfa refusal shows the inline six-digit field', async () => {
    mockRequest.mockRejectedValue(new ApiError(403, 'mfa_required'));
    await press(label('privacyExport.prepare'));
    expect(has(label('privacyExport.mfa'))).toBe(true);
    expect(root.container.queryAll(n => n.props.maxLength === 6).length).toBeGreaterThan(0);
});
test('a removed file can be prepared again while the download window is open', async () => {
    await press(label('privacyExport.prepare')); localFile().delete();
    await press(label('privacyExport.share')); expect(has(label('privacyExport.expired'))).toBe(true);
    await press(label('privacyExport.again')); expect(has(label('privacyExport.ready'))).toBe(true);
});
test('launch cleanup, sign-out and account switch clear orphan files without a mounted export screen', async () => {
    await act(async () => root.unmount());
    const seed = () => { exportDirectory().create({ intermediates: true, idempotent: true }); const f = localFile(); f.create(); return f; };
    const orphan = seed(); clearExportFiles(); expect(orphan.exists).toBe(false);
    seed(); await wipeCache(); expect(orphan.exists).toBe(false);
    const storage = createMemoryStorage(), cache = createCache(storage);
    await bindCacheUser('alice', cache, storage); seed(); await bindCacheUser('bob', cache, storage);
    expect(orphan.exists).toBe(false);
});

test('the real AuthProvider launch effect removes a previous-process file before session restoration', async () => {
    await act(async () => root.unmount());
    exportDirectory().create({ intermediates: true, idempotent: true }); localFile().create();
    expect(localFile().exists).toBe(true);
    const { AuthProvider } = jest.requireActual('../src/auth/AuthProvider') as typeof import('../src/auth/AuthProvider');
    const launch = createRoot();
    try {
        await act(async () => launch.render(<AuthProvider><ReactNative.Text>Launch</ReactNative.Text></AuthProvider>));
        expect(localFile().exists).toBe(false);
    } finally { await act(async () => launch.unmount()); }
});
