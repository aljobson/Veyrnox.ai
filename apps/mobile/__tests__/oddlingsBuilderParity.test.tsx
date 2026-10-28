import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Builder from '../src/app/(app)/oddlings/build';
import { HandoffCard } from '../src/components/oddlings/HandoffCard';
import { parseOddlingInstructions } from '../src/lib/oddlingsChat';
import { stageCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import { t } from '../src/lib/i18n';
const mockRouter = { push: jest.fn(), replace: jest.fn() }, mockApi = {};
let mockOwner = 'A', mockBalance: number | null = 5;
var mockListeners: Set<() => void>;
const mockChooser = jest.fn(), mockUpload = jest.fn(), mockFetch = jest.fn(), mockOnline = jest.fn();
const mockChat = { listModels: jest.fn(), createThread: jest.fn(), updateThread: jest.fn() };
const mockEngine = { syncNow: async () => 'unavailable', getState: () => 'unavailable' };
const portrait = { id: 'flux-2-pro', name: 'Portrait', modality: 'text-to-image', credits: 6, gated: false, durations: [], capabilities: { inputs: { prompt: {} } } };
const reference = { ...portrait, id: 'nano-banana-pro-edit', capabilities: { inputs: { prompt: {} }, media: { image: { required: true, maxFiles: 3, label: 'Image' } } } };
let mockCatalog = [portrait, reference];
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, Link: ({ children }: any) => children, useRouter: () => mockRouter, useLocalSearchParams: () => ({}), useFocusEffect: (fn: () => void) => jest.requireActual('react').useEffect(fn, [fn]) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/appCache', () => ({ ...jest.requireActual('../src/lib/appCache'), getCacheUser: () => mockOwner, subscribeCacheUser: (fn: () => void) => { (mockListeners ??= new Set()).add(fn); return () => mockListeners.delete(fn); } }));
jest.mock('../src/lib/oddlingsAccountStore', () => ({ oddlingsStore: { read: async () => null, draft: async () => {}, save: async () => ({ ok: false }) } }));
jest.mock('../src/lib/oddlingsProjects', () => ({ createOddlingsProjects: () => mockEngine }));
jest.mock('../src/components/oddlings/OddlingFigure', () => ({ OddlingFigure: () => null }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => mockBalance }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalogCached: async (cb: any) => cb(mockCatalog), fetchCatalog: () => mockFetch() }));
jest.mock('../src/lib/chat', () => ({ ...jest.requireActual('../src/lib/chat'), chatApi: () => mockChat }));
jest.mock('../src/lib/network', () => ({ ...jest.requireActual('../src/lib/network'), ensureOnline: () => mockOnline() }));
jest.mock('../src/lib/creativeSourceHandoff', () => ({ ...jest.requireActual('../src/lib/creativeSourceHandoff'), stageCreativeSourceHandoff: jest.fn(() => 'opaque-token') }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: () => mockChooser(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: (...args: any[]) => mockUpload(...args), uploadMessage: () => 'Upload failed' }));
void [RN.View, RN.Text, RN.TextInput, RN.Pressable, RN.ScrollView, RN.Image, RN.ActivityIndicator];
let root: Root;
const event = { nativeEvent: {}, target: 1, currentTarget: 1 };
const text = (value: string) => root.container.queryAll(n => n.children.includes(value));
const button = (value: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && (n.props.accessibilityLabel?.startsWith(value) || n.queryAll(c => c.children.includes(value)).length))[0];
const press = async (value: string) => { await act(async () => { button(value).props.onClick(event); }); };
const note = () => root.container.queryAll(n => n.props.accessibilityLabel === t('oddlingsStudio.referencePlaceholder'))[0];
const previews = () => root.container.queryAll(n => n.props.source?.uri === 'file:///private.jpg');
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
async function switchAccount() { await act(async () => { mockOwner = 'B'; mockListeners.forEach(fn => fn()); }); }
const asset = { canceled: false, assets: [{ uri: 'file:///private.jpg', mimeType: 'image/jpeg', fileSize: 123, width: 10, height: 10 }] };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot(); mockOwner = 'A'; mockBalance = 5; mockCatalog = [portrait, reference];
    mockChooser.mockReset().mockResolvedValue(asset); mockUpload.mockReset().mockResolvedValue('uploads/private');
    mockFetch.mockReset().mockResolvedValue(mockCatalog); mockOnline.mockReset().mockResolvedValue(undefined);
    mockChat.listModels.mockReset().mockResolvedValue([{ id: 'chat-gpt-6-luna', gated: false }]);
    mockChat.createThread.mockReset().mockResolvedValue({ id: 'new-thread' }); mockChat.updateThread.mockReset().mockResolvedValue({});
});
afterEach(async () => { await act(async () => root.unmount()); });
async function renderBuilder() { await act(async () => root.render(<Builder />)); }
async function renderCard(onLeave = async () => {}) { await act(async () => root.render(<HandoffCard picks={{ oddling_name: 'Pip' }} scene="Stage" motionId="" onLeave={onLeave} />)); }
test('reference availability and credit display use catalog and balance', async () => {
    await renderBuilder(); expect(text(t('oddlingsStudio.optionalReference'))).toHaveLength(1);
    expect(root.container.queryAll(n => n.props.accessibilityLiveRegion === 'polite' && n.children.join('').includes('Not enough credits.')).length).toBe(1);
    mockBalance = null; mockCatalog = [portrait]; await act(async () => root.unmount()); root = createRoot(); await renderBuilder();
    expect(text(t('oddlingsStudio.optionalReference'))).toHaveLength(0);
    expect(root.container.queryAll(n => n.children.join('').includes('Not enough credits.'))).toHaveLength(0);
});
test('Refine creates, updates and replaces with a starter and no canon in the route', async () => {
    await renderBuilder(); await press(t('oddlingsStudio.refineChat'));
    expect(mockChat.createThread).toHaveBeenCalledWith('chat-gpt-6-luna');
    expect(parseOddlingInstructions(mockChat.updateThread.mock.calls[0][1].system_prompt)?.canon).toContain('LOCKED ODDLING PASSPORT');
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'new-thread', starter: t('oddlingsStudio.chatStarter') } });
});
test('completed references, rows and note are removed on account change', async () => {
    await renderBuilder(); await press('Choose image for Image'); await press(t('app.create.sources.image.add'));
    await act(async () => note().props.onChangeText('private note')); expect(previews().length).toBeGreaterThan(0);
    expect(button(t('app.create.sources.moveLater'))).toBeDefined();
    await switchAccount(); expect(previews()).toHaveLength(0); expect(note().props.value).toBe('');
    expect(button(t('app.create.sources.moveLater'))).toBeUndefined();
    await press(t('app.create.sources.image.add')); await press(t('oddlings.handoff.portrait'));
    expect(stageCreativeSourceHandoff).toHaveBeenLastCalledWith(expect.objectContaining({ references: [], modelId: 'flux-2-pro' }));
});
test('removing the last reference clears its note', async () => {
    await renderBuilder(); await press('Choose image for Image'); await act(async () => note().props.onChangeText('note'));
    await press('Remove Image'); expect(note().props.value).toBe('');
});
test('upload completion after the keyed remount cannot restore a photo or busy state', async () => {
    const upload = deferred<string>(); mockUpload.mockReturnValue(upload.promise);
    await renderBuilder(); await press('Choose image for Image');
    expect(button(t('oddlings.handoff.portrait')).props.accessibilityState.disabled).toBe(true);
    await switchAccount(); await act(async () => upload.resolve('uploads/private'));
    expect(previews()).toHaveLength(0); expect(button(t('oddlings.handoff.portrait')).props.accessibilityState.disabled).toBe(false);
    await press(t('oddlings.handoff.portrait'));
    expect(stageCreativeSourceHandoff).toHaveBeenLastCalledWith(expect.objectContaining({ references: [] }));
});
test('native chooser resolving across a keyed remount never starts an upload', async () => {
    const chooser = deferred<any>(); mockChooser.mockReturnValue(chooser.promise);
    await renderBuilder(); await press('Choose image for Image'); await switchAccount(); await act(async () => chooser.resolve(asset));
    expect(mockUpload).not.toHaveBeenCalled(); expect(previews()).toHaveLength(0);
});
test.each(['account', 'unmount'])('Refine catalog result after %s cannot create or navigate', async action => {
    const catalog = deferred<any>(); mockFetch.mockReturnValue(catalog.promise);
    await renderBuilder(); await press(t('oddlingsStudio.refineChat'));
    if (action === 'account') await switchAccount(); else await act(async () => root.unmount());
    await act(async () => catalog.resolve(mockCatalog));
    expect(mockChat.createThread).not.toHaveBeenCalled(); expect(mockChat.updateThread).not.toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled();
});
test('portrait cannot stage or navigate after an account switch during save', async () => {
    const leave = deferred<void>(); await renderCard(() => leave.promise); await press(t('oddlings.handoff.portrait'));
    await switchAccount(); await act(async () => leave.resolve());
    expect(stageCreativeSourceHandoff).not.toHaveBeenCalled(); expect(mockRouter.push).not.toHaveBeenCalled();
});
test('Refine failure uses the phone recovery copy', async () => {
    mockFetch.mockRejectedValue(Error('offline')); await renderBuilder(); await press(t('oddlingsStudio.refineChat'));
    expect(text(t('oddlingsStudio.chatHandoffFailed'))).toHaveLength(1); expect(mockRouter.replace).not.toHaveBeenCalled();
});
test.each(['online', 'leave', 'models', 'create', 'update'])('Refine drops account changes during %s', async step => {
    const wait = deferred<any>();
    if (step === 'online') mockOnline.mockReturnValue(wait.promise);
    if (step === 'models') mockChat.listModels.mockReturnValue(wait.promise);
    if (step === 'create') mockChat.createThread.mockReturnValue(wait.promise);
    if (step === 'update') mockChat.updateThread.mockReturnValue(wait.promise);
    await renderCard(step === 'leave' ? () => wait.promise : undefined); await press(t('oddlingsStudio.refineChat'));
    expect(text(t('oddlingsStudio.openingChat'))).toHaveLength(1);
    await switchAccount(); await act(async () => wait.resolve(step === 'models' ? [{ id: 'm' }] : { id: 'old-thread' }));
    expect(mockRouter.replace).not.toHaveBeenCalled();
    if (step !== 'update') expect(mockChat.updateThread).not.toHaveBeenCalled();
});
