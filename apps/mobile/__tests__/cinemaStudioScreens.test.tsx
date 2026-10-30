import type { ReactElement } from 'react';
let mockSlots: any[] = [], mockCursor = 0, mockLive = true;
let mockParams: Record<string, string | undefined> = {};
const mockEffects: Array<() => void | (() => void)> = [];
const mockRequest = jest.fn(), mockStream = jest.fn(), mockRead = jest.fn(), mockRunning = jest.fn();
let mockKey = 0;
const ID = '11111111-1111-4111-8111-111111111111', CHILD = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
jest.mock('react', () => ({
    ...jest.requireActual('react'),
    useState: (initial: any) => { const i = mockCursor++; if (!(i in mockSlots)) mockSlots[i] = typeof initial === 'function' ? initial() : initial; return [mockSlots[i], (next: any) => { mockSlots[i] = typeof next === 'function' ? next(mockSlots[i]) : next; }]; },
    useRef: (initial: any) => { const i = mockCursor++; if (!(i in mockSlots)) mockSlots[i] = { current: initial }; return mockSlots[i]; },
    useEffect: (effect: () => void, deps: any[]) => { const i = mockCursor++, previous = mockSlots[i]; if (!previous || deps?.some((d, j) => d !== previous[j])) mockEffects.push(effect); mockSlots[i] = deps ?? []; },
    useCallback: (fn: any) => fn,
    useSyncExternalStore: (_subscribe: any, get: any) => get(),
}));
jest.mock('react-native', () => ({ Text: 'Text', View: 'View', ScrollView: 'ScrollView', TextInput: 'TextInput', Pressable: 'Pressable',
    StyleSheet: { create: (x: any) => x }, Alert: { alert: jest.fn() }, AccessibilityInfo: { announceForAccessibility: jest.fn() },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) }, Linking: { openURL: jest.fn() },
}));
jest.mock('expo-router', () => ({ Link: 'Link', Stack: { Screen: 'Screen' }, router: { push: jest.fn(), replace: jest.fn(), setParams: jest.fn() },
    useLocalSearchParams: () => mockParams, useFocusEffect: (fn: any) => require('react').useEffect(fn, []),
}));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: async () => null }));
jest.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => `key-${++mockKey}` }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: { request: mockRequest, stream: mockStream } }) }));
jest.mock('../src/components/cinema/creator/RulesLinks', () => ({
    ...jest.requireActual('../src/components/cinema/creator/RulesLinks'),
    useCreatorOwner: () => 'owner', useCreatorScope: () => ({ ticket: 'ticket', live: () => mockLive }), RulesLinks: () => null,
}));
jest.mock('../src/components/ui/Button', () => ({ Button: 'Button' }));
jest.mock('../src/components/ui/Text', () => ({ Text: 'Text' }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => undefined }));
jest.mock('../src/lib/cinemaUploadStore', () => ({ cinemaUploadStore: {
    subscribe: () => () => undefined, running: () => mockRunning(), runningHref: () => ({ pathname: '/cinema/creator/[id]', params: { id: mockRunning() } }), live: () => mockLive, read: (...a: any[]) => mockRead(...a),
    reconcileStaged: async () => undefined, verify: async () => true, clear: async () => undefined,
} }));
jest.mock('../src/lib/cinemaUpload', () => ({ ...jest.requireActual('../src/lib/cinemaUpload'), CINEMA_DEVICE_UPLOAD_ENABLED: true }));
jest.mock('../src/components/cinema/creator/UploadPanel', () => ({ UploadPanel: 'UploadPanel' }));
jest.mock('../src/components/cinema/creator/SubmitPanel', () => ({ SubmitPanel: 'SubmitPanel' }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: 'LibraryChooser' }));
jest.mock('../src/components/cinema/CategoryChips', () => ({ CategoryChips: 'CategoryChips' }));
jest.mock('../src/components/cinema/CinemaFeed', () => ({ CinemaFeed: 'CinemaFeed' }));
jest.mock('../src/components/cinema/ContinueWatching', () => ({ ContinueWatching: 'ContinueWatching' }));
jest.mock('../src/components/cinema/CinemaProfile', () => ({ CinemaProfile: 'CinemaProfile' }));
jest.mock('../src/components/cinema/DiscoveryList', () => ({ DiscoveryList: 'DiscoveryList' }));
jest.mock('../src/components/cinema/SavedList', () => ({ SavedList: 'SavedList' }));
jest.mock('../src/components/cinema/WinnersList', () => ({ WinnersList: 'WinnersList' }));
import CreatorIndex from '../src/app/(app)/cinema/creator/index';
import CreatorDetail from '../src/app/(app)/cinema/creator/[id]';
import CreatorDraft from '../src/app/(app)/cinema/creator/draft';
import Cinema from '../src/app/(app)/cinema/index';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import { ApiError } from '../src/lib/api';
import { t } from '../src/lib/i18n';
const UploadPanel = (props: any) => jest.requireActual('../src/components/cinema/creator/UploadPanel').UploadPanel(props);
type Node = { type: any; props: any; children: Node[] };
function expand(e: any): Node | null {
    if (e == null || typeof e === 'boolean') return null;
    if (typeof e === 'string' || typeof e === 'number') return { type: '#text', props: { text: String(e) }, children: [] };
    if (typeof e.type === 'function') return expand(e.type(e.props));
    return { type: e.type, props: e.props, children: [e.props.children].flat(Infinity).map(expand).filter(Boolean) as Node[] };
}
const render = (component: () => ReactElement) => { mockCursor = 0; return expand(component())!; };
const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];
const words = (node: Node) => all(node).filter(n => n.type === '#text').map(n => n.props.text).join(' ');
const control = (node: Node, label: string) => all(node).find(n => n.props.accessibilityLabel === label)!;
const byType = (node: Node, type: string) => all(node).filter(n => n.type === type);
const settle = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const effects = async () => { mockEffects.splice(0).forEach(f => f()); await settle(); };
const mount = async (component: () => ReactElement) => { render(component); await effects(); return () => render(component); };
const row = (content_type: string, extra = {}) => ({ id: ID, title: 'My title', content_type, lifecycle_status: 'DRAFT', video_ready: false, revision: 2, categories: [], ai_disclosures: [], synopsis: '', language: 'en', ...extra });
const write = () => mockRequest.mock.calls.filter(([, init]) => init?.method);
const confirm = () => (Alert.alert as jest.Mock).mock.calls.at(-1)[2].find((b: any) => b.style === 'destructive').onPress();
beforeEach(() => { require('../src/lib/cinemaUpload').CINEMA_DEVICE_UPLOAD_ENABLED = true; mockSlots = []; mockCursor = 0; mockEffects.length = 0; mockLive = true; mockParams = {}; jest.clearAllMocks(); mockRequest.mockReset(); mockStream.mockReset(); mockRead.mockResolvedValue(null); mockRunning.mockReturnValue(null); });
test('SERIES list has an open Action and no ComingToApp; flag-off makes no request', async () => {
    expect(require('../src/lib/cinemaUpload').CINEMA_DEVICE_UPLOAD_ENABLED).toBe(true);
    expect(require('../src/components/cinema/creator/RulesLinks').useCreatorOwner()).toBe('owner');
    mockRequest.mockResolvedValue({ content: [row('SERIES')] }); const tree = await mount(CreatorIndex);
    expect(control(tree(), 'My title')).toBeDefined(); expect(words(tree())).not.toContain(t('common.comingToApp'));
    require('../src/lib/cinemaUpload').CINEMA_DEVICE_UPLOAD_ENABLED = false; mockRequest.mockClear(); render(CreatorIndex); await effects(); expect(mockRequest).not.toHaveBeenCalled();
});
test('series lists seasons, opens and creates children, edits root and submits without a video', async () => {
    mockParams = { id: ID }; mockRequest.mockResolvedValueOnce({ content: [row('SERIES')] }).mockResolvedValueOnce({ content: [row('SEASON', { id: CHILD, position: 1, title: 'Season title' })] });
    const tree = await mount(CreatorDetail);
    expect(mockRequest.mock.calls.map(([p]) => p)).toEqual(['/api/v1/cinema/content', `/api/v1/cinema/content?parent_id=${ID}`]);
    expect(words(tree())).toContain('Season 1'); control(tree(), 'Season title').props.onPress(); expect(router.push).toHaveBeenLastCalledWith({ pathname: '/cinema/creator/[id]', params: { id: CHILD, parent: ID } });
    control(tree(), 'New Season').props.onPress(); expect(router.push).toHaveBeenLastCalledWith({ pathname: '/cinema/creator/draft', params: { parent: ID, parentType: 'SERIES' } });
    control(tree(), t('cinemaUpload.edit')).props.onPress(); expect(router.push).toHaveBeenLastCalledWith({ pathname: '/cinema/creator/draft', params: { id: ID } });
    expect(byType(tree(), 'UploadPanel')).toHaveLength(0); expect(byType(tree(), 'SubmitPanel')).toHaveLength(1);
});
test.each([['SEASON', 'SERIES'], ['EPISODE', 'SEASON']])('child %s loads parent and edits with immutable structure', async (type, parentType) => {
    mockParams = { id: CHILD, parent: ID }; mockRequest.mockResolvedValueOnce({ content: [row(type, { id: CHILD, position: 7 })] }).mockResolvedValue({ content: [] });
    const tree = await mount(CreatorDetail); expect(mockRequest).toHaveBeenCalledWith(`/api/v1/cinema/content?parent_id=${ID}`);
    control(tree(), t('cinemaUpload.edit')).props.onPress(); expect(router.push).toHaveBeenLastCalledWith({ pathname: '/cinema/creator/draft', params: { id: CHILD, parent: ID, parentType } });
    if (type === 'EPISODE') expect(byType(tree(), 'UploadPanel')[0].props.editable).toBe(true);
    expect(byType(tree(), 'SubmitPanel')).toHaveLength(0);
});
test.each([CreatorDetail, CreatorDraft])('invalid parent closes before requesting', async Route => {
    mockParams = { id: CHILD, parent: 'bad', parentType: 'SERIES' }; const tree = await mount(Route);
    expect(words(tree())).toContain(t('cinemaUpload.closed')); expect(mockRequest).not.toHaveBeenCalled();
});
test('invalid parent type closes without requesting', async () => {
    mockParams = { parent: ID, parentType: 'FILM' }; await mount(CreatorDraft); expect(mockRequest).not.toHaveBeenCalled();
});
test('new season defaults to max+1, hides categories, posts child body and explains a collision', async () => {
    mockParams = { parent: ID, parentType: 'SERIES' }; mockRequest.mockResolvedValueOnce({ content: [{ position: 3 }, { position: 1 }] }).mockRejectedValue(new ApiError(409, 'position_taken'));
    const tree = await mount(CreatorDraft); expect(words(tree())).not.toContain(t('cinemaUpload.categories'));
    expect(control(tree(), 'Season number').props.value).toBe('4'); control(tree(), t('cinemaUpload.title')).props.onChangeText('Season title');
    control(tree(), t('cinemaUpload.save')).props.onPress(); await settle();
    expect(JSON.parse(write()[0][1].body)).toEqual({ content_type: 'SEASON', parent_id: ID, position: 4, title: 'Season title', synopsis: '', language: 'en', ai_disclosures: [] });
    expect(words(tree())).toContain(t('cinema.creatorWorkspace.thatNumberIsAlreadyInUse'));
});
test.each([['SEASON', 'SERIES'], ['EPISODE', 'SEASON']])('edit %s hides number and PATCH preserves position', async (type, parentType) => {
    mockParams = { id: CHILD, parent: ID, parentType }; mockRequest.mockResolvedValueOnce({ content: [row(type, { id: CHILD, position: 7 })] }).mockResolvedValue({ id: CHILD });
    const tree = await mount(CreatorDraft); expect(control(tree(), `${t(`cinema.type.${type}`)} number`)).toBeUndefined();
    control(tree(), t('cinemaUpload.save')).props.onPress(); await settle();
    expect(write()[0][1].method).toBe('PATCH'); expect(JSON.parse(write()[0][1].body)).toMatchObject({ parent_id: ID, position: 7, id: CHILD, revision: 2 });
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/cinema/creator/[id]', params: { id: CHILD, parent: ID } });
});
test('withdrawal confirms title, blocks invalid reason and double submit, then reports success', async () => {
    mockParams = { id: ID }; mockRequest.mockResolvedValueOnce({ content: [row('FILM', { lifecycle_status: 'PUBLISHED' })] }).mockResolvedValueOnce({ unlocks_reversed: 9 }).mockResolvedValue({ content: [row('FILM')] });
    const tree = await mount(CreatorDetail), label = t('cinema.creatorWorkspace.withdrawFromCinema');
    control(tree(), t('cinema.creatorWorkspace.reasonKeptInTheAuditRecord')).props.onChangeText('ab'); expect(control(tree(), label).props.disabled).toBe(true);
    control(tree(), t('cinema.creatorWorkspace.reasonKeptInTheAuditRecord')).props.onChangeText('  My reason  ');
    control(tree(), label).props.onPress(); expect(write()).toHaveLength(0); expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('My title');
    expect((Alert.alert as jest.Mock).mock.calls[0][2][0].text).toBe(t('cinema.creatorWorkspace.cancel'));
    confirm(); confirm(); await settle(); expect(write()).toHaveLength(1);
    expect(write()[0][0]).toBe('/api/v1/cinema/content/withdraw'); expect(JSON.parse(write()[0][1].body)).toEqual({ content_id: ID, reason: 'My reason' });
    expect(write()[0][1].headers['Idempotency-Key']).toBeTruthy(); expect(words(tree())).toContain(t('cinema.creatorWorkspace.withdrawnItIsAPrivateDraft'));
});
test('publishing_not_open hides withdrawal card', async () => {
    mockParams = { id: ID }; mockRequest.mockResolvedValueOnce({ content: [row('FILM', { lifecycle_status: 'UNDER_REVIEW' })] }).mockRejectedValue(new ApiError(503, 'publishing_not_open'));
    const tree = await mount(CreatorDetail); control(tree(), t('cinema.creatorWorkspace.withdrawSubmission')).props.onPress(); confirm(); await settle();
    expect(control(tree(), t('cinema.creatorWorkspace.withdrawSubmission'))).toBeUndefined(); expect(words(tree())).toContain(t('cinemaUpload.closed'));
});
test('child never offers withdrawal', async () => {
    mockParams = { id: CHILD, parent: ID }; mockRequest.mockResolvedValue({ content: [row('EPISODE', { id: CHILD, lifecycle_status: 'PUBLISHED' })] });
    const tree = await mount(CreatorDetail); expect(control(tree(), t('cinema.creatorWorkspace.withdrawFromCinema'))).toBeUndefined();
});
test.each([true, false])('poster JPEG visible=%s and cache disabled', async ok => {
    mockParams = { id: ID }; mockRequest.mockResolvedValue({ content: [row('FILM', { video_ready: true })] }); mockStream.mockResolvedValue({ ok, arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer });
    const tree = await mount(CreatorDetail); const posters = byType(tree(), 'Image'); expect(posters).toHaveLength(ok ? 1 : 0);
    if (ok) expect(posters[0].props).toMatchObject({ cachePolicy: 'none', accessibilityLabel: t('cinema.upload.poster', { title: 'My title' }) });
    expect(mockStream).toHaveBeenCalledWith(`/api/v1/cinema/posters/${ID}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
});
const panel = () => <UploadPanel contentId={ID} editable onChange={jest.fn()} />;
const empty = { upload: null, proxy_uploads_enabled: true, library_uploads_enabled: true };
const pick = (tree: () => Node) => { control(tree(), t('cinema.videoUpload.fromLibrary')).props.onPress(); byType(tree(), 'LibraryChooser')[0].props.onPick({ jobId: JOB }); };
test.each([{ library_uploads_enabled: false }, { library_uploads_enabled: undefined }, { upload: { id: CHILD, state: 'ready' } }])('library button unavailable %j', async override => {
    mockRequest.mockResolvedValue({ ...empty, ...override }); const tree = await mount(panel); expect(control(tree(), t('cinema.videoUpload.fromLibrary'))).toBeUndefined();
});
test('staged record hides Library', async () => {
    mockRead.mockResolvedValue({ staged: 'file', fingerprint: 'hash', offset: 0, size: 1 }); mockRequest.mockResolvedValue(empty);
    const tree = await mount(panel); expect(control(tree(), t('cinema.videoUpload.fromLibrary'))).toBeUndefined();
});
test('running transfer hides Library', async () => {
    mockRunning.mockReturnValue(CHILD); mockRequest.mockResolvedValue(empty); const tree = await mount(panel); expect(control(tree(), t('cinema.videoUpload.fromLibrary'))).toBeUndefined();
});
test.each(['upload_safety_hold', 'uploads_not_open'])('library %s keeps Files available and says not available', async code => {
    mockRequest.mockResolvedValueOnce(empty).mockRejectedValue(new ApiError(503, code)); const tree = await mount(panel); pick(tree); await settle();
    expect(JSON.parse(write()[0][1].body)).toEqual({ content_id: ID, job_id: JOB }); expect(words(tree())).toContain(t('cinemaUpload.closed')); expect(control(tree(), t('cinemaUpload.files'))).toBeDefined();
});
test('uncertain import retry reuses key; remove and empty refresh cause a fresh key', async () => {
    mockRequest.mockResolvedValueOnce(empty).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ...empty, upload: { id: CHILD, state: 'processing', source_job_id: JOB } }).mockResolvedValueOnce(empty).mockResolvedValueOnce(empty).mockResolvedValueOnce(empty);
    const tree = await mount(panel); pick(tree); await settle(); pick(tree); await settle();
    expect(write()[0][1].headers['Idempotency-Key']).toBe(write()[1][1].headers['Idempotency-Key']);
    expect(words(tree())).toContain(t('cinema.videoUpload.yourCheckedLibraryVideoIsProcessing'));
    control(tree(), t('cinemaUpload.remove')).props.onPress(); confirm(); await settle();
    control(tree(), t('cinemaUpload.refresh')).props.onPress(); await settle(); pick(tree); await settle();
    const imports = write().filter(([p]) => p.endsWith('/from-library')); expect(imports).toHaveLength(3); expect(imports[2][1].headers['Idempotency-Key']).not.toBe(imports[0][1].headers['Idempotency-Key']);
});
test('Pass param is consumed and an identical second link selects Profile again', async () => {
    mockParams = { section: 'profile' }; const tree = await mount(Cinema);
    expect(control(tree(), t('cinemaBrowse.tab.profile')).props.accessibilityState.selected).toBe(true); expect(router.setParams).toHaveBeenCalledWith({ section: undefined });
    mockParams = {}; tree(); await effects(); control(tree(), t('cinemaBrowse.tab.watch')).props.onPress(); expect(control(tree(), t('cinemaBrowse.tab.watch')).props.accessibilityState.selected).toBe(true);
    mockParams = { section: 'profile' }; tree(); await effects(); expect(control(tree(), t('cinemaBrowse.tab.profile')).props.accessibilityState.selected).toBe(true); expect(router.setParams).toHaveBeenCalledTimes(2);
});

test.each([new ApiError(503, 'temporarily_unavailable'), new ApiError(429, 'rate_limited')])('Library retains key after uncertain refusal %j', async error => {
    mockRequest.mockResolvedValueOnce(empty).mockRejectedValueOnce(error).mockResolvedValueOnce(empty);
    const tree = await mount(panel); pick(tree); await settle(); pick(tree); await settle();
    expect(write()[0][1].headers['Idempotency-Key']).toBe(write()[1][1].headers['Idempotency-Key']);
});
test('Library clears key on definite refusal and on an empty refresh after an uncertain request', async () => {
    mockRequest.mockResolvedValueOnce(empty).mockRejectedValueOnce(new ApiError(400, 'source_not_video')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(empty).mockResolvedValueOnce(empty);
    const tree = await mount(panel); pick(tree); await settle(); pick(tree); await settle();
    expect(write()[0][1].headers['Idempotency-Key']).not.toBe(write()[1][1].headers['Idempotency-Key']);
    control(tree(), t('cinemaUpload.refresh')).props.onPress(); await settle(); pick(tree); await settle();
    const imports = write().filter(([p]) => p.endsWith('/from-library'));
    expect(imports[2][1].headers['Idempotency-Key']).not.toBe(imports[1][1].headers['Idempotency-Key']);
});
test('a successful empty import clears its key and concurrent picks send once', async () => {
    mockRequest.mockResolvedValueOnce(empty).mockResolvedValue(empty); const tree = await mount(panel);
    control(tree(), t('cinema.videoUpload.fromLibrary')).props.onPress(); const choose = byType(tree(), 'LibraryChooser')[0].props.onPick;
    choose({ jobId: JOB }); choose({ jobId: JOB }); await settle(); expect(write()).toHaveLength(1);
    pick(tree); await settle(); expect(write()).toHaveLength(2); expect(write()[0][1].headers['Idempotency-Key']).not.toBe(write()[1][1].headers['Idempotency-Key']);
});
test.each(['creator_required', 'account_not_active', 'not_authorized'])('withdrawal role refusal %s closes quietly', async code => {
    mockParams = { id: ID }; mockRequest.mockResolvedValueOnce({ content: [row('FILM', { lifecycle_status: 'PUBLISHED' })] }).mockRejectedValue(new ApiError(403, code));
    const tree = await mount(CreatorDetail); control(tree(), t('cinema.creatorWorkspace.withdrawFromCinema')).props.onPress(); confirm(); await settle();
    expect(control(tree(), t('cinema.creatorWorkspace.withdrawFromCinema'))).toBeUndefined(); expect(words(tree())).not.toContain(code);
    expect(words(tree())).toContain(t('cinemaCreator.upload.body'));
});
test('withdrawal 429 is readable and retry keeps the body key', async () => {
    mockParams = { id: ID }; mockRequest.mockResolvedValueOnce({ content: [row('FILM', { lifecycle_status: 'UNDER_REVIEW' })] }).mockRejectedValue(new ApiError(429, 'rate_limited'));
    const tree = await mount(CreatorDetail); const label = t('cinema.creatorWorkspace.withdrawSubmission');
    control(tree(), label).props.onPress(); confirm(); await settle(); expect(words(tree())).toContain(t('cinemaUpload.rate'));
    control(tree(), label).props.onPress(); confirm(); await settle(); expect(write()[0][1].headers['Idempotency-Key']).toBe(write()[1][1].headers['Idempotency-Key']);
});
test.each([{ lifecycle_status: 'PUBLISHED' }, { content_type: 'EPISODE' }])('child editor refuses an incompatible row %j', async extra => {
    mockParams = { id: CHILD, parent: ID, parentType: 'SERIES' }; mockRequest.mockResolvedValue({ content: [row('SEASON', { id: CHILD, position: 1, ...extra })] });
    const tree = await mount(CreatorDraft); expect(words(tree())).toContain(t('cinemaUpload.closed')); expect(control(tree(), t('cinemaUpload.save'))).toBeUndefined();
});
test('root SERIES editor retains category controls', async () => {
    mockParams = { id: ID }; mockRequest.mockResolvedValueOnce({ content: [row('SERIES', { categories: ['drama'] })] }).mockResolvedValue({ id: ID });
    const tree = await mount(CreatorDraft); expect(words(tree())).toContain(t('cinemaUpload.categories'));
    control(tree(), t('cinemaUpload.save')).props.onPress(); await settle(); expect(JSON.parse(write()[0][1].body)).toMatchObject({ content_type: 'SERIES', parent_id: null, position: null, categories: ['drama'] });
});
test('invalid child number is explained without a write', async () => {
    mockParams = { parent: ID, parentType: 'SERIES' }; mockRequest.mockResolvedValue({ content: [] }); const tree = await mount(CreatorDraft);
    control(tree(), 'Season number').props.onChangeText('1.5'); control(tree(), t('cinemaUpload.save')).props.onPress(); await settle();
    expect(write()).toHaveLength(0); expect(words(tree())).toContain(t('cinemaStudio.positionInvalid'));
});
test('a late poster cannot populate state after its owner scope expires', async () => {
    let resolvePoster!: (value: any) => void;
    mockParams = { id: ID }; mockRequest.mockResolvedValue({ content: [row('FILM', { video_ready: true })] }); mockStream.mockReturnValue(new Promise(resolve => { resolvePoster = resolve; }));
    const tree = await mount(CreatorDetail); mockLive = false; resolvePoster({ ok: true, arrayBuffer: async () => new Uint8Array([255, 216, 255]).buffer }); await settle();
    expect(byType(tree(), 'Image')).toHaveLength(0);
});
