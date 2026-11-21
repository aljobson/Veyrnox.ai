import { act } from 'react';
import * as lookEdit from '../src/lib/editorLookEdit';
import { colourDefaults } from '../../../app/veyrnox/_lib/editorColour.mjs';
import { BACKGROUND_DEFAULTS } from '../../../app/veyrnox/_lib/editorBackground.mjs';
import { createRoot } from 'test-renderer';
import { FiltersPanel, EffectsPanel, TransitionsPanel } from '../src/components/editor/tools/LookPanels';
import { useLookActions } from '../src/components/editor/tools/useLookActions';
import { createFrameStore } from '../src/components/editor/editorFrameStore';
import { emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';
import { parameterKeyframe } from '../../../app/veyrnox/_lib/editorAnimation.mjs';
import type { ToolPanelProps } from '../src/components/editor/tools/types';
const mockCurveRender = jest.fn();
jest.mock('../src/components/editor/tools/CurveEditor', () => {
    const { CurveEditor } = jest.requireActual('../src/components/editor/tools/CurveEditor');
    return { CurveEditor: (props: any) => { mockCurveRender(props); return <CurveEditor {...props} />; } };
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
test('look panels show video-only controls; evaluated readouts follow a paused seek', async () => {
    const root = createRoot(), frameStore = createFrameStore(), applyTimeline = jest.fn((_next: Timeline) => true), setProblem = jest.fn();
    const timeline = emptyTimeline(); timeline.media.m = { id: 'm', kind: 'video', frames: 900, width: 640, height: 360, hasAudio: true, name: 'Movie' };
    timeline.video = [{ id: 'v1', start: 0, len: 90, in: 0, trackId: 'video-0', mediaId: 'm', transition: 0, volume: 1 }];
    const clip = timeline.video[0]; clip.parameterKeyframes = [parameterKeyframe(clip, 0), { ...parameterKeyframe(clip, 89), brightness: 2 }];
    let parentRenders = 0;
    function Harness({ Panel, audio = false }: { Panel: typeof FiltersPanel; audio?: boolean }) {
        parentRenders++;
        const selection = { track: audio ? 'audio' as const : 'video' as const, id: 'v1' };
        const lookActions = useLookActions({ timeline, selection, frameStore, applyTimeline, setProblem });
        return <Panel {...{ timeline, selection, selected: clip, lookActions } as ToolPanelProps} />;
    }
    for (const Panel of [FiltersPanel, EffectsPanel, TransitionsPanel]) {
        await act(async () => root.render(<Harness Panel={Panel} />));
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'header').length).toBeGreaterThan(0);
        for (const control of root.container.queryAll(n => ['button', 'adjustable', 'radiogroup'].includes(n.props.accessibilityRole))) {
            expect(typeof control.props.accessibilityLabel).toBe('string'); expect(control.props.accessibilityLabel.length).toBeGreaterThan(0);
        }
        expect(root.container.queryAll(n => n.children.includes("The phone preview doesn't show looks yet. They are kept in your project.")).length).toBeGreaterThan(0);
        expect(root.container.queryAll(n => n.children.includes(t('editor.videoclipselected'))).length).toBeGreaterThan(0);
        expect(root.container.queryAll(n => n.children.includes(t('editor.selectavideoclip')))).toHaveLength(0);
        await act(async () => root.render(<Harness Panel={Panel} audio />));
        expect(root.container.queryAll(n => n.children.includes(t('editor.videoclipselected')))).toHaveLength(0);
        expect(root.container.queryAll(n => n.children.includes(t('editor.selectavideoclip'))).length).toBeGreaterThan(0);
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'adjustable')).toHaveLength(0);
    }
    await act(async () => root.render(<Harness Panel={FiltersPanel} />));
    const rendered = parentRenders;
    await act(async () => frameStore.set(89)); expect(parentRenders).toBe(rendered);
    const slider = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === 'Brightness')[0];
    expect(slider.props.accessibilityValue.now).toBe(2);
    await act(async () => slider.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(applyTimeline).toHaveBeenCalledTimes(1); expect(applyTimeline.mock.calls[0][0].video[0].filter!.brightness).toBe(2.05);
    await act(async () => root.unmount());
});

