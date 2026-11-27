import { act } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { createRoot, type Root, type TestInstance } from 'test-renderer';
import SmartCutRoute from '../src/app/(app)/smart-cut';
import { rawText, t } from '../src/lib/i18n';

jest.setTimeout(30000);
const mockPush = jest.fn(), mockReplace = jest.fn(), mockListJobs = jest.fn(), mockFetchCatalog = jest.fn(), mockQuoteEdit = jest.fn();
const mockReadSetupDraft = jest.fn(), mockWriteSetupDraft = jest.fn(), mockRemoveSetupDraft = jest.fn();
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
jest.mock('../src/lib/smartCutSetupDrafts', () => ({
    readSmartCutSetupDraft: (...args: unknown[]) => mockReadSetupDraft(...args),
    writeSmartCutSetupDraft: (...args: unknown[]) => mockWriteSetupDraft(...args),
    removeSmartCutSetupDraft: (...args: unknown[]) => mockRemoveSetupDraft(...args),
}));
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
const field = (label: string) => root.container.queryAll(node => node.props.accessibilityLabel === rawText(label) && typeof node.props.onChangeText === 'function')[0];
const text = () => root.container.queryAll(node => node.children.some(child => typeof child === 'string')).map(node => node.children.filter(child => typeof child === 'string').join(''));
async function press(control: TestInstance) { await act(async () => { control.props.onClick(event); await Promise.resolve(); await Promise.resolve(); }); }
async function addBoth() {
    await press(buttons(t('edit.add'))[0]);
    await press(buttons(t('edit.add'))[0]);
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockOwner = 'owner'; root = createRoot();
    mockReadSetupDraft.mockResolvedValue(null); mockWriteSetupDraft.mockResolvedValue(true); mockRemoveSetupDraft.mockResolvedValue(undefined);
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

test('offers and restores only the saved local Smart Cut setup', async () => {
    mockReadSetupDraft.mockResolvedValueOnce({
        owner: 'owner', updatedAt: 123,
        clips: [{ jobId: '11111111-1111-4111-8111-111111111111', label: 'Take One', length: 12, start: 1, end: 10 }],
        script: 'Recovered words', notes: 'Keep the complete take', pacing: 'relaxed', language: 'auto',
        removeFillers: false, skippedFillers: [], captionsOn: true, captionPreset: 'simple',
    });
    await act(async () => { root.render(<SmartCutRoute />); await Promise.resolve(); await Promise.resolve(); });
    expect(text()).toContain(t('app.smartCut.draft.title'));
    await press(buttons(t('app.smartCut.draft.restore'))[0]);
    expect(field(t('app.smartCut.script')).props.value).toBe('Recovered words');
    expect(buttons(t('edit.remove'))).toHaveLength(1);
    expect(text()).not.toContain(t('app.smartCut.draft.title'));
});

test('speech mode keeps the script visible and exposes analysed alternate takes', async () => {
    await act(async () => { root.render(<SmartCutRoute />); await Promise.resolve(); await Promise.resolve(); });
    await addBoth();
    await press(buttons('Analyse all')[0]);

    const script = field(t('app.smartCut.script'));
    expect(script).toBeDefined();
    await act(async () => script.props.onChangeText('hello um\nthere'));
    await press(buttons(t('app.smartCut.action.removePauses'))[0]);

    expect(text()).toContain(t('app.smartCut.mode.speechAware'));
    expect(buttons('Take One').length).toBeGreaterThan(0);
    expect(buttons('Take Two').length).toBeGreaterThan(0);

    expect(buttons(t('app.smartCut.language.auto'))).toHaveLength(1);
    await press(buttons(t('bestCut.language.es'))[0]);
    expect(buttons(t('app.smartCut.action.apply'))).toHaveLength(0);
    await press(buttons(t('app.smartCut.action.removePauses'))[0]);

    await act(async () => field(t('app.smartCut.script')).props.onChangeText('hello um\nthere again'));
    expect(buttons(t('app.smartCut.action.apply'))).toHaveLength(0);
});

test('restart keeps settled analyses while discard forgets them without removing source clips', async () => {
    await act(async () => { root.render(<SmartCutRoute />); await Promise.resolve(); await Promise.resolve(); });
    await addBoth();
    await press(buttons('Analyse all')[0]);
    await press(buttons(t('app.smartCut.action.removePauses'))[0]);

    expect(buttons(t('app.smartCut.action.restart'))).toHaveLength(1);
    expect(buttons(t('app.smartCut.action.discard'))).toHaveLength(1);
    await press(buttons(t('app.smartCut.action.restart'))[0]);
    expect(buttons(t('app.smartCut.action.removePauses'))).toHaveLength(1);
    expect(buttons(t('edit.remove'))).toHaveLength(2);

    await press(buttons(t('app.smartCut.action.removePauses'))[0]);
    await press(buttons(t('app.smartCut.action.discard'))[0]);
    expect(buttons(t('app.smartCut.action.createPreview'))).toHaveLength(1);
    expect(buttons(t('app.smartCut.action.apply'))).toHaveLength(0);
    expect(buttons(t('edit.remove'))).toHaveLength(2);
});

test('Smart Cut keeps its editing surface inside landscape physical edges', async () => {
    await act(async () => {
        root.render(<SafeAreaInsetsContext.Provider value={{ top: 0, right: 59, bottom: 21, left: 59 }}><SmartCutRoute /></SafeAreaInsetsContext.Provider>);
        await Promise.resolve(); await Promise.resolve();
    });
    expect(root.container.queryAll(node => {
        const style = StyleSheet.flatten(node.props.contentContainerStyle);
        return style?.paddingLeft === 75 && style?.paddingRight === 75 && style?.paddingBottom >= 21;
    }).length).toBeGreaterThan(0);
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
    await press(buttons(t('app.smartCut.action.removePauses'))[0]);
    expect(text().some((value) => value.includes(t('app.smartCut.warning.reviewBoundaries')))).toBe(true);
    expect(text().some((value) => value.includes(t('app.smartCut.warning.phraseTiming')))).toBe(true);
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
