import { act } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { ApiClient } from '../src/lib/api';
import { BestCutSheet } from '../src/components/editor/BestCutSheet';
import { probeDuration } from '../src/lib/editorMediaDuration';
import { t } from '../src/lib/i18n';
void [ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View];
const mockRun = jest.fn(), mockApply = jest.fn(), mockClose = jest.fn(), mockBuildPlanResult = jest.fn(), mockCopy = jest.fn();
let mockPick: (value: any) => void, mockTail = false;
const mockMedia = { id: 'j-33333333-3333-4333-8333-333333333333', kind: 'video', name: 'Take', frames: 300, hasAudio: true, width: 640, height: 360 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-key' }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), VideoExportPreset: { Passthrough: 0 } }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue(null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { copy: (...args: unknown[]) => mockCopy(...args) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn() }));
jest.mock('../src/lib/editorLibraryLength', () => ({ libraryMedia: async () => mockMedia }));
jest.mock('../src/lib/aiConsent', () => ({ createConsentGate: () => ({ setUser: jest.fn(), hasAgreed: async () => true, setPrompter: jest.fn(), ensure: async () => {} }) }));
jest.mock('../src/lib/bestCutFlow', () => ({ ...jest.requireActual('../src/lib/bestCutFlow'), createBestCutFlow: () => ({ run: mockRun }) }));
jest.mock('../src/lib/bestCutPlan', () => ({
    ...jest.requireActual('../src/lib/bestCutPlan'),
    buildBestCutPlanResult: (...args: any[]) => mockBuildPlanResult(...args),
}));
jest.mock('../src/lib/applyBestCut', () => ({ ...jest.requireActual('../src/lib/applyBestCut'), applyBestCut: () => ({ timeline: jest.requireActual('../src/lib/nativeEditorModel').emptyTimeline(), captionsOmitted: false }) }));
jest.mock('../src/components/JobThumb', () => ({ JobThumb: () => null, useAssetLinks: () => ({}) }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: (props: any) => { mockPick = props.onPick; return null; } }));
jest.mock('../src/components/editor/BestCutSettings', () => ({
    BestCutSettings: ({ onChange }: any) => require('react').createElement('button', {
        accessibilityLabel: 'Use Spanish',
        onClick: () => onChange({ captions: true, language: 'es' }),
    }),
}));
let root: Root;
const nodes = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function');
const visible = (value: string) => root.container.queryAll(n => n.children.includes(value)).length > 0;
async function press(label: string) { const matches = nodes(label); expect(matches).toHaveLength(1); await act(async () => matches[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 })); }
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); root = createRoot();
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: true, assets: null });
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValue({ canceled: true, assets: null });
    mockCopy.mockResolvedValue({ file: 'file:///project/clip.mp4', type: 'video/mp4', size: 1000, seconds: 8, verified: true });
    mockRun.mockResolvedValue({ inputs: [{ mediaId: mockMedia.id, analysis: { language: 'en' } }], silent: [], refunded: 0 });
    mockBuildPlanResult.mockImplementation(() => ({ ok: true, plan: {
        fps: 30, ranges: [], removedPauses: 1, removedRetakes: 0, removedRepeats: 0,
        matchedLines: 0, missingLines: [], droppedClips: 0,
        warnings: mockTail ? ['output_limit_reached'] : [], warningDetails: [],
    } }));
    mockApply.mockReturnValue({ status: 'refused', reason: 'tooLarge' });
});
afterEach(async () => { await act(async () => root.unmount()); });
test('Best Cut requests camera-roll video passthrough instead of a quality-losing transcode', async () => {
    const api = { getBalance: jest.fn().mockResolvedValue({ balance: 100 }) } as unknown as ApiClient;
    await act(async () => root.render(<BestCutSheet api={api} projectId="project" quote={{ credits: 1, max_seconds: 60, languages: ['en'] }} onClose={mockClose} onApply={mockApply} />));
    await press(t('bestCut.camera'));
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({
        mediaTypes: ['videos'], allowsMultipleSelection: true, selectionLimit: 10,
        videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    }));
});
test('Best Cut imports multiple video files through the bounded copy-only path', async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///provider/take.mp4', name: 'take.mp4', size: 1000, mimeType: 'video/mp4' }] } as never);
    jest.mocked(probeDuration).mockResolvedValue(8);
    const api = { getBalance: jest.fn().mockResolvedValue({ balance: 100 }) } as unknown as ApiClient;
    await act(async () => root.render(<BestCutSheet api={api} projectId="project" quote={{ credits: 1, max_seconds: 60, languages: ['en'] }} onClose={mockClose} onApply={mockApply} />));
    await press(t('bestCut.files'));
    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({ type: ['video/mp4', 'video/quicktime'], multiple: true, copyToCacheDirectory: true });
    expect(mockCopy).toHaveBeenCalledWith('project', 'l-test-key', 'file:///provider/take.mp4', 'video/mp4', 8);
    expect(visible('take.mp4')).toBe(true);
});
async function run(tail: boolean) {
    mockTail = tail;
    const api = { getBalance: jest.fn().mockResolvedValue({ balance: 100 }) } as unknown as ApiClient;
    await act(async () => root.render(<BestCutSheet api={api} projectId="project" quote={{ credits: 1, max_seconds: 60, languages: ['en'] }} onClose={mockClose} onApply={mockApply} />));
    await press(t('bestCut.library'));
    await act(async () => mockPick({ jobId: mockMedia.id.slice(2), name: 'Take' }));
    await press(t('bestCut.title'));
    if (tail) await press(t('bestCut.apply'));
}
test.each([false, true])('Best Cut gate refusal retains preview and offers no paid retry (tail=%s)', async tail => {
    await run(tail);
    expect(mockApply).toHaveBeenCalledTimes(1); expect(mockClose).not.toHaveBeenCalled();
    expect(visible(t('editorEditGate.tooLarge'))).toBe(true); expect(visible(t('bestCut.stale'))).toBe(false);
    expect(nodes(t('bestCut.apply'))).toHaveLength(1); expect(nodes(t('bestCut.title'))).toHaveLength(0);
    expect(nodes(t('bestCut.library'))[0].props.accessibilityState.disabled).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(1);
    await press(t('bestCut.notNow')); expect(mockClose).toHaveBeenCalledTimes(1);
});
test.each(['stale', 'not-live'])('Best Cut only uses stale wording for a changed revision (%s)', async status => {
    mockApply.mockReturnValue({ status }); await run(false);
    expect(visible(t('bestCut.stale'))).toBe(status === 'stale'); expect(mockClose).not.toHaveBeenCalled();
    expect(nodes(t('bestCut.title'))).toHaveLength(0); expect(mockRun).toHaveBeenCalledTimes(1);
});
test('Best Cut keeps a refused no-speech preview without restarting analysis', async () => {
    mockRun.mockImplementationOnce(async (_clips, _quote, _signal, progress) => {
        progress({ phase: 'no-speech', index: 0, fraction: 1, refunded: 0 });
        return { inputs: [], silent: [mockMedia.id], refunded: 0 };
    });
    await run(false); await press(t('bestCut.tryAnyway'));
    expect(visible(t('editorEditGate.tooLarge'))).toBe(true);
    expect(nodes(t('bestCut.apply'))).toHaveLength(1); expect(nodes(t('bestCut.title'))).toHaveLength(0);
    expect(nodes(t('bestCut.chooseAnother'))).toHaveLength(0); expect(mockRun).toHaveBeenCalledTimes(1);
    await press(t('bestCut.notNow')); expect(mockClose).toHaveBeenCalledTimes(1);
});
test('a no-speech result can be discarded to choose different clips without another paid request', async () => {
    mockRun.mockImplementationOnce(async (_clips, _quote, _signal, progress) => {
        progress({ phase: 'no-speech', index: 0, fraction: 1, refunded: 1 });
        return { inputs: [], silent: [mockMedia.id], refunded: 1 };
    });
    await run(false);
    expect(nodes(t('bestCut.chooseAnother'))).toHaveLength(1);
    await press(t('bestCut.chooseAnother'));
    expect(nodes(t('bestCut.chooseAnother'))).toHaveLength(0);
    expect(nodes(t('bestCut.title'))).toHaveLength(1);
    expect(nodes(t('bestCut.title'))[0].props.accessibilityState.disabled).toBe(true);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockApply).not.toHaveBeenCalled();
});
test('Best Cut sends the selected language to paid analysis without relabelling provider output locally', async () => {
    const providerAnalysis = { language: 'en' };
    mockRun.mockResolvedValueOnce({ inputs: [{ mediaId: mockMedia.id, analysis: providerAnalysis }], silent: [], refunded: 0 });
    const api = { getBalance: jest.fn().mockResolvedValue({ balance: 100 }) } as unknown as ApiClient;
    await act(async () => root.render(<BestCutSheet api={api} projectId="project" quote={{ credits: 1, max_seconds: 60, languages: ['en'] }} onClose={mockClose} onApply={mockApply} />));
    await press(t('bestCut.library'));
    await act(async () => mockPick({ jobId: mockMedia.id.slice(2), name: 'Take' }));
    await press('Use Spanish');
    await press(t('bestCut.title'));
    expect(mockBuildPlanResult).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][4]).toBe('es');
    expect(mockBuildPlanResult.mock.calls[0][0][0].analysis.language).toBe('en');
    expect(providerAnalysis.language).toBe('en');
    expect(mockRun).toHaveBeenCalledTimes(1);
});
