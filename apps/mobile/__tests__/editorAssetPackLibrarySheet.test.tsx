import { act, type ComponentProps } from 'react';
import { createRoot, type Root, type TestNode } from 'test-renderer';
import * as DocumentPicker from 'expo-document-picker';
import { AccessibilityInfo, Platform } from 'react-native';
import { AssetPackLibrarySheet } from '../src/components/editor/assetPacks/AssetPackLibrarySheet';
import { rawText, t } from '../src/lib/i18n';
import type { AssetPack } from '../src/lib/editorAssetPackCatalog';

const mockList = jest.fn(), mockUpsert = jest.fn(), mockPackFileProblem = jest.fn(), mockCreate = jest.fn(), mockShare = jest.fn(), mockDeletes: string[] = [];
jest.mock('../src/lib/editorAssetPackCatalog', () => ({
    editorAssetPackCatalog: { list: (...args: unknown[]) => mockList(...args), upsert: (...args: unknown[]) => mockUpsert(...args) },
    packFileProblem: (...args: unknown[]) => mockPackFileProblem(...args), parseNativeAssetPack: jest.fn(),
    createNativeAssetPack: (...args: unknown[]) => mockCreate(...args), shareNativeAssetPack: (...args: unknown[]) => mockShare(...args),
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class { uri: string; constructor(uri: string) { this.uri = uri; } get exists() { return true; } get size() { return 8; }
    delete() { mockDeletes.push(this.uri); } async text() { return '{}'; } } }));

const pack: AssetPack = { version: 1, id: 'pack-one', name: 'Studio Kit', capabilities: ['local-catalog'], assets: [
    { id: 'asset-1', name: 'Blue Backdrop', file: 'backdrop.png', kind: 'image', category: 'Photos', tags: ['blue'], sha256: 'a'.repeat(64),
        attribution: { credit: 'Creator', usage: 'Licensed for this edit', url: 'https://example.test/licence' } },
    { id: 'asset-2', name: 'Room Tone', file: 'room.wav', kind: 'audio', category: 'Sound effects', tags: ['quiet'], sha256: 'b'.repeat(64),
        attribution: { credit: 'Sound Studio', usage: 'Original recording', url: '' } },
] };

let root: Root;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); jest.clearAllMocks(); mockDeletes.length = 0; mockList.mockResolvedValue([pack]); mockUpsert.mockResolvedValue([pack]);
    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' }); jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    mockPackFileProblem.mockReturnValue(null); jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null } as never);
    mockCreate.mockResolvedValue(pack); mockShare.mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); });

async function render(onAdd: ComponentProps<typeof AssetPackLibrarySheet>['onAdd'] = jest.fn(async () => 'placed' as const), onClose = jest.fn()) {
    await act(async () => root.render(<AssetPackLibrarySheet visible playhead="00:12.4" onClose={onClose} onAdd={onAdd} />));
    await act(async () => {}); return { onAdd, onClose };
}
const button = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === rawText(label) && typeof node.props.onClick === 'function')[0];
const textContent = (node: TestNode): string => typeof node === 'string' ? node : node.children.map(textContent).join('');
const press = async (label: string) => { const node = button(label); expect(node).toBeDefined(); await act(async () => node.props.onClick({ nativeEvent: {} })); };

test('requires rights acknowledgement before the exact local file can be added at the captured playhead', async () => {
    const { onAdd, onClose } = await render(); await press(t('editorPack.review', { name: 'Blue Backdrop' }));
    expect(button(t('editorPack.addAt', { time: '00:12.4' })).props.accessibilityState.disabled).toBe(true);
    const checkbox = root.container.queryAll(node => node.props.accessibilityRole === 'checkbox')[0];
    await act(async () => checkbox.props.onClick({ nativeEvent: {} }));
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///backdrop.png', name: 'backdrop.png', size: 8, mimeType: 'image/png' }] } as never);
    await press(t('editorPack.addAt', { time: '00:12.4' }));
    expect(onAdd).toHaveBeenCalledWith(pack, pack.assets[0], expect.objectContaining({ name: 'backdrop.png', mimeType: 'image/png' }), expect.any(Function), expect.any(Function));
    expect(onClose).toHaveBeenCalledTimes(1); expect(mockPackFileProblem).toHaveBeenCalledTimes(1);
});

