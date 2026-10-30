import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import Create from '../src/app/(app)/create/[modelId]';
import { CreateResult, type ResultBatch } from '../src/components/create/CreateResult';
import { refreshBalance, soundPassFor } from '../src/lib/createResult';
import { createGenerationSubmit } from '../src/lib/generationSubmit';
import { readCreativeSourceHandoff } from '../src/lib/creativeSourceHandoff';
import * as balanceEvents from '../src/lib/balanceEvents';
import { ApiError, type ApiClient, type Balance } from '../src/lib/api';
import type { CatalogModel } from '../src/lib/media';
import { plural, t } from '../src/lib/i18n';
const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockPost = jest.fn(), mockFree = jest.fn(), mockJob = jest.fn(), mockAsset = jest.fn();
const mockApi = { stream: jest.fn(), getBalance: jest.fn(), request: jest.fn(async (path: string, init: any) => {
    if (path.endsWith('/free-allowance')) return mockFree();
    if (path.endsWith('/generations')) return mockPost(JSON.parse(init.body));
    if (path.endsWith('/asset')) return mockAsset();
    return mockJob();
}) };
let mockOwner = 'owner'; const mockSubscribers = new Set<() => void>();
let mockOptions: any;
const mockModel: CatalogModel = { id: 'm', name: 'Model', modality: 'text-to-image', credits: 10, durations: [], gated: false, capabilities: { inputs: { prompt: {} } } };
const mockSound: CatalogModel = { ...mockModel, id: 'mmaudio-v2-video', capabilities: { media: { video: { maxSeconds: 8 } } } };
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi }) }));
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({ modelId: 'm', prompt: 'words' }), useRouter: () => mockRouter, useFocusEffect: (cb: any) => require('react').useEffect(cb, [cb]) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockOwner, subscribeCacheUser: (cb: () => void) => { mockSubscribers.add(cb); return () => mockSubscribers.delete(cb); } }));
jest.mock('../src/lib/celebrate', () => ({ celebrateOutput: jest.fn(), afterCelebration: jest.fn(() => () => {}), noteLocalSubmission: jest.fn() }));
jest.mock('../src/lib/analytics/generations', () => ({ noteGenerationSubmitted: jest.fn(), noteGenerationFinished: jest.fn() }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: async () => {}, hasAgreed: async () => true } }));
jest.mock('../src/lib/media', () => ({ ...jest.requireActual('../src/lib/media'), fetchCatalog: async () => [mockModel, mockSound] }));
jest.mock('../src/lib/creatorProfileStore', () => ({ loadVibe: async () => null }));
jest.mock('../src/lib/createDraftStore', () => ({ clearDraft: async () => {}, loadDraft: async () => null, saveDraft: async () => {} }));
jest.mock('../src/lib/useBalance', () => ({ useBalance: () => {
    const React = require('react'); const [balance, setBalance] = React.useState(20);
    React.useEffect(() => require('../src/lib/balanceEvents').subscribeBalance((_owner: string, next: number) => setBalance(next)), []); return balance;
} }));
jest.mock('../src/components/KeyboardScreen', () => ({ KeyboardScreen: jest.requireActual('react-native').View }));
jest.mock('../src/components/KeyboardFormScrollView', () => ({ KeyboardFormScrollView: jest.requireActual('react-native').View }));
jest.mock('../src/components/CreateOptions', () => ({ CreateOptions: (props: any) => { mockOptions = props; return null; } }));
jest.mock('../src/components/CameraPanel', () => ({ CameraPanel: () => null }));
jest.mock('../src/components/CharacterPanel', () => ({ CharacterPanel: () => null }));
jest.mock('../src/components/SourcePicker', () => ({ SourcePicker: () => null }));
jest.mock('../src/components/AttachFromDevice', () => ({ AttachFromDevice: () => null }));
jest.mock('../src/components/InlineMedia', () => ({ InlineMedia: () => null }));
jest.mock('expo-image', () => ({ Image: jest.requireActual('react-native').Image }));
jest.mock('expo-crypto', () => { let count = 0; return { randomUUID: () => `key-${++count}` }; });
void [RN.View, RN.Text, RN.TextInput, RN.StyleSheet, RN.Pressable, RN.ScrollView, RN.ActivityIndicator];
let root: Root; let publication: jest.SpyInstance;
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const balance = (amount: number): Balance => ({ balance: amount, free_credits: 0, free_expires_at: null });
const controls = (label: string) => root.container.queryAll(n => n.props.accessibilityRole === 'button' && n.props.accessibilityLabel === label);
const text = (message: string) => root.container.queryAll(n => n.children.includes(message));
const generate = () => root.container.queryAll(n => n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel).startsWith(t('slip.generate')) || n.props.accessibilityRole === 'button' && String(n.props.accessibilityLabel).startsWith(t('opt.generateCount', { count: '2' })))[0];
async function click(control: any) { await act(async () => control.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
async function render() { await act(async () => root.render(<Create />)); }
async function count(n: number) { await act(async () => mockOptions.onChange({ ...mockOptions.values, count: n })); }
async function tick(ms: number) { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); }
const batch: ResultBatch = { ids: ['job'], count: 1, modelId: 'm', kind: 'image', aspect: null, duration: null };
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.useFakeTimers(); jest.clearAllMocks(); mockOwner = 'owner';
    mockPost.mockReset().mockResolvedValue({ job_id: 'job', balance_after: 999 });
    mockFree.mockReset().mockResolvedValue({ enabled: true, left: {} });
    mockJob.mockReset().mockResolvedValue({ state: 'queued', credits: 10, model_id: 'm', refunded: false });
    mockAsset.mockReset().mockResolvedValue({ url: 'https://asset', mime_type: 'image/png' });
    mockApi.getBalance.mockReset().mockResolvedValue(balance(20));
    publication = jest.spyOn(balanceEvents, 'publishBalance'); root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); publication.mockRestore(); jest.useRealTimers(); });
