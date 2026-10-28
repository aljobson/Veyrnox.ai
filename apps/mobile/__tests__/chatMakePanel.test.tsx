import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import * as ImagePicker from 'expo-image-picker';
import { MakePanel } from '../src/components/chat/MakePanel';
import { ApiError } from '../src/lib/api';
import { plural, t } from '../src/lib/i18n';
import { fetchCatalog, type CatalogModel } from '../src/lib/media';
import { uploadSource } from '../src/lib/uploads';
import { publishBalance } from '../src/lib/balanceEvents';
import { fetchFreeAllowance } from '../src/lib/freeAllowance';
import { getCacheUser } from '../src/lib/appCache';
const mockRouter = { push: jest.fn() }, mockApi = { getBalance: jest.fn() }, mockCreate = jest.fn(), mockClose = jest.fn();
const mockGetJob = jest.fn(), mockGetAsset = jest.fn();
let mockBalance = 100, mockOwner = 'owner', mockUUID = 0;
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockUUID}` }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: () => null }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: ({ onPick }: any) => {
    const { Button } = jest.requireActual('../src/components/ui');
    return <Button label="Pick test asset" onPress={() => onPick({ jobId: 'asset', name: 'Lake' })} />;
} }));
jest.mock('../src/lib/uploads', () => ({ uploadSource: jest.fn(), uploadMessage: () => 'upload error' }));
jest.mock('../src/lib/freeAllowance', () => ({ fetchFreeAllowance: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: jest.fn(() => mockOwner), subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => mockBalance }));
jest.mock('../src/lib/balanceEvents', () => ({ publishBalance: jest.fn((_owner, value) => { mockBalance = value; }) }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('../src/lib/media', () => ({
    ...jest.requireActual('../src/lib/media'), fetchCatalog: jest.fn(),
    mediaApi: () => ({ createGeneration: mockCreate, getJob: mockGetJob, getAsset: mockGetAsset }),
}));
void [RN.View, RN.Text, RN.Pressable, RN.ScrollView, RN.Modal, RN.TextInput, RN.Image];
const model: CatalogModel = { id: 'image', name: 'Image', modality: 'text-to-image', credits: 2, gated: false, durations: [], capabilities: { inputs: { prompt: { max: 2000 }, aspect_ratio: { values: ['1:1', '16:9'] }, num_images: {} }, media: {} } };
let root: Root;
const control = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
const press = async (label: string) => { await act(async () => control(label).props.onClick({ nativeEvent: {} })); };
const hasText = (text: string) => root.container.queryAll(n => n.children.includes(text)).length > 0;
const disabled = (label: string) => control(label).props.accessibilityState.disabled;
const paid = (n = 2) => plural('chat.make.buttonLabel', n);
const deferred = <T,>() => { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const render = async (visible = true) => { await act(async () => root.render(<MakePanel visible={visible} initialPrompt="A quiet lake" onClose={mockClose} />)); };
const reopen = async () => { await render(false); await render(); };
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks();
    mockBalance = 100; mockOwner = 'owner'; mockUUID = 0;
    mockCreate.mockReset().mockImplementation(async () => ({ job_id: `job-${mockCreate.mock.calls.length}` }));
    mockGetJob.mockReset().mockResolvedValue({ state: 'succeeded' }); mockGetAsset.mockReset().mockResolvedValue({ url: 'https://test/image', mime_type: 'image/png' });
    mockApi.getBalance.mockReset().mockResolvedValue({ balance: 100 });
    jest.mocked(fetchFreeAllowance).mockReset().mockResolvedValue({});
    jest.mocked(fetchCatalog).mockResolvedValue([model]);
    jest.mocked(getCacheUser).mockImplementation(() => mockOwner);
    root = createRoot(); await render();
});
afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });

test.each(['insufficient_balance', 'insufficient_credits'])('Make refusal %s offers native top-up and preserves the prompt', async code => {
    expect(control(t('lowBalance.buy'))).toBeUndefined();
    mockCreate.mockRejectedValueOnce(new ApiError(402, code)); await press(paid());
    expect(root.container.queryAll(n => n.children.includes(t('chat.make.err.credits')))).toHaveLength(1);
    await press(t('lowBalance.buy')); expect(mockClose).toHaveBeenCalledTimes(1); expect(mockRouter.push).toHaveBeenCalledWith('/credits');
    mockCreate.mockRejectedValueOnce(new ApiError(429, 'rate_limited')); await press(paid());
    expect(root.container.queryAll(n => n.children.includes(t('chat.make.err.rate')))).toHaveLength(1);
    expect(control(t('lowBalance.buy'))).toBeUndefined();
    expect(mockCreate.mock.calls[1][0].prompt).toBe('A quiet lake');
});
test('Create controls submit three distinct keys and the catalog unit price', async () => {
    expect(control('1:1')).toBeDefined(); await press('16:9'); await press('3'); await press(paid(6));
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(new Set(mockCreate.mock.calls.map(([r]) => r.idempotencyKey)).size).toBe(3);
    for (const [r] of mockCreate.mock.calls) expect(r).toMatchObject({ confirmedCredits: 2, extraInputs: { aspect_ratio: '16:9' } });
    expect(mockRouter.push).not.toHaveBeenCalled();
});
test('low balance disables a new purchase and offers credits', async () => {
    mockBalance = 1; await render(); expect(disabled(paid())).toBe(true);
    expect(hasText(plural('create.short', 1, { have: '1', need: '2' }))).toBe(true);
    await press(t('lowBalance.buy')); expect(mockRouter.push).toHaveBeenCalledWith('/credits');
});
test('free allowance is invalidated at submit until the owned refresh returns', async () => {
    jest.mocked(fetchFreeAllowance).mockResolvedValueOnce({ image: 1 }); await reopen();
    expect(hasText(t('create.workspace.generateFree'))).toBe(true);
    const refresh = deferred<Record<string, number>>(); jest.mocked(fetchFreeAllowance).mockReturnValueOnce(refresh.promise);
    await press(t('opt.costFree'));
    expect(hasText(t('create.workspace.generateFree'))).toBe(false); expect(control(paid())).toBeDefined();
    expect(mockApi.getBalance).toHaveBeenCalledTimes(1); expect(publishBalance).toHaveBeenCalledWith('owner', 100);
    await act(async () => refresh.resolve({})); await press(paid());
    expect(mockCreate.mock.calls[1][0].confirmedCredits).toBe(2);
    expect(mockApi.getBalance).toHaveBeenCalledTimes(2); expect(publishBalance).toHaveBeenCalledTimes(2);
});
test('a failed allowance refresh keeps the paid estimate', async () => {
    jest.mocked(fetchFreeAllowance).mockResolvedValueOnce({ image: 1 }); await reopen();
    jest.mocked(fetchFreeAllowance).mockRejectedValueOnce(new Error('offline'));
    await press(t('opt.costFree')); expect(control(paid())).toBeDefined();
});
test('only the newest balance read in a retry batch publishes', async () => {
    const older = deferred<{ balance: number }>(), newer = deferred<{ balance: number }>();
    mockCreate.mockRejectedValue(new ApiError(0, 'network'));
    mockApi.getBalance.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await press(paid()); await press(paid());
    await act(async () => newer.resolve({ balance: 4 })); await act(async () => older.resolve({ balance: 6 }));
    expect(publishBalance).toHaveBeenCalledTimes(1); expect(publishBalance).toHaveBeenCalledWith('owner', 4);
});
test('balance and allowance answers cannot cross accounts', async () => {
    const balance = deferred<{ balance: number }>(), free = deferred<Record<string, number>>();
    mockApi.getBalance.mockReturnValueOnce(balance.promise); jest.mocked(fetchFreeAllowance).mockReturnValueOnce(free.promise);
    await press(paid()); mockOwner = 'other';
    await act(async () => { balance.resolve({ balance: 6 }); free.resolve({ image: 10 }); });
    expect(publishBalance).not.toHaveBeenCalled(); expect(control(paid())).toBeDefined();
});
test('partial batches retry below the original total with the original keys', async () => {
    mockBalance = 6; mockApi.getBalance.mockResolvedValue({ balance: 4 });
    mockCreate.mockResolvedValueOnce({ job_id: 'first' }).mockRejectedValueOnce(new ApiError(402, 'insufficient_balance'));
    await press('3'); await press(paid(6));
    const firstKeys = mockCreate.mock.calls.map(([r]) => r.idempotencyKey);
    expect(disabled(paid(4))).toBe(false); expect(hasText(plural('chat.make.buttonPrice', 4))).toBe(true);
    expect(disabled(t('job.next.makeAnother'))).toBe(true);
    await press(paid(4)); expect(mockCreate.mock.calls.slice(2, 4).map(([r]) => r.idempotencyKey)).toEqual(firstKeys);
    expect(mockUUID).toBe(3);
});
test('a lost response retries its existing key even at zero balance', async () => {
    mockCreate.mockRejectedValueOnce(new ApiError(0, 'network')); mockApi.getBalance.mockResolvedValue({ balance: 0 });
    await press(paid()); expect(disabled(paid())).toBe(false); await press(paid());
    expect(mockCreate.mock.calls[1][0].idempotencyKey).toBe(mockCreate.mock.calls[0][0].idempotencyKey);
});
test('a deferred partial batch cannot be reset before or after an ambiguous failure', async () => {
    const second = deferred<{ job_id: string }>();
    mockCreate.mockResolvedValueOnce({ job_id: 'first' }).mockReturnValueOnce(second.promise);
    await press('3'); await press(paid(6));
    expect(disabled(t('job.next.makeAnother'))).toBe(true); expect(disabled(paid(6))).toBe(true);
    expect(control(t('chat.make.kind.video')).props.accessibilityState.disabled).toBe(true);
    await act(async () => second.reject(new ApiError(0, 'network')));
    expect(disabled(t('job.next.makeAnother'))).toBe(true);
    expect(hasText(t('opt.startedUnknown', { started: '1', count: '3', next: '2' }))).toBe(true);
    await press(paid(4)); expect(mockUUID).toBe(3);
});
test('running results become inline images, and Open alone navigates to the job', async () => {
    jest.useFakeTimers(); mockGetJob.mockResolvedValueOnce({ state: 'running' }).mockResolvedValue({ state: 'succeeded' });
    await press(paid()); expect(hasText(t('job.running'))).toBe(true); expect(hasText(t('job.keepsRunning'))).toBe(true);
    expect(mockRouter.push).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(3000); });
    expect(hasText(t('job.succeeded'))).toBe(true); expect(control(t('job.title')).props.source).toMatchObject({ uri: 'https://test/image' });
    await press(`${t('chatDepth.wfOpen')}: ${t('job.title')}`);
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/job/[id]', params: { id: 'job-1' } });
});
test('unmount aborts polling without another getJob call', async () => {
    jest.useFakeTimers(); mockGetJob.mockResolvedValue({ state: 'running' }); await press(paid());
    await act(async () => root.unmount()); const calls = mockGetJob.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(3000); }); expect(mockGetJob).toHaveBeenCalledTimes(calls);
    root = createRoot();
});
test('close drops a late onJob from the superseded batch without losing its key', async () => {
    const create = deferred<{ job_id: string }>(); mockCreate.mockReturnValueOnce(create.promise);
    await press(paid()); await press(t('chat.make.close')); await reopen();
    await act(async () => create.resolve({ job_id: 'late' }));
    expect(mockGetJob).not.toHaveBeenCalled(); expect(hasText(t('job.succeeded'))).toBe(false);
});
test('Make another clears results while preserving words and options; stale assets cannot return', async () => {
    const asset = deferred<{ url: string; mime_type: string }>(); mockGetAsset.mockReturnValueOnce(asset.promise);
    await press('16:9'); await press(paid()); await press(t('job.next.makeAnother'));
    await act(async () => asset.resolve({ url: 'https://test/late', mime_type: 'image/png' }));
    expect(control(t('job.title'))).toBeUndefined(); expect(control('16:9').props.accessibilityState.selected).toBe(true);
    await press(paid()); expect(mockCreate.mock.calls[1][0].prompt).toBe('A quiet lake');
});
const sourceModels = async () => {
    await act(async () => root.unmount()); root = createRoot();
    jest.mocked(fetchCatalog).mockResolvedValue(['A', 'B'].map(id => ({ ...model, id, name: id, capabilities: { ...model.capabilities, media: { image: { required: true } } } })));
    await render();
};
const chooseImage = () => t('sourcePicker.choosefor', { value1: 'image', value2: t('sources.image') });
const library = () => t('libsrc.chooseLabel', { kind: 'image', slot: t('sources.image') });
test('required source Library selection needs explicit rights and sends asset references', async () => {
    await sourceModels(); expect(disabled(paid())).toBe(true); expect(control(library())).toBeDefined();
    await press(library()); await press('Pick test asset'); expect(disabled(paid())).toBe(true);
    await press(t('form.sourceRights')); expect(disabled(paid())).toBe(false); await press(paid());
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ references: [{ slot: 'image', origin: 'asset', asset_id: 'asset' }], sourceRights: true });
});
test('model changes remount source rows and reset rights and options', async () => {
    await sourceModels(); await press(library()); await press('Pick test asset'); await press(t('form.sourceRights')); await press('3');
    await press(`B, ${plural('chat.make.from', 2)}`);
    expect(control(chooseImage())).toBeDefined(); expect(control(t('form.sourceRights'))).toBeUndefined(); expect(disabled(paid())).toBe(true);
    expect(control('1').props.accessibilityState.selected).toBe(true);
});
test('an upload finishing after a model switch cannot fill the new slot', async () => {
    await sourceModels(); const upload = deferred<string>();
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///test.jpg', mimeType: 'image/jpeg', fileSize: 100, width: 1, height: 1 }] });
    jest.mocked(uploadSource).mockReturnValueOnce(upload.promise);
    await press(chooseImage()); await press(`B, ${plural('chat.make.from', 2)}`);
    await act(async () => upload.resolve('uploads/late'));
    expect(control(chooseImage())).toBeDefined(); expect(control(t('form.sourceRights'))).toBeUndefined(); expect(disabled(paid())).toBe(true);
});
test('reopening the same model restores its first aspect and clears results', async () => {
    await press('16:9'); await press(paid()); await reopen();
    expect(control('1:1').props.accessibilityState.selected).toBe(true);
    expect(hasText(t('job.succeeded'))).toBe(false);
});
test('closing a pending partial run retains retry pricing and keys on reopening', async () => {
    const second = deferred<{ job_id: string }>();
    mockCreate.mockResolvedValueOnce({ job_id: 'first' }).mockReturnValueOnce(second.promise);
    await press('3'); await press(paid(6)); await press(t('chat.make.close')); await reopen();
    mockBalance = 0;
    await act(async () => second.reject(new ApiError(0, 'network')));
    await press('3'); expect(disabled(paid(4))).toBe(false); await press(paid(4));
    expect(mockUUID).toBe(3);
    expect(mockCreate.mock.calls[2][0].idempotencyKey).toBe(mockCreate.mock.calls[0][0].idempotencyKey);
    expect(mockCreate.mock.calls[3][0].idempotencyKey).toBe(mockCreate.mock.calls[1][0].idempotencyKey);
});
test('a retry succeeding while closed clears retained retry pricing before a new purchase', async () => {
    mockCreate.mockResolvedValueOnce({ job_id: 'first' }).mockRejectedValueOnce(new ApiError(0, 'network'));
    await press('3'); await press(paid(6));
    const retry = deferred<{ job_id: string }>(); mockCreate.mockReturnValueOnce(retry.promise);
    await press(paid(4)); await press(t('chat.make.close'));
    await act(async () => retry.resolve({ job_id: 'first' })); await reopen(); await press('3');
    expect(control(paid(6))).toBeDefined(); expect(control(paid(4))).toBeUndefined();
});
test('asset failure degrades to status and Library navigation remains explicit', async () => {
    mockGetAsset.mockRejectedValueOnce(new Error('expired')); await press(paid());
    expect(hasText(t('job.succeeded'))).toBe(true); expect(control(t('job.title'))).toBeUndefined();
    await press(t('faceFilters.openLibrary')); expect(mockClose).toHaveBeenCalledTimes(1); expect(mockRouter.push).toHaveBeenCalledWith('/library');
});
test('video output choices and duration use catalog defaults and the shared settings request', async () => {
    await act(async () => root.unmount()); root = createRoot();
    jest.mocked(fetchCatalog).mockResolvedValue([{ ...model, id: 'video', name: 'Video', modality: 'text-to-video', durations: [5, 10],
        capabilities: { inputs: { prompt: {}, output_resolution: { values: ['720p', '1080p'] }, audio_enabled: { values: [true, false] } } } }]);
    await render(); await press(t('chat.make.kind.video'));
    expect(control('720p').props.accessibilityState.selected).toBe(true);
    expect(control(t('opt.audioOn')).props.accessibilityState.selected).toBe(true);
    await press('1080p'); await press(t('opt.audioOff')); await press(t('chat.make.seconds', { n: '10' })); await press(paid(4));
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ confirmedCredits: 4, durationSeconds: 10, extraInputs: { output_resolution: '1080p', audio_enabled: false } });
});
test('the latest allowance refresh wins across retries', async () => {
    const older = deferred<Record<string, number>>(), newer = deferred<Record<string, number>>();
    mockCreate.mockRejectedValue(new ApiError(0, 'network'));
    jest.mocked(fetchFreeAllowance).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await press(paid()); await press(paid());
    await act(async () => newer.resolve({})); await act(async () => older.resolve({ image: 1 }));
    expect(control(paid())).toBeDefined(); expect(hasText(t('create.workspace.generateFree'))).toBe(false);
});