test('search and category filtering expose only matching catalog items', async () => {
    await render(); const search = root.container.queryAll(node => node.props.accessibilityLabel === rawText(t('editorPack.search')))[0];
    await act(async () => search.props.onChangeText('quiet'));
    expect(root.container.queryAll(node => textContent(node) === 'Room Tone', { matchDeepestOnly: true })).toHaveLength(1);
    expect(root.container.queryAll(node => textContent(node) === 'Blue Backdrop', { matchDeepestOnly: true })).toHaveLength(0);
    await press(t('editorPack.category.Photos'));
    expect(root.container.queryAll(node => textContent(node) === t('editorPack.noResults'), { matchDeepestOnly: true })).toHaveLength(1);
});

test('verification problems stay inside the modal as an alert and allow retry', async () => {
    await render(); await press(t('editorPack.review', { name: 'Blue Backdrop' }));
    const checkbox = root.container.queryAll(node => node.props.accessibilityRole === 'checkbox')[0]; await act(async () => checkbox.props.onClick({ nativeEvent: {} }));
    mockPackFileProblem.mockReturnValueOnce('wrongName');
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///wrong.png', name: 'wrong.png', size: 8, mimeType: 'image/png' }] } as never);
    await press(t('editorPack.addAt', { time: '00:12.4' }));
    const alerts = root.container.queryAll(node => node.props.accessibilityRole === 'alert'); expect(alerts).toHaveLength(1);
    expect(textContent(alerts[0])).toContain(t('editorPack.wrongName', { name: 'backdrop.png' }));
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(t('editorPack.wrongName', { name: 'backdrop.png' }));
});
test('a stale manifest picker deletes its private cache result instead of reopening the closed sheet', async () => {
    let finish!: (value: unknown) => void;
    jest.mocked(DocumentPicker.getDocumentAsync).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }) as never);
    const onClose = jest.fn(); await render(undefined, onClose); await press(t('editorPack.open'));
    await act(async () => root.render(<AssetPackLibrarySheet visible={false} playhead="00:12.4" onClose={onClose} onAdd={jest.fn(async () => 'changed' as const)} />));
    await act(async () => finish({ canceled: false, assets: [{ uri: 'file:///stale.json', name: 'stale.json', size: 8, mimeType: 'application/json' }] }));
    expect(mockDeletes).toContain('file:///stale.json'); expect(mockUpsert).not.toHaveBeenCalled();
});
test('Cancel Current Check invalidates the add operation, deletes picker cache and stays retryable', async () => {
    let finish!: (value: 'changed') => void, operationLive: (() => boolean) | undefined;
    const onAdd = jest.fn((_pack, _asset, _picked, progress, live) => { operationLive = live; progress('verifying'); return new Promise<'changed'>(resolve => { finish = resolve; }); });
    const { onClose } = await render(onAdd); await press(t('editorPack.review', { name: 'Blue Backdrop' }));
    const checkbox = root.container.queryAll(node => node.props.accessibilityRole === 'checkbox')[0]; await act(async () => checkbox.props.onClick({ nativeEvent: {} }));
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///backdrop.png', name: 'backdrop.png', size: 8, mimeType: 'image/png' }] } as never);
    await press(t('editorPack.addAt', { time: '00:12.4' })); expect(operationLive?.()).toBe(true);
    await press(t('editorPack.cancelOperation')); expect(operationLive?.()).toBe(false);
    await act(async () => finish('changed')); expect(mockDeletes).toContain('file:///backdrop.png'); expect(onClose).not.toHaveBeenCalled();
});
test('Create Pack hashes selected local files, saves the catalog and opens the system share flow', async () => {
    await render(); await press(t('editorPack.create'));
    const fill = async (label: string, value: string) => { const node = root.container.queryAll(item => item.props.accessibilityLabel === rawText(label) && item.props.onChangeText)[0];
        await act(async () => node.props.onChangeText(value)); };
    await fill(t('editorPack.packName'), 'My Pack'); await fill(t('editorPack.creator'), 'Creator'); await fill(t('editorPack.rights'), 'Original work');
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///backdrop.png', name: 'backdrop.png', size: 8, mimeType: 'image/png' }] } as never);
    await press(t('editorPack.chooseFiles'));
    const checkbox = root.container.queryAll(node => node.props.accessibilityRole === 'checkbox')[0]; await act(async () => checkbox.props.onClick({ nativeEvent: {} }));
    await press(t('editorPack.createAndShare'));
    expect(mockCreate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ name: 'backdrop.png' })]), expect.objectContaining({ name: 'My Pack', credit: 'Creator' }),
        expect.any(Function), expect.any(Function));
    expect(mockUpsert).toHaveBeenCalledWith(pack); expect(mockShare).toHaveBeenCalledWith(pack, expect.any(Function));
    expect(mockDeletes).toContain('file:///backdrop.png');
});