import { FullEditorScreen } from '../src/components/editor/FullEditorScreen';
import { useFullEditorSession } from '../src/components/editor/useFullEditorSession';
import { envelope } from './fixtures/webSequenceV3';
import { nearLimit } from './fixtures/editorNearLimit';
import { t } from '../src/lib/i18n';
let mockSession: ReturnType<typeof useFullEditorSession>;
const mockRequest = jest.fn(), mockApi = { request: mockRequest };
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };
const mockBeginSessionTask = () => ({ current: () => true });
const mockScreenRender = jest.fn(), mockStackOptions = jest.fn();
jest.mock('../src/lib/voiceoverRecorder', () => ({ VOICEOVER_AVAILABLE: false }));
jest.mock('../src/components/editor/useFullEditorSession', () => {
    const real = jest.requireActual('../src/components/editor/useFullEditorSession');
    return { ...real, useFullEditorSession: (props: any) => { mockSession = real.useFullEditorSession(props); return mockSession; } };
});
jest.mock('../src/lib/appCache', () => ({ getCacheUser: () => 'owner', subscribeCacheUser: () => () => {} }));
jest.mock('../src/lib/editorDrafts', () => ({ readDraft: jest.fn().mockResolvedValue(null), writeDraft: jest.fn().mockResolvedValue(true), removeDraft: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../src/lib/editorDeviceMedia', () => ({ editorDeviceMedia: { hydrate: jest.fn().mockResolvedValue({}), copy: jest.fn().mockResolvedValue(null),
    backup: jest.fn().mockResolvedValue(null) } }));
jest.mock('../src/lib/editorMediaDuration', () => ({ probeDuration: jest.fn().mockResolvedValue(4) }));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'native-save-key' }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn().mockResolvedValue('seen'), setItemAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn(), UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' } }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-router', () => ({ Stack: { Screen: ({ options }: any) => { mockStackOptions(options); return options?.headerRight?.() ?? null; } },
    usePreventRemove: () => () => {}, useRouter: () => mockRouter }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => { mockScreenRender(); return { api: mockApi, beginSessionTask: mockBeginSessionTask }; } }));
jest.mock('../src/components/editor/EditorMediaPreview', () => ({ EditorMediaPreview: ({ media, localUri }: any) => require('react').createElement(require('react-native').View,
    { accessibilityLabel: `Real preview ${media.name}`, testID: localUri }) }));
jest.mock('../src/components/LibraryChooser', () => ({ LibraryChooser: ({ onPick }: any) => require('react').createElement(require('react-native').Pressable,
    { accessibilityRole: 'button', accessibilityLabel: 'Choose Library item', onPress: () => onPick({ jobId: '22222222-2222-2222-2222-222222222222', name: 'Library shot',
    createdAt: '2026-10-23T00:00:00Z' }) }) }));