test('Generate stays in place, shows a tile and re-reads balance; New generation clears without POST', async () => {
    await render(); await click(generate()); expect(mockRouter.replace).not.toHaveBeenCalled(); expect(controls(t('publishReporting.open'))).toHaveLength(1);
    expect(mockApi.getBalance).toHaveBeenCalled(); expect(publication).toHaveBeenCalledWith('owner', 20); expect(publication).not.toHaveBeenCalledWith('owner', 999);
    await click(controls(t('libraryCreate.newNoCharge'))[0]); expect(mockPost).toHaveBeenCalledTimes(1); expect(controls(t('publishReporting.open'))).toHaveLength(0);
});
test('free allowance is refreshed after a run and Generate is disabled until the fresh answer', async () => {
    const fresh = deferred<any>(); mockFree.mockResolvedValueOnce({ enabled: true, left: { m: 1 } }).mockReturnValueOnce(fresh.promise);
    await render(); expect(text(t('create.workspace.generateFree')).length).toBeGreaterThan(0); await click(generate());
    await click(controls(t('libraryCreate.newNoCharge'))[0]); expect(generate().props.accessibilityState.disabled).toBe(true);
    expect(text(t('create.workspace.generate', { credits: '10' })).length).toBeGreaterThan(0);
    await act(async () => fresh.resolve({ enabled: true, left: {} })); expect(generate().props.accessibilityState.disabled).toBe(false);
});
test('partial 2x10 batch retries at most ten with the same keys and two deduplicated tiles; New uses fresh keys', async () => {
    mockPost.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(new ApiError(0, 'network')).mockResolvedValueOnce({ job_id: 'one' }).mockResolvedValueOnce({ job_id: 'two' });
    mockApi.getBalance.mockResolvedValue(balance(10)); await render(); await count(2); await click(generate());
    expect(text(t('libraryCreate.retryUpTo', { credits: '10' }))).toHaveLength(1); expect(generate().props.accessibilityState.disabled).toBe(false);
    expect(controls(t('publishReporting.open'))).toHaveLength(1); await click(generate()); expect(controls(t('publishReporting.open'))).toHaveLength(2);
    expect(mockPost.mock.calls[0][0].idempotency_key).toBe(mockPost.mock.calls[2][0].idempotency_key); expect(mockPost.mock.calls[1][0].idempotency_key).toBe(mockPost.mock.calls[3][0].idempotency_key);
    await click(controls(t('libraryCreate.newNoCharge'))[0]); await count(1); await click(generate()); expect(mockPost.mock.calls[4][0].idempotency_key).not.toBe(mockPost.mock.calls[0][0].idempotency_key);
});
test('editing the prompt after zero jobs start submits the new prompt with a fresh key', async () => {
    mockPost.mockRejectedValueOnce(new ApiError(0, 'network'));
    await render(); await click(generate());
    expect(controls(t('publishReporting.open'))).toHaveLength(0);
    const input = root.container.queryAll(node => node.props.accessibilityLabel === t('mobile.prompt'))[0];
    await act(async () => input.props.onChangeText('new prompt'));
    await click(generate());
    expect(mockPost.mock.calls.map(([request]) => request.inputs.prompt)).toEqual(['words', 'new prompt']);
    expect(mockPost.mock.calls[1][0].idempotency_key).not.toBe(mockPost.mock.calls[0][0].idempotency_key);
});
test('New generation is disabled during a partial retry; account switch drops late accepted jobs', async () => {
    mockPost.mockResolvedValueOnce({ job_id: 'one' }).mockRejectedValueOnce(new ApiError(0, 'network'));
    await render(); await count(2); await click(generate());
    const post = deferred<any>(); mockPost.mockReturnValueOnce(post.promise); await click(generate());
    expect(controls(t('libraryCreate.newNoCharge'))[0].props.accessibilityState.disabled).toBe(true);
    await act(async () => { mockOwner = 'other'; mockSubscribers.forEach(cb => cb()); });
    await act(async () => post.resolve({ job_id: 'late' })); expect(controls(t('publishReporting.open'))).toHaveLength(0); expect(publication.mock.calls.filter(([owner]) => owner === 'other')).toHaveLength(0);
});
test.each([[false, 3, 'failed'], [true, 3, 'paid'], [true, 0, 'free']] as const)('failed result uses confirmed refund metadata %s/%s', async (refunded, credits, wording) => {
    mockJob.mockResolvedValue({ state: 'failed', model_id: 'm', refunded, credits });
    await act(async () => root.render(<CreateResult api={mockApi as ApiClient} batch={batch} catalog={[]} onTerminal={jest.fn()} />));
    expect(text(wording === 'failed' ? t('library.status.failed') : wording === 'paid' ? plural('library.refunded', 3) : t('library.refundedFree'))).toHaveLength(1);
    if (!refunded) expect(text(plural('library.refunded', 3))).toHaveLength(0);
});
test('delayed refund changes wording and refreshes an exhausted balance', async () => {
    mockJob.mockResolvedValue({ state: 'failed', model_id: 'm', refunded: false, credits: 10 }); mockApi.getBalance.mockResolvedValue(balance(0));
    await render(); await click(generate());
    expect(text(t('library.status.failed'))).toHaveLength(1);
    mockJob.mockResolvedValue({ state: 'failed', model_id: 'm', refunded: true, credits: 10 }); mockApi.getBalance.mockResolvedValue(balance(10));
    await tick(5000); expect(text(plural('library.refunded', 10))).toHaveLength(1); expect(publication).toHaveBeenLastCalledWith('owner', 10);
    await click(controls(t('libraryCreate.newNoCharge'))[0]); expect(generate().props.accessibilityState.disabled).toBe(false);
});
test('overlapping balance reads publish only the newest; account and batch changes reject pending reads', async () => {
    const first = deferred<Balance>(), second = deferred<Balance>(); const seq = { current: 0 };
    mockApi.getBalance.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const old = refreshBalance(mockApi as ApiClient, 'owner', () => true, seq), recent = refreshBalance(mockApi as ApiClient, 'owner', () => true, seq);
    second.resolve(balance(17)); await recent; first.resolve(balance(0)); await old; expect(publication.mock.calls).toEqual([['owner', 17]]);
    const switched = deferred<Balance>(); mockApi.getBalance.mockReturnValueOnce(switched.promise); const read = refreshBalance(mockApi as ApiClient, 'owner', () => true, seq); mockOwner = 'other'; switched.resolve(balance(100)); await read;
    await refreshBalance(mockApi as ApiClient, 'other', () => false, seq); expect(publication).toHaveBeenCalledTimes(1);
});
test('onJob returns each accepted id/index while onStarted retains its count-only contract', async () => {
    mockPost.mockResolvedValueOnce({ job_id: 'one' }).mockResolvedValueOnce({ job_id: 'two' }); const onJob = jest.fn(), onStarted = jest.fn();
    await createGenerationSubmit().run(mockApi as ApiClient, { modelId: 'm', prompt: 'words', durationSeconds: null, confirmedCredits: 10 }, 2, onStarted, onJob);
    expect(onStarted.mock.calls).toEqual([[1], [2]]); expect(onJob.mock.calls).toEqual([['one', 0], ['two', 1]]);
});
test('sound eligibility uses live catalog and the source limit; action stages an asset reference without rights', async () => {
    const result = { state: 'succeeded' as const, asset: { url: 'url', mime_type: 'video/mp4' } };
    const input = { catalog: [mockSound], modelId: 'm', durationSeconds: 5, result };
    expect(soundPassFor(input)).toEqual({ kind: 'eligible' }); expect(soundPassFor({ ...input, durationSeconds: 10 })).toEqual({ kind: 'tooLong', seconds: 8 });
    expect(soundPassFor({ ...input, catalog: [] })).toBeNull(); expect(soundPassFor({ ...input, modelId: mockSound.id })).toBeNull();
    mockJob.mockResolvedValue({ state: 'succeeded', model_id: 'm', credits: 10 }); mockAsset.mockResolvedValue(result.asset);
    await act(async () => root.render(<CreateResult api={mockApi as ApiClient} batch={{ ...batch, kind: 'video', duration: 5 }} catalog={[mockSound]} onTerminal={jest.fn()} />));
    await click(controls(t('libraryCreate.soundAction'))[0]); const params = mockRouter.push.mock.calls[0][0].params;
    expect(readCreativeSourceHandoff(params.sourceHandoff, params.recipe, params.modelId)).toMatchObject({ references: [{ slot: 'video', origin: 'asset', asset_id: 'job' }], rightsConfirmed: false });
});
