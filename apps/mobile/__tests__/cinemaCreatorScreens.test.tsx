declare const __dirname: string;
const { readFileSync } = require('fs') as { readFileSync(path: string, encoding: 'utf8'): string };
const { resolve } = require('path') as { resolve(...paths: string[]): string };
import type { ReactElement } from 'react';
const mockEffects: Array<() => void | (() => void)> = [];
let mockSlots: any[] = [], mockCursor = 0, mockCollect = true, mockEnabled = false;
const mockRequest = jest.fn(), mockStream = jest.fn(), mockVerify = jest.fn(), mockOpenURL = jest.fn();
const mockTicket = { owner: '11111111-1111-4111-8111-111111111111', n: 1 };
jest.mock('react', () => ({
    ...jest.requireActual('react'),
    useState: (value: any) => {
        const i = mockCursor++; if (!(i in mockSlots)) mockSlots[i] = typeof value === 'function' ? value() : value;
        return [mockSlots[i], (next: any) => { mockSlots[i] = typeof next === 'function' ? next(mockSlots[i]) : next; }];
    },
    useRef: (value: unknown) => { const i = mockCursor++; if (!(i in mockSlots)) mockSlots[i] = { current: value }; return mockSlots[i]; },
    useEffect: (effect: () => void | (() => void)) => { if (mockCollect) mockEffects.push(effect); },
    useCallback: (fn: unknown) => fn,
    useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));
jest.mock('react-native', () => ({
    Text: 'Text', View: 'View', Pressable: 'Pressable', ScrollView: 'ScrollView', TextInput: 'TextInput',
    StyleSheet: { create: (value: unknown) => value }, Alert: { alert: jest.fn() }, AccessibilityInfo: { announceForAccessibility: jest.fn() },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: jest.fn() }) }, Linking: { openURL: (...a: unknown[]) => mockOpenURL(...a) },
}));
jest.mock('expo-router', () => ({
    Link: 'Link', router: { push: jest.fn(), replace: jest.fn() }, useLocalSearchParams: () => ({ id: '33333333-3333-4333-8333-333333333333' }),
    useFocusEffect: (fn: () => void) => { if (mockCollect) mockEffects.push(fn); },
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ FileMode: { ReadOnly: 'r' } }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '55555555-5555-4555-8555-555555555555' }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: { request: mockRequest, stream: mockStream } }) }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => mockTicket.owner, subscribeCacheUser: () => () => undefined }));
jest.mock('../src/lib/cinemaUploadStore', () => ({ cinemaUploadStore: {
    ticket: () => mockTicket, live: () => true, subscribe: () => () => undefined, running: () => null,
    read: async () => null, reconcileStaged: async () => undefined, verify: (...a: unknown[]) => mockVerify(...a),
} }));
jest.mock('../src/lib/cinemaUpload', () => ({ ...jest.requireActual('../src/lib/cinemaUpload'), CINEMA_DEVICE_UPLOAD_ENABLED: mockEnabled }));
const CreatorIndex = () => require('../src/app/(app)/cinema/creator/index').default();
const CreatorDraft = () => require('../src/app/(app)/cinema/creator/draft').default();
const CreatorDetail = () => require('../src/app/(app)/cinema/creator/[id]').default();
const CreatorUploadShell = () => require('../src/components/cinema/CreatorUploadShell').CreatorUploadShell();
const UploadPanel = (props: { contentId: string; editable: boolean; onChange(): void }) => require('../src/components/cinema/creator/UploadPanel').UploadPanel(props);
const apiError = (status: number, code: string) => new (require('../src/lib/api').ApiError)(status, code);
import { t } from '../src/lib/i18n';
type Node = { type: unknown; props: Record<string, any>; children: Node[] };
function expand(element: any): Node | null {
    if (element === null || element === undefined || typeof element === 'boolean') return null;
    if (typeof element === 'string' || typeof element === 'number') return { type: '#text', props: { text: String(element) }, children: [] };
    if (typeof element.type === 'function') return expand(element.type(element.props));
    return { type: element.type, props: element.props, children: [element.props.children].flat(Infinity).map(expand).filter(Boolean) as Node[] };
}
const render = (component: () => ReactElement) => { mockCursor = 0; return expand(component())!; };
const all = (node: Node): Node[] => [node, ...node.children.flatMap(all)];
const words = (node: Node) => all(node).filter(x => x.type === '#text').map(x => x.props.text).join(' ');
const settle = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
beforeEach(() => { jest.resetModules(); mockSlots = []; mockCursor = 0; mockCollect = true; mockEnabled = false; mockEffects.length = 0; jest.clearAllMocks(); });
test('flag off shell retains its original visible text, one web link and styles', () => {
    const tree = render(CreatorUploadShell), nodes = all(tree);
    expect(words(tree)).toBe([t('cinemaCreator.upload.title'), t('cinemaCreator.upload.body'), t('cinemaCreator.upload.web')].join(' '));
    expect(nodes.filter(x => x.type === 'Pressable')).toHaveLength(1);
    expect(nodes.find(x => x.type === 'Pressable')?.props.accessibilityRole).toBe('link');
    expect(tree.props.style).toMatchObject({ borderRadius: 12, padding: 14, gap: 8 });
    expect(nodes.find(x => x.type === 'Pressable')?.props.style.minHeight).toBe(44);
});
test.each([CreatorIndex, CreatorDraft, CreatorDetail])('flag off route renders only closed text and web link, never fetches', async Route => {
    const tree = render(Route); for (const effect of mockEffects) effect(); await settle();
    expect(words(tree)).toBe(`${t('cinemaUpload.closed')} ${t('cinemaCreator.upload.web')}`);
    expect(mockRequest).not.toHaveBeenCalled(); expect(mockStream).not.toHaveBeenCalled();
});
test('flag on adds Your titles without removing the web link', () => {
    mockEnabled = true; const tree = render(CreatorUploadShell);
    expect(words(tree)).toContain('Your titles'); expect(words(tree)).toContain(t('cinemaCreator.upload.web'));
});
test('503 uploads_not_open renders Not available, hides Remove, never exposes the code', async () => {
    mockEnabled = true; mockRequest.mockRejectedValue(apiError(503, 'uploads_not_open'));
    const component = () => <UploadPanel contentId="33333333-3333-4333-8333-333333333333" editable onChange={jest.fn()} />;
    render(component); const cleanup = mockEffects.map(f => f()); await settle(); mockCollect = false;
    const text = words(render(component)); expect(text).toContain('Not available'); expect(text).not.toContain('uploads_not_open'); expect(text).not.toContain('Remove video');
    cleanup.forEach(fn => fn?.());
});
test('list reads only top-level content and shows type, moderation, note and readiness', async () => {
    mockEnabled = true; mockRequest.mockResolvedValue({ content: [{ id: 'one', content_type: 'FILM', title: 'Test title', lifecycle_status: 'UNDER_REVIEW', review_note: 'Please check', video_ready: true }, { id: 'two', title: 'Series title', content_type: 'SERIES', lifecycle_status: 'DRAFT' }] });
    render(CreatorIndex); const cleanup = mockEffects.map(f => f()); await settle(); mockCollect = false;
    const text = words(render(CreatorIndex));
    for (const expected of ['Test title', 'FILM', 'Under review', 'Please check', 'Video ready', 'Manage episodes on the web']) expect(text).toContain(expected);
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/cinema/content'); cleanup.forEach(fn => fn?.());
});
test.each(['creator_required', 'account_not_active', 'content_not_open'])('list explains %s quietly', async code => {
    mockEnabled = true; mockRequest.mockRejectedValue(apiError(code === 'content_not_open' ? 503 : 403, code));
    render(CreatorIndex); const cleanup = mockEffects.map(f => f()); await settle(); mockCollect = false;
    const text = words(render(CreatorIndex)); expect(text).not.toContain(code);
    expect(text).toContain(t(code === 'content_not_open' ? 'cinemaUpload.closed' : 'cinemaCreator.upload.body')); cleanup.forEach(fn => fn?.());
});
test('privacy: new production files never log media metadata or touch the shared picker folder', () => {
    const paths = ['lib/cinemaUpload.ts', 'lib/cinemaUploadStore.ts', 'lib/cinemaDrafts.ts',
        'app/(app)/cinema/creator/index.tsx', 'app/(app)/cinema/creator/draft.tsx', 'app/(app)/cinema/creator/[id].tsx',
        'components/cinema/creator/UploadPanel.tsx', 'components/cinema/creator/SubmitPanel.tsx', 'components/cinema/creator/RulesLinks.tsx'];
    for (const path of paths) {
        const source = readFileSync(resolve(__dirname, '../src', path), 'utf8');
        expect(source).not.toMatch(/console\./); expect(source).not.toMatch(/(?:Paths\.cache|Caches)[^\n]*['"]DocumentPicker['"]/);
        expect(source.split('\n').length).toBeLessThan(500);
    }
});

const CONTENT = '33333333-3333-4333-8333-333333333333';
const mountPanel = async () => {
    const component = () => <UploadPanel contentId={CONTENT} editable onChange={jest.fn()} />;
    render(component); const cleanup = mockEffects.map(f => f()); await settle(); mockCollect = false;
    return { tree: () => render(component), cleanup: () => cleanup.forEach(fn => fn?.()) };
};
test.each(['upload_busy', 'upload_needs_reconciliation'])('%s offers Contact support as a mailto link to the support address', async code => {
    mockEnabled = true; mockRequest.mockRejectedValue(apiError(409, code));
    const panel = await mountPanel(), link = all(panel.tree()).find(x => x.props.accessibilityLabel === t('cinemaUpload.supportLink'));
    expect(link?.props.accessibilityRole).toBe('link'); link!.props.onPress();
    expect(mockOpenURL).toHaveBeenCalledWith(`mailto:${require('../src/lib/account').SUPPORT_EMAIL}`);
    expect(mockOpenURL.mock.calls[0][0]).toBe('mailto:support@veyrnox.com'); panel.cleanup();
});
const noRawKeys = (text: string, code: string) => {
    expect(text).not.toMatch(/cinemaUpload\./); expect(text).not.toContain(code); expect(text).toContain(t('cinemaCreator.upload.body'));
};
test.each(['creator_required', 'account_not_active'])('upload panel shows the creator-closed state for %s, never a raw key', async code => {
    mockEnabled = true; mockRequest.mockRejectedValue(apiError(403, code));
    const panel = await mountPanel(); noRawKeys(words(panel.tree()), code); panel.cleanup();
});
test.each(['creator_required', 'account_not_active'])('submit panel shows the creator-closed state for %s, never a raw key', async code => {
    mockRequest.mockRejectedValue(apiError(403, code));
    const { RIGHTS_TEXT, SAFETY_TEXT, MALWARE_TEXT } = require('../src/lib/cinemaDrafts');
    const Panel = () => require('../src/components/cinema/creator/SubmitPanel').SubmitPanel({ title: { id: CONTENT, title: 'Test title' }, onDone: jest.fn() });
    const press = (label: string) => all(render(Panel)).find(x => x.props.accessibilityLabel === label)!.props.onPress();
    render(Panel); mockCollect = false;
    for (const label of ['All ages', RIGHTS_TEXT, SAFETY_TEXT, MALWARE_TEXT]) press(label);
    press(t('cinemaUpload.submit'));
    const alert = require('react-native').Alert.alert as jest.Mock; alert.mock.calls[0][2][1].onPress(); await settle();
    expect(mockRequest).toHaveBeenCalledWith('/api/v1/cinema/content/submit', expect.anything());
    noRawKeys(words(render(Panel)), code);
});
test('a staged file is hashed once per launch: never right after pick, again only on a new launch', async () => {
    const record = { contentId: CONTENT, uploadId: null, size: 10, fingerprint: 'abc', staged: 'one.mp4', offset: 0, startKey: 'k', pausedByUser: false };
    const panel = require('../src/components/cinema/creator/UploadPanel');
    mockVerify.mockResolvedValue(true);
    panel.markVerified(record);
    expect(await panel.stagedValid(mockTicket, record)).toBe(true); expect(mockVerify).not.toHaveBeenCalled();
    const other = { ...record, staged: 'two.mp4' };
    expect(await panel.stagedValid(mockTicket, other)).toBe(true); expect(await panel.stagedValid(mockTicket, other)).toBe(true);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    mockVerify.mockResolvedValue(false); const bad = { ...record, staged: 'three.mp4' };
    expect(await panel.stagedValid(mockTicket, bad)).toBe(false); expect(await panel.stagedValid(mockTicket, bad)).toBe(false);
    expect(mockVerify).toHaveBeenCalledTimes(3);
    jest.resetModules(); mockVerify.mockClear().mockResolvedValue(true);
    expect(await require('../src/components/cinema/creator/UploadPanel').stagedValid(mockTicket, record)).toBe(true);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    const source = readFileSync(resolve(__dirname, '../src/components/cinema/creator/UploadPanel.tsx'), 'utf8');
    expect(source.match(/store\.verify\(/g)).toHaveLength(1);
    expect(source.match(/stagedValid\(scope\.ticket, saved\)/g)).toHaveLength(2);
    expect(source).toMatch(/store\.pick\([^\n]*\n\s*markVerified\(next\);/);
});
test('AuthProvider only adds the upload owner import and one call each after bindCacheUser and wipeCache', () => {
    const path = 'apps/mobile/src/auth/AuthProvider.tsx';
    const source = readFileSync(resolve(__dirname, '../src/auth/AuthProvider.tsx'), 'utf8');
    const added = ["import { setOwner as setCinemaUploadOwner } from '../lib/cinemaUploadStore';",
        'await setCinemaUploadOwner(userId).catch(() => undefined);', 'await setCinemaUploadOwner(null).catch(() => undefined);'];
    expect(source.match(/await setCinemaUploadOwner\(userId\)\.catch\(/g)).toHaveLength(1);
    expect(source.match(/await setCinemaUploadOwner\(null\)\.catch\(/g)).toHaveLength(1);
    expect(source.match(/setCinemaUploadOwner/g)).toHaveLength(3);
    const adopt = source.slice(source.indexOf('const adopt = useCallback'), source.indexOf('const drop = useCallback'));
    const drop = source.slice(source.indexOf('const drop = useCallback'), source.indexOf('const refresh = useCallback'));
    expect(adopt).toMatch(/await bindCacheUser\(userId\);\n\s*await setCinemaUploadOwner\(userId\)\.catch\(/);
    expect(drop).toMatch(/await wipeCache\(\)\.catch\(\(\) => undefined\);\n\s*await setCinemaUploadOwner\(null\)\.catch\(/);
    const lines = (text: string) => text.split('\n').map(x => x.trim()).filter(Boolean);
    const { execFileSync } = require('child_process');
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: __dirname, encoding: 'utf8' }).trim();
    const base: string = execFileSync('git', ['show', `HEAD:${path}`], { cwd: root, encoding: 'utf8' });
    // Once this change is committed HEAD already holds it; the structural checks above still pin it.
    if (base.includes('setCinemaUploadOwner')) return;
    expect(lines(source).filter(x => !added.includes(x))).toEqual(lines(base));
});
