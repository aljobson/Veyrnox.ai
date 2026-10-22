import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import Screen from '../src/app/(app)/film/index';
import { ApiError } from '../src/lib/api';
import { bindCacheUser, resetCacheUser, wipeCache } from '../src/lib/appCache';
import { loadStudio, saveStudio } from '../src/lib/filmStudioStore';
declare const __dirname: string;
const { readFileSync } = require('fs'); const { resolve } = require('path');
const source = readFileSync(resolve(__dirname, '../../../app/veyrnox/_lib/filmStudio.js'), 'utf8').replace(/^export /gm, '');
const emptyFilm = new Function(`${source}\nreturn emptyFilm;`)();
const cloud = () => require('../src/lib/filmCloud') as typeof import('../src/lib/filmCloud');
const mockRequest = jest.fn(); const mockApi = { request: mockRequest }; const mockPush = jest.fn();
let mockFocus: (() => void | (() => void)) | undefined;
const mockRouter = { push: mockPush };
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void) => { mockFocus = callback; require('react').useEffect(callback, [callback]); } }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
void [RN.ScrollView, RN.Text, RN.Pressable, RN.StyleSheet, RN.View, RN.ActivityIndicator];
const id = '11111111-1111-4111-8111-111111111111';
const row = { id, name: 'Film B', revision: 1 };
const raw = (name: string) => JSON.stringify({ ...emptyFilm(), name });
const intro = 'Film Studio plans a film in seven stages on veyrnox.ai. The phone opens a copy of it: choose a file you exported, or a film saved to your account.';
let root: Root;
const has = (text: string) => root.container.queryAll(n => n.children.some(c => typeof c === 'string' && c.includes(text))).length > 0;
async function press(text: string) {
    const node = root.container.queryAll(n => n.children.some(c => c === text))[0];
    expect(node).toBeDefined();
    // test-renderer exposes the native Pressable as the Text's parent.
    let button: any = node;
    while (button && button.props.accessibilityRole !== 'button') button = button.parent;
    expect(button).toBeDefined();
    await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
async function mount() { root = createRoot(); await act(async () => root.render(<Screen />)); }
async function open(name = 'Film B') { await cloud().openCloudFilm({ request: jest.fn().mockResolvedValue({ project: row, studio_json: raw(name) }) }, id); }
async function pick(text: string) {
    const file = new File(Paths.cache, 'film-cloud-import.json'); if (!file.exists) file.create(); file.write(text);
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: false, assets: [{ name: 'film.json', uri: file.uri, size: text.length, lastModified: 0 }] });
    await press('Open a newer export');
}
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); resetCacheUser(); await wipeCache(); await bindCacheUser('alice'); mockFocus = undefined;
    mockRequest.mockResolvedValue({ projects: [] });
});
afterEach(async () => { if (root) await act(async () => root.unmount()); resetCacheUser(); });
test('two saved films add exactly one accessible navigation row', async () => {
    mockRequest.mockResolvedValue({ projects: [row, { ...row, id: '22222222-2222-4222-8222-222222222222' }] }); await mount();
    expect(has('Films saved to your account')).toBe(true); expect(has('2 films')).toBe(true);
    await press('Films saved to your account'); expect(mockPush).toHaveBeenCalledWith('/film/cloud');
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Films saved to your account, 2 films')).toHaveLength(1);
});
test.each(['empty', 'malformed', 404, 403, 429, 503, 401, 0])('intro stays neutral and optional row stays absent for %s', async kind => {
    if (typeof kind === 'number') mockRequest.mockRejectedValue(new ApiError(kind, 'unknown'));
    else mockRequest.mockResolvedValue(kind === 'empty' ? { projects: [] } : { projects: 'x' });
    await mount(); expect(has(intro)).toBe(true); expect(has('not on our servers')).toBe(false);
    expect(has('Films saved to your account')).toBe(false);
    for (const text of ['api_unknown', '404', 'Not available yet.', 'Try again in a moment.']) expect(has(text)).toBe(false);
});
test('intro also appears with an active film and a successful list', async () => {
    await saveStudio(raw('Imported')); mockRequest.mockResolvedValue({ projects: [row] }); await mount();
    expect(has(intro)).toBe(true); expect(has('not on our servers')).toBe(false);
});
test('focus after opening B replaces A and Remove clears both sources', async () => {
    await saveStudio(raw('Film A')); await mount(); expect(has('Film A')).toBe(true);
    await open(); await act(async () => { mockFocus!(); });
    expect(has('Film B')).toBe(true); expect(has('Film A')).toBe(false);
    await press('Remove from this phone'); expect(cloud().getOpenedFilm()).toBeNull(); expect(await loadStudio()).toBeNull(); expect(has('Film B')).toBe(false);
});
test('invalid import leaves B in memory and on screen through a focus reload', async () => {
    await open(); await mount(); await pick('invalid json');
    expect(has('That is not a Film Studio JSON export.')).toBe(true); expect(has('Film B')).toBe(true); expect(cloud().getOpenedFilm()?.film.name).toBe('Film B');
    await act(async () => { mockFocus!(); }); expect(has('Film B')).toBe(true); expect(await loadStudio()).toBeNull();
});
test('valid import clears the cloud slot and shows the imported film', async () => {
    await open(); await mount(); await pick(raw('Imported'));
    expect(cloud().getOpenedFilm()).toBeNull(); expect(has('Imported')).toBe(true); expect(has('Film B')).toBe(false);
    expect((await loadStudio())?.film.name).toBe('Imported');
});
test.each(['cancel', 'throw'])('picker %s preserves the active film', async kind => {
    await open(); await mount();
    if (kind === 'cancel') jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
    else jest.mocked(DocumentPicker.getDocumentAsync).mockRejectedValue(new Error('private'));
    await press('Open a newer export'); expect(has('Film B')).toBe(true); expect(cloud().getOpenedFilm()?.film.name).toBe('Film B');
});
test.each(['bob', 'alice'])('session reset drops mounted film and cloud count (%s)', async user => {
    await open('Alice private film'); mockRequest.mockResolvedValue({ projects: [row] }); await mount();
    expect(has('Alice private film')).toBe(true); expect(has('Films saved to your account')).toBe(true);
    mockRequest.mockResolvedValue({ projects: [] });
    await act(async () => { await wipeCache(); await bindCacheUser(user); });
    expect(has('Alice private film')).toBe(false); expect(has('Films saved to your account')).toBe(false); expect(has('Open your film on the phone')).toBe(true);
});
test('stale list response is ignored after switching accounts', async () => {
    let resolve!: (value: unknown) => void; mockRequest.mockReturnValueOnce(new Promise(r => { resolve = r; })); await mount();
    await act(async () => bindCacheUser('bob'));
    await act(async () => resolve({ projects: [row] })); expect(has('Films saved to your account')).toBe(false);
});
test('pending import from a previous session cannot change the new screen or slot', async () => {
    await open(); await mount(); let resolve!: (value: unknown) => void;
    jest.mocked(DocumentPicker.getDocumentAsync).mockReturnValue(new Promise(r => { resolve = r; }) as any);
    // Do not await the event handler while the picker is open.
    const node = root.container.queryAll(n => n.children.some(c => c === 'Open a newer export'))[0];
    await act(async () => { (node.parent as any).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
    await act(async () => { await wipeCache(); await bindCacheUser('bob'); });
    await act(async () => resolve({ canceled: true, assets: null }));
    expect(has('Film B')).toBe(false); expect(cloud().getOpenedFilm()).toBeNull();
});
