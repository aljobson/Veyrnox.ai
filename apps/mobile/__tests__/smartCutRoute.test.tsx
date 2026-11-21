import { act } from 'react';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import SmartCutRoute from '../src/app/(app)/smart-cut';
import { rawText, t } from '../src/lib/i18n';

jest.setTimeout(30000);
const mockPush = jest.fn(), mockReplace = jest.fn(), mockListJobs = jest.fn(), mockFetchCatalog = jest.fn(), mockQuoteEdit = jest.fn();
let mockAnalysisDisabled = false;
let mockOwner: string, mockOwnerListeners: Set<() => void>;
const mockApi = {};
jest.mock('expo-router', () => ({ Stack: { Screen: () => null }, useRouter: () => ({ push: mockPush, replace: mockReplace }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'route-key' }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: mockApi, beginSessionTask: () => ({ current: () => true }) }) }));
jest.mock('../src/lib/aiConsentStore', () => ({ aiConsent: { ensure: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../src/lib/appCache', () => {
    mockOwner = 'owner'; mockOwnerListeners = new Set();
    return { getCacheUser: () => mockOwner, subscribeCacheUser: (listener: () => void) => { mockOwnerListeners.add(listener); return () => mockOwnerListeners.delete(listener); } };
});
jest.mock('../src/lib/editorFlag', () => ({ FULL_EDITOR_ENABLED: true }));
jest.mock('../src/lib/media', () => ({ mediaApi: () => ({ listJobs: mockListJobs }), fetchCatalog: (...args: unknown[]) => mockFetchCatalog(...args) }));
jest.mock('../src/lib/librarySource', () => ({ libraryChoices: (jobs: unknown[]) => jobs.length ? [
    { jobId: '11111111-1111-4111-8111-111111111111', name: 'Take One', createdAt: '2026-11-20T10:00:00Z' },
    { jobId: '22222222-2222-4222-8222-222222222222', name: 'Take Two', createdAt: '2026-11-20T11:00:00Z' },
] : [] }));
jest.mock('../src/lib/editorLibraryLength', () => ({ libraryMedia: async () => ({ frames: 360, kind: 'video', id: 'media' }) }));
jest.mock('../src/lib/clipEdit', () => ({ ...jest.requireActual('../src/lib/clipEdit'), fetchClipShape: async () => 16 / 9, quoteEdit: (...args: unknown[]) => mockQuoteEdit(...args) }));
jest.mock('../src/components/JobThumb', () => ({ JobThumb: () => null, useAssetLinks: () => ({}) }));
jest.mock('../src/components/smart-cut/SmartCutPreview', () => ({ SmartCutPreview: () => null }));
jest.mock('../src/components/smart-cut/SmartCutAnalysisCard', () => {
    const React = jest.requireActual<typeof import('react')>('react');
    const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
    const analyse = (clip: { jobId: string; duration: number }) => ({
        version: 1, assetId: clip.jobId, duration: clip.duration, provider: 'fal-scribe-v2', transcript: 'hello um there', language: 'en', timingQuality: 'word',
        chunks: [{ start: 1, end: 1.5, text: 'hello' }, { start: 2, end: 2.2, text: 'um' }, { start: 3, end: 3.5, text: 'there' }],
    });
    return { SmartCutAnalysisCard: ({ clips, onAnalysed, onBusyChange, disabled }: { disabled?: boolean; clips: { jobId: string; duration: number }[]; onAnalysed: (id: string, value: unknown) => void; onBusyChange?: (busy: boolean) => void }) => {
        mockAnalysisDisabled = !!disabled;
        const [recovery, setRecovery] = React.useState(false);
        return React.createElement(React.Fragment, null,
        React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Analyse first', onPress: () => clips[0] && onAnalysed(clips[0].jobId, analyse(clips[0])) }, React.createElement(Text, null, 'Analyse first')),
        React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Analyse first phrase', onPress: () => clips[0] && onAnalysed(clips[0].jobId, { ...analyse(clips[0]), provider: 'fal-wizper', timingQuality: 'phrase' }) }, React.createElement(Text, null, 'Analyse first phrase')),
        React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Analyse second', onPress: () => clips[1] && onAnalysed(clips[1].jobId, analyse(clips[1])) }, React.createElement(Text, null, 'Analyse second')),
        React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Analyse all', onPress: () => clips.forEach(clip => onAnalysed(clip.jobId, analyse(clip))) }, React.createElement(Text, null, 'Analyse all')),
        React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Analysis busy', onPress: () => onBusyChange?.(true) }, React.createElement(Text, null, 'Analysis busy')),
        React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Analysis idle', onPress: () => onBusyChange?.(false) }, React.createElement(Text, null, 'Analysis idle')),
        React.createElement(Pressable, { accessibilityRole: 'button', accessibilityLabel: 'Set recovery', onPress: () => setRecovery(true) }, React.createElement(Text, null, 'Set recovery')),
        recovery ? React.createElement(Text, null, 'Recovery retained') : null,
    ); } };
});

let root: Root;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const buttons = (label: string) => root.container.queryAll(node => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === rawText(label));
const text = () => root.container.queryAll(node => node.children.some(child => typeof child === 'string')).map(node => node.children.filter(child => typeof child === 'string').join(''));
async function press(control: TestInstance) { await act(async () => { control.props.onClick(event); await Promise.resolve(); await Promise.resolve(); }); }
async function addBoth() {
    await press(buttons(t('edit.add'))[0]);
    await press(buttons(t('edit.add'))[0]);
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockOwner = 'owner'; root = createRoot();
    mockListJobs.mockResolvedValue({ jobs: [{ id: 'one' }, { id: 'two' }], next: null });
    mockFetchCatalog.mockResolvedValue([]);
    mockQuoteEdit.mockResolvedValue({ kind: 'quote', credits: 12 });
});
afterEach(async () => { await act(async () => root.unmount()); });

test('speech readiness is all-or-nothing, filler changes stale the plan, and editor handoff keeps reviewed cuts', async () => {
    await act(async () => { root.render(<SmartCutRoute />); await Promise.resolve(); await Promise.resolve(); });
    await addBoth();
    await press(buttons('Analyse first')[0]);
    expect(buttons(t('app.smartCut.action.createPreview'))).toHaveLength(1);
    await press(buttons('Analyse all')[0]);
    expect(buttons(t('app.smartCut.action.removePauses'))).toHaveLength(1);
    await press(buttons(t('app.smartCut.action.removePauses'))[0]);
    expect(text()).toContain(t('app.smartCut.mode.speechAware'));
    expect(buttons('Take One')).toHaveLength(0);

    const filler = root.container.queryAll(node => node.props.accessibilityLabel === rawText(t('app.smartCut.fillers.toggle', { count: 2 })) && typeof node.props.onChange === 'function')[0];
    expect(filler).toBeDefined();
    await act(async () => filler.props.onChange({ nativeEvent: { value: true } }));
    expect(text()).not.toContain(t('app.smartCut.mode.speechAware'));

    await press(buttons(t('app.smartCut.action.removePauses'))[0]);
    await press(buttons(t('app.smartCut.action.apply'))[0]);
    await press(buttons(t('edit.openLocal'))[0]);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/editor/new', params: { cuts: expect.any(String) } });
});

test('an account change clears selected clips before the new account can confirm analysis', async () => {
    await act(async () => { root.render(<SmartCutRoute />); await Promise.resolve(); await Promise.resolve(); });
    await press(buttons(t('edit.add'))[0]);
    expect(buttons(t('edit.remove'))).toHaveLength(1);
    await act(async () => { mockOwner = 'other'; mockOwnerListeners.forEach(listener => listener()); await Promise.resolve(); });
    expect(buttons(t('edit.remove'))).toHaveLength(0);
    expect(buttons(t('app.smartCut.action.createPreview'))[0].props.accessibilityState.disabled).toBe(true);
});

test('a running paid analysis cannot unmount its recovery and billing state', async () => {
    await act(async () => { root.render(<SmartCutRoute />); await Promise.resolve(); await Promise.resolve(); });
    await press(buttons(t('edit.add'))[0]);
    await press(buttons(t('app.smartCut.action.createPreview'))[0]);
    await press(buttons('Analysis busy')[0]);
    expect(buttons(t('app.smartCut.action.apply'))[0].props.accessibilityState.disabled).toBe(true);
    expect(buttons(t('edit.remove'))[0].props.accessibilityState.disabled).toBe(true);
    await press(buttons('Analysis idle')[0]);
    expect(buttons(t('app.smartCut.action.apply'))[0].props.accessibilityState.disabled).toBe(false);
});

test('reviewing the edit price keeps paid-analysis recovery state mounted', async () => {
    await act(async () => { root.render(<SmartCutRoute />); await Promise.resolve(); await Promise.resolve(); });
    await press(buttons(t('edit.add'))[0]);
    await press(buttons('Set recovery')[0]);
    await press(buttons(t('app.smartCut.action.createPreview'))[0]);
    await press(buttons(t('app.smartCut.action.apply'))[0]);
    await press(buttons(t('edit.review'))[0]);
    expect(text()).toContain('Recovery retained');
    await press(buttons(t('edit.backToEditing'))[0]);
    expect(text()).toContain('Recovery retained');
});

test('mixed timing names clips that cannot be checked for filler sounds', async () => {
    await act(async () => { root.render(<SmartCutRoute />); await Promise.resolve(); await Promise.resolve(); });
    await addBoth();
    await press(buttons('Analyse first phrase')[0]);
    await press(buttons('Analyse second')[0]);
    expect(text()).toContain(t('app.smartCut.native.fillers.wordTimingRequired', { names: 'Take One' }));
    expect(text()).not.toContain(t('app.smartCut.fillers.none'));
});

test('selecting a known mismatch disables analysis and removing it clears the block', async () => {
    mockListJobs.mockResolvedValue({ jobs: [
        { job_id: '11111111-1111-4111-8111-111111111111', video_width: 1080, video_height: 1920 },
        { job_id: '22222222-2222-4222-8222-222222222222', video_width: 1920, video_height: 1080 },
    ], next: null });
    await act(async () => root.render(<SmartCutRoute />));
    await addBoth();
    expect(mockAnalysisDisabled).toBe(true);
    expect(text()).toContain(t('edit.problem.mixed_shape'));
    await press(buttons(t('edit.remove'))[1]);
    expect(mockAnalysisDisabled).toBe(false);
    expect(text()).not.toContain(t('edit.problem.mixed_shape'));
});