describe('FullEditorScreen look commits', () => {
    let root: ReturnType<typeof createRoot>;
    beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); root = createRoot(); });
    afterEach(async () => { await act(async () => root.unmount()); jest.useRealTimers(); });
    const clip = (id: string, start = 0) => ({ id, mediaId: 'm', start, len: 90, in: 0, volume: 1, transition: 0, trackId: 'video-0' });
    const timeline = () => ({ ...emptyTimeline(), media: {
        m: { id: 'm', name: 'Movie', kind: 'video', frames: 900, width: 640, height: 360, hasAudio: true },
    }, video: [clip('v1'), clip('v2', 90)] });
    async function open(tl = timeline(), doc = envelope(tl)) {
        mockRequest.mockImplementation(async (path: string) => path.endsWith('/document') ? { revision: 1, document: doc }
            : { project: { id: doc.project_id, workspace_id: 'workspace', name: 'Look test' } });
        await act(async () => root.render(<FullEditorScreen projectId={doc.project_id} startAdvanced />));
        await act(async () => { mockSession.setSelection({ track: 'video', id: 'v2' }); mockSession.setSelections([{ track: 'video', id: 'v2' }]); });
    }
    async function press(label: string) {
        const nodes = root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function');
        expect(nodes).toHaveLength(1);
        await act(async () => nodes[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
    }
    test.each([['Effects', 'Normal'], ['Effects', 'None'], ['Effects', 'Reset crop'],
        ['Filters', 'Reset filter'], ['Filters', 'Reset colour'], ['Transitions', 'No transition']])(
        '%s / %s leaves an untouched document clean with no revision or history', async (panel, label) => {
            await open(); const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
            await press(panel);
            const buttons = root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function');
            expect(buttons.length).toBeGreaterThan(0);
            for (const button of buttons) await act(async () => button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
            expect(mockSession.currentDocument()).toBe(before); expect(mockSession.getEditRevision()).toBe(revision);
            expect(mockSession.history.canUndo).toBe(false); expect(mockSession.dirty).toBe(false);
        });
    test.each([['Filters', 'Blur', 'decrement', false], ['Effects', 'Width', 'increment', false],
        ['Filters', 'Blur', 'decrement', true]] as const)('%s / %s %s at a bound preserves document, history and keys (animated %s)', async (panel, label, actionName, animated) => {
        const tl: Timeline = timeline();
        if (animated) tl.video[1].parameterKeyframes = [parameterKeyframe(tl.video[1], 0), parameterKeyframe(tl.video[1], 89)];
        await open(tl as ReturnType<typeof timeline>);
        await act(async () => mockSession.setFrame(120));
        await press(panel);
        const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        const keys = (before!.timeline as Timeline).video[1].parameterKeyframes;
        const slider = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === label)[0];
        expect(slider.props.accessibilityValue.now).toBe(label === 'Width' ? 1 : 0);
        await act(async () => slider.props.onAccessibilityAction({ nativeEvent: { actionName } }));
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.getEditRevision()).toBe(revision);
        expect(mockSession.history).toEqual({ canUndo: false, canRedo: false }); expect(mockSession.dirty).toBe(false);
        expect((mockSession.currentDocument()!.timeline as Timeline).video[1].parameterKeyframes).toBe(keys);
    });
    test.each([false, true])('applying default background to all is a clean no-op (near cap %s)', async nearCap => {
        const tl = timeline(), doc = nearCap ? nearLimit(true) : envelope(tl);
        if (nearCap) {
            (doc.timeline as Timeline).video = tl.video;
            doc.brief = 'b'.repeat(32760 - (JSON.stringify(doc).length - doc.brief.length));
        }
        await open(tl, doc); await press('Effects');
        const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        await press(t('editorLook.applyAll'));
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.getEditRevision()).toBe(revision);
        expect(mockSession.history).toEqual({ canUndo: false, canRedo: false }); expect(mockSession.dirty).toBe(false);
        expect(mockSession.problem).toBeNull();
    });
    test('applying an unchanged background with a locked track leaves no problem, revision, history or dirty change', async () => {
        const tl = timeline();
        tl.tracks.push({ ...tl.tracks[0], id: 'video-9', locked: true });
        tl.video[0].trackId = 'video-9';
        await open(tl); await press('Effects');
        const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        await press(t('editorLook.applyAll'));
        expect(mockSession.problem).toBeNull();
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.getEditRevision()).toBe(revision);
        expect(mockSession.history).toEqual({ canUndo: false, canRedo: false }); expect(mockSession.dirty).toBe(false);
    });
    test.each([false, true])('channels are kept when parameterKeyframes change while the panel stays mounted (initially animated %s)', async animatedBefore => {
        const tl: Timeline = timeline();
        if (animatedBefore) tl.video[1].parameterKeyframes = [parameterKeyframe(tl.video[1], 0)];
        const doc = envelope(tl), selection = { track: 'video' as const, id: 'v2' };
        mockRequest.mockImplementation(async (path: string) => path.endsWith('/document') ? { revision: 1, document: doc }
            : { project: { id: doc.project_id, workspace_id: 'workspace', name: 'Look test' } });
        // Production undo clears selection and unmounts the panel. Keep it mounted here to test the whitelisted controls.
        function Harness() {
            const session = useFullEditorSession({ projectId: doc.project_id });
            const snapshot = (session.document?.timeline as Timeline | undefined) ?? tl;
            const props: Partial<ToolPanelProps> = { timeline: snapshot, selection, applyTimeline: () => false };
            return <FiltersPanel {...props as ToolPanelProps} />;
        }
        await act(async () => root.render(<Harness />));
        const before = mockSession.currentDocument()!, current = before.timeline as Timeline;
        const changed = { ...current.video[1] };
        if (animatedBefore) delete changed.parameterKeyframes;
        else changed.parameterKeyframes = [parameterKeyframe(changed, 0)];
        await act(async () => { mockSession.markDocument({ ...before, timeline: { ...current, video: [current.video[0], changed] } }); });
        const blue = () => root.container.queryAll(n => n.props.accessibilityLabel === 'Blue' && typeof n.props.onClick === 'function');
        expect(blue()).toHaveLength(2);
        for (let i = 0; i < 2; i++) await act(async () => blue()[i].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        await act(async () => mockSession.travel('undo'));
        expect(mockSession.currentDocument()).toEqual(before);
        expect(blue().map(n => n.props.accessibilityState.selected)).toEqual([true, true]);
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === 'Blue hue')).toHaveLength(1);
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'image' && n.props.accessibilityLabel === 'Curve for Blue: 2 points')).toHaveLength(1);
    });
    test('reselecting Image retains the second image without revision, history or dirty change', async () => {
        const tl: Timeline = timeline();
        for (const id of ['first', 'second']) tl.media[id] = { id, kind: 'image', frames: 90, name: id, width: 50, height: 50, hasAudio: false };
        tl.video[1].background = { ...BACKGROUND_DEFAULTS, type: 'image', mediaId: 'second' };
        await open(tl as ReturnType<typeof timeline>);
        const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        await press('Effects'); await press('Image');
        expect((mockSession.currentDocument()!.timeline as Timeline).video[1].background!.mediaId).toBe('second');
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.getEditRevision()).toBe(revision);
        expect(mockSession.history.canUndo).toBe(false); expect(mockSession.dirty).toBe(false);
    });
    test('unchanged background swatch and hex blur commit nothing', async () => {
        const tl: Timeline = timeline(); tl.background = '#aabbcc';
        tl.video[1].background = { ...BACKGROUND_DEFAULTS, type: 'solid', color: '#aabbcc' };
        await open(tl as ReturnType<typeof timeline>);
        const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        const background = jest.spyOn(lookEdit, 'backgroundSet');
        await press('Effects'); await press(t('editorTools.colourSwatch', { hex: '#aabbcc' }));
        const input = root.container.queryAll(n => typeof n.props.onEndEditing === 'function')[0];
        expect(input).toBeDefined();
        await act(async () => input.props.onEndEditing({ nativeEvent: { text: '#AABBCC' } }));
        expect(background).not.toHaveBeenCalled(); background.mockRestore();
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.getEditRevision()).toBe(revision);
        expect(mockSession.history.canUndo).toBe(false); expect(mockSession.dirty).toBe(false);
    });
    test('transition duration stays disabled until a transition is selected', async () => {
        await open(); await press('Transitions');
        const duration = () => root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === 'Duration')[0];
        expect(duration().props.accessibilityState.disabled).toBe(true);
        await press('Dissolve'); expect(duration().props.accessibilityState.disabled).toBe(false);
        await press('No transition'); expect(duration().props.accessibilityState.disabled).toBe(true);
    });
    test('locked tracks allow HSL and curve channel inspection while keeping values disabled', async () => {
        const tl = timeline(); tl.tracks[0].locked = true;
        await open(tl); await press('Filters');
        const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        const blue = () => root.container.queryAll(n => n.props.accessibilityLabel === 'Blue' && typeof n.props.onClick === 'function');
        expect(blue()).toHaveLength(2);
        for (let i = 0; i < 2; i++) {
            expect(blue()[i].props.accessibilityState.disabled).not.toBe(true);
            await act(async () => blue()[i].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        }
        for (const key of ['hue', 'saturation', 'luminance']) {
            const slider = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === `Blue ${key}`)[0];
            expect(slider.props.accessibilityState.disabled).toBe(true);
        }
        const curve = root.container.queryAll(n => n.props.accessibilityRole === 'image' && n.props.accessibilityLabel === 'Curve for Blue: 2 points')[0];
        expect(curve.props.accessibilityState.disabled).toBe(true);
        for (const label of ['Increase Point 1 output', 'Add point', 'Reset Blue curve']) {
            expect(root.container.queryAll(n => n.props.accessibilityLabel === label)[0].props.accessibilityState.disabled).toBe(true);
        }
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.getEditRevision()).toBe(revision);
        expect(mockSession.history.canUndo).toBe(false); expect(mockSession.dirty).toBe(false);
    });
    test.each([['Effects', 'Motion tiles', 'effect'], ['Effects', 'Screen', 'blend'],
        ['Transitions', 'Clock wipe', 'transitionType'], ['Effects', 'Solid', 'background']])('%s / %s creates exactly one undo entry', async (panel, label, field) => {
        await open(); const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        await press(panel); await press(label);
        expect(mockSession.getEditRevision()).toBe(revision + 1);
        expect((mockSession.currentDocument()!.timeline as Timeline).video[1]).toHaveProperty(field);
        await act(async () => mockSession.travel('undo'));
        expect(mockSession.currentDocument()).toEqual(before); expect(mockSession.history.canUndo).toBe(false);
    });
    test('non-adjacent transition has mapped error, no history and announced text', async () => {
        await open(); await act(async () => mockSession.setSelection({ track: 'video', id: 'v1' }));
        const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        await press('Transitions'); await press('Clock wipe');
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.getEditRevision()).toBe(revision);
        expect(mockSession.history.canUndo).toBe(false); expect(mockSession.problem).toBe(t('editorLook.notAdjacent'));
        expect(root.container.queryAll(n => n.props.accessibilityRole === 'alert' && n.children.includes(t('editorLook.notAdjacent'))).length).toBeGreaterThan(0);
    });
    test('locked panels disable every edit', async () => {
        const tl = timeline(); tl.tracks[0].locked = true;
        await open(tl); const before = mockSession.currentDocument();
        for (const panel of ['Effects', 'Filters', 'Transitions']) {
            await press(panel);
            expect(root.container.queryAll(n => n.children.includes(t('editorLook.locked'))).length).toBeGreaterThan(0);
            const sliders = root.container.queryAll(n => n.props.accessibilityRole === 'adjustable');
            for (const slider of sliders.filter(n => !['Playhead', 'Timeline zoom'].includes(n.props.accessibilityLabel))) {
                if (['Intensity', 'Brightness', 'Duration'].includes(slider.props.accessibilityLabel)) expect(slider.props.accessibilityState.disabled).toBe(true);
            }
            const buttonLabel = panel === 'Effects' ? 'Motion tiles' : panel === 'Filters' ? 'Reset colour' : 'Clock wipe';
            const button = root.container.queryAll(n => n.props.accessibilityLabel === buttonLabel)[0];
            expect(button.props.accessibilityState.disabled).toBe(true);
        }
        expect(mockSession.currentDocument()).toBe(before);
    });
    test('audio selection keeps a pre-existing effect and shows no look controls', async () => {
        const tl = timeline();
        tl.audio = [{ ...clip('a1'), trackId: 'audio-0', effect: { type: 'tiles', intensity: .5 } }];
        delete tl.audio[0].transition;
        await open(tl); await act(async () => mockSession.setSelection({ track: 'audio', id: 'a1' }));
        const before = mockSession.currentDocument();
        for (const panel of ['Effects', 'Filters', 'Transitions']) {
            await press(panel);
            expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Intensity')).toHaveLength(0);
            expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Brightness')).toHaveLength(0);
            expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Clock wipe')).toHaveLength(0);
        }
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.history.canUndo).toBe(false);
    });
    test('envelope refusal through a look action preserves document, undo and dirty', async () => {
        const doc = nearLimit(true), tl = doc.timeline as Timeline;
        tl.video = [clip('v1'), clip('v2', 90)];
        doc.brief = 'b'.repeat(32760 - (JSON.stringify(doc).length - doc.brief.length));
        await open(tl as ReturnType<typeof timeline>, doc);
        const before = mockSession.currentDocument(), revision = mockSession.getEditRevision();
        await press('Effects'); await press('Motion tiles');
        expect(mockSession.currentDocument()).toBe(before); expect(mockSession.history.canUndo).toBe(false);
        expect(mockSession.dirty).toBe(false); expect(mockSession.getEditRevision()).toBe(revision);
        expect(mockSession.problem).toBe(t('editorEditGate.tooLarge'));
    });
});

test.each([false, true])('parent renders with an unchanged clip skip curves and curve commits use the latest timeline (stored colour %s)', async storedColour => {
    const root = createRoot(), frameStore = createFrameStore(), timeline = emptyTimeline();
    timeline.media.m = { id: 'm', kind: 'video', frames: 900, width: 640, height: 360, hasAudio: true, name: 'Movie' };
    timeline.video = [{ id: 'v1', start: 0, len: 90, in: 0, trackId: 'video-0', mediaId: 'm', transition: 0, volume: 1 }];
    if (storedColour) timeline.video[0].colourAdjustment = { ...colourDefaults(), shadows: .2, gamma: 1.5 };
    const selection = { track: 'video' as const, id: 'v1' }, applyTimeline = jest.fn((_next: Timeline) => true), setProblem = jest.fn();
    let parentRenders = 0;
    function Harness({ timeline }: { timeline: Timeline }) {
        parentRenders++;
        const lookActions = useLookActions({ timeline, selection, frameStore, applyTimeline, setProblem });
        return <FiltersPanel {...{ timeline, selection, lookActions } as ToolPanelProps} />;
    }
    try {
        await act(async () => root.render(<Harness timeline={timeline} />));
        const curves = mockCurveRender.mock.calls.length, renders = parentRenders;
        const latest = { ...timeline, background: '#aabbcc' };
        expect(latest.video[0]).toBe(timeline.video[0]);
        await act(async () => root.render(<Harness timeline={latest} />));
        expect(parentRenders).toBe(renders + 1);
        expect(mockCurveRender).toHaveBeenCalledTimes(curves);
        const add = root.container.queryAll(n => n.props.accessibilityLabel === 'Add point' && typeof n.props.onClick === 'function');
        expect(add).toHaveLength(1);
        await act(async () => add[0].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
        expect(applyTimeline).toHaveBeenCalledTimes(1);
        const committed = applyTimeline.mock.calls[0][0];
        expect(committed.background).toBe(latest.background);
        expect(committed.video[0].colourAdjustment!.curves.master).toHaveLength(3);
        expect(setProblem).toHaveBeenCalledWith(null);
    } finally {
        await act(async () => root.unmount());
    }
});

test.each([false, true])('frame updates never render curves, with stored colour %s, and static filters never subscribe', async storedColour => {
    const root = createRoot(), frameStore = createFrameStore(), timeline = emptyTimeline();
    timeline.video = [{ id: 'v1', start: 0, len: 90, in: 0, trackId: 'video-0', mediaId: 'm', transition: 0, volume: 1 }];
    if (storedColour) timeline.video[0].colourAdjustment = { ...colourDefaults(), shadows: .2, gamma: 1.5 };
    const selection = { track: 'video' as const, id: 'v1' }, applyTimeline = jest.fn(() => true);
    const actions = useLookActions({ timeline, selection, frameStore, applyTimeline, setProblem: jest.fn() });
    const subscribe = jest.spyOn(frameStore, 'subscribe'), values = jest.spyOn(lookEdit, 'lookValues');
    const render = () => root.render(<FiltersPanel {...{ timeline, selection, lookActions: actions } as ToolPanelProps} />);
    await act(async () => render());
    expect(subscribe).not.toHaveBeenCalled();
    const curves = mockCurveRender.mock.calls.length, evaluated = values.mock.calls.length;
    for (const frame of [1, 15, 30, 89]) await act(async () => frameStore.set(frame));
    expect(mockCurveRender).toHaveBeenCalledTimes(curves); expect(values).toHaveBeenCalledTimes(evaluated);
    await act(async () => render()); expect(values).toHaveBeenCalledTimes(evaluated);
    timeline.video[0] = { ...timeline.video[0], parameterKeyframes: [parameterKeyframe(timeline.video[0], 0),
        { ...parameterKeyframe(timeline.video[0], 89), brightness: 2 }] };
    await act(async () => render()); expect(subscribe).toHaveBeenCalledTimes(1);
    const animatedRenders = mockCurveRender.mock.calls.length;
    for (const frame of [0, 15, 30, 89, 0]) await act(async () => frameStore.set(frame));
    expect(mockCurveRender).toHaveBeenCalledTimes(animatedRenders);
    expect(root.container.queryAll(n => n.props.accessibilityRole === 'adjustable' && n.props.accessibilityLabel === 'Brightness')[0]
        .props.accessibilityValue.now).toBe(1);
    await act(async () => root.unmount()); values.mockRestore(); subscribe.mockRestore();
});
