import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'test-renderer';
import * as RN from 'react-native';
import { BeatSongLibrarySheet } from '../src/components/beats/BeatSongLibrarySheet';
import { BeatEditorTransport } from '../src/components/beats/BeatEditorTransport';
import { BeatSongLibraryError, type BeatLibrarySong, type BeatSongLibrarySession, type PreparedRemoteSong } from '../src/lib/beatNative/songLibrary';
import { position } from '../src/lib/beatNative/regionActions';
import { setLocaleFromDevice, t } from '../src/lib/i18n';
import type { AudioAsset } from '../src/lib/beatNative/labs';

const first: BeatLibrarySong = { id: 'song-1:version-1', source: 'song', name: 'Moon Garden', bpm: null,
    ref: { songId: 'song-1', versionId: 'version-1', jobId: 'job-1' } };
const second: BeatLibrarySong = { id: 'song-2:version-2', source: 'song', name: 'Solar Lines', bpm: null,
    ref: { songId: 'song-2', versionId: 'version-2', jobId: 'job-2' } };
const asset: AudioAsset = { source: 'song', ref: { songId: 'song-1', versionId: 'version-1', jobId: 'job-1' },
    name: first.name, durationSec: 12, bpm: null, sourceChannels: 2, encodedBytes: 4096 };

let mockSession: jest.Mocked<BeatSongLibrarySession>;
const mockAuth = { api: {}, generation: 0, beginSessionTask: jest.fn() };
let mockFocused = true;
let mockFocusVersion = 0;
const mockAppStateListeners = new Set<(state: RN.AppStateStatus) => void>();
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => mockAuth }));
jest.mock('../src/lib/beatNative/songLibraryNative', () => ({ createNativeBeatSongLibrarySession: () => mockSession }));
jest.mock('../src/components/VeyCharacter', () => ({ VeyCharacter: () => null }));
jest.mock('expo-router', () => ({
    useFocusEffect: (effect: () => void | (() => void)) => {
        const React = require('react');
        React.useEffect(() => mockFocused ? effect() : undefined, [effect, mockFocused, mockFocusVersion]);
    },
}));

function session(rows: readonly BeatLibrarySong[] = [first, second]): jest.Mocked<BeatSongLibrarySession> {
    return {
        current: jest.fn(() => true), assertCurrent: jest.fn(),
        list: jest.fn(async () => rows),
        prepare: jest.fn(async () => ({ asset, buffer: { numberOfChannels: 2, sampleRate: 48000, length: 576000 } })),
        togglePreview: jest.fn(async () => 'playing' as const),
        stopPreview: jest.fn(), dispose: jest.fn(),
    } as unknown as jest.Mocked<BeatSongLibrarySession>;
}

let root: Root;
const node = (id: string) => root.container.queryAll(item => item.props.testID === id)[0];
const status = () => node('beat-song-library-status').props.accessibilityLabel;
const control = (label: string) => root.container.queryAll(item => item.props.accessibilityLabel === label
    && typeof (item.props.onClick ?? item.props.onPress) === 'function')[0];
const field = () => root.container.queryAll(item => item.props.accessibilityLabel === t('beat.library.search') && typeof item.props.onChangeText === 'function')[0];
const press = async (label: string) => {
    const button = control(label); if (!button) throw new Error(`Missing ${label}`);
    await act(async () => (button.props.onClick ?? button.props.onPress)({ nativeEvent: {} }));
};
const props = (patch: Partial<ComponentProps<typeof BeatSongLibrarySheet>> = {}): ComponentProps<typeof BeatSongLibrarySheet> => ({
    layout: 'compact', disabled: false, placement: () => ({ start: 960, trackId: null }),
    onCommit: () => true, onClose: jest.fn(), onDismiss: jest.fn(), ...patch,
});
async function render(input = props()) {
    await act(async () => { root.render(<BeatSongLibrarySheet {...input} />); await Promise.resolve(); });
    return input;
}
async function rerender(input: ComponentProps<typeof BeatSongLibrarySheet>) {
    await act(async () => { root.render(<BeatSongLibrarySheet {...input} />); await Promise.resolve(); });
}
async function appState(value: RN.AppStateStatus) {
    await act(async () => {
        RN.AppState.currentState = value;
        for (const listener of [...mockAppStateListeners]) listener(value);
        await Promise.resolve();
    });
}

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    setLocaleFromDevice(['en']); mockSession = session(); root = createRoot(); jest.clearAllMocks();
    mockAuth.generation = 0; mockFocused = true; mockFocusVersion = 0; mockAppStateListeners.clear();
    RN.AppState.currentState = 'active';
    jest.mocked(RN.AppState.addEventListener).mockImplementation((_event, listener) => {
        mockAppStateListeners.add(listener); return { remove: () => mockAppStateListeners.delete(listener) };
    });
});
afterEach(async () => { await act(async () => root.unmount()); setLocaleFromDevice(['en']); });

test.each(['compact', 'accessible'] as const)('%s is an exact one-column layout without a detail pane or horizontal scroller', async layout => {
    await render(props({ layout }));
    expect(node(`beat-song-library-layout-${layout}`)).toBeDefined();
    expect(node('beat-song-library-list-pane')).toBeDefined();
    expect(node('beat-song-library-detail-pane')).toBeUndefined();
    expect(root.container.queryAll(item => item.props.horizontal === true)).toHaveLength(0);
    expect(node(`beat-song-library-title-${first.id}`).props.children).toBe(first.name);
    expect(control(first.name)).toBeUndefined();
});

test('inline mode stays in one bounded dock workspace even at regular width', async () => {
    await render(props({ layout: 'regular', inline: true }));
    expect(node('beat-song-library-inline')).toBeDefined();
    expect(node('beat-song-library-layout-inline')).toBeDefined();
    expect(node('beat-song-library-detail-pane')).toBeUndefined();
    expect(node('beat-song-library-back')).toBeDefined();
    expect(root.container.queryAll(item => item.props.transparent && item.props.presentationStyle === 'overFullScreen')).toHaveLength(0);
});

test('focused compact inline mode uses one horizontal rail so Back, Search, status, Retry and rows cannot be vertically clipped', async () => {
    await render(props({ inline: true, compact: true }));
    expect(RN.StyleSheet.flatten(node('beat-song-library-inline').props.style).height).toBe('100%');
    expect(node('beat-song-library-compact-rail').props.horizontal).toBe(true);
    expect(node('beat-song-library-back')).toBeDefined();
    expect(field()).toBeDefined();
    expect(RN.StyleSheet.flatten(node(`beat-song-library-row-${first.id}`).props.style).minHeight).toBe(44);
});

test('real compact Library remains horizontally reachable inside a 71pt keyboard transport tray', async () => {
    const keyboardCallbacks: Record<string, (event?: any) => void> = {};
    const keyboardSpy = jest.spyOn(RN.Keyboard, 'addListener').mockImplementation(((event: string, callback: (event?: any) => void) => {
        keyboardCallbacks[event] = callback;
        return { remove: jest.fn() };
    }) as typeof RN.Keyboard.addListener);
    const library = props({ inline: true, compact: true });
    await act(async () => {
        root.render(<BeatEditorTransport playing={false} starting={false} locked={false} availableHeight={160} compactViewport
            showPatterns={false} showHistory={false} pattern="A" patternDisabled={false} canUndo canRedo
            onPattern={jest.fn()} onPatternControls={jest.fn()} onUndo={jest.fn()} onRedo={jest.fn()} onPlay={jest.fn()}
            onMixer={jest.fn()} subMenuFillsBudget subMenuLabel={t('beat.library.open')}
            subMenu={<BeatSongLibrarySheet {...library} />} />);
        await Promise.resolve();
    });
    await act(async () => keyboardCallbacks.keyboardWillShow?.({ endCoordinates: { height: 200 } }));
    const viewport = node('beat-editor-submenu-viewport');
    expect(RN.StyleSheet.flatten(viewport.props.style).height).toBe(71);
    expect(node('beat-song-library-compact-rail').props.horizontal).toBe(true);
    expect(node(`beat-song-library-row-${first.id}`)).toBeDefined();
    keyboardSpy.mockRestore();
});

test('compact rail keeps a retryable loading failure in the same reachable row', async () => {
    mockSession.list.mockRejectedValueOnce(new BeatSongLibraryError('offline'));
    await render(props({ inline: true, compact: true }));
    expect(node('beat-song-library-compact-rail').props.horizontal).toBe(true);
    expect(node('beat-song-library-retry')).toBeDefined();
    expect(status()).toBe(t('beat.library.error.offline'));
});

test('a locked inline Library explains the actual editor lock instead of a generic read-only state', async () => {
    await render(props({ inline: true, disabled: true, disabledReason: 'Finish replacing the current take.' }));
    expect(node('beat-song-library-read-only').props.children).toBe('Finish replacing the current take.');
});

test('regular layout keeps list then detail in logical order and never introduces horizontal scrolling', async () => {
    await render(props({ layout: 'regular' }));
    const layout = node('beat-song-library-layout-regular');
    const children = layout.children as any[];
    expect(children[0].props.testID).toBe('beat-song-library-list-pane');
    expect(children[1].props.testID).toBe('beat-song-library-detail-pane');
    expect(root.container.queryAll(item => item.props.horizontal === true)).toHaveLength(0);
    expect(root.container.queryAll(item => item.children.includes(first.name)).length).toBeGreaterThan(0);
    expect(control(first.name).props.accessibilityState.selected).toBe(true);
    expect(root.container.queryAll(item => item.children.includes(t('beat.library.destination', { position: position(960) })))).toHaveLength(1);
    expect(root.container.queryAll(item => item.children.includes(t('beat.library.addNamed', { name: first.name, position: position(960) }))).length).toBeGreaterThan(0);
});

test('RTL keeps the regular list first and delegates direction without a reversed row or horizontal scroller', async () => {
    setLocaleFromDevice(['ar']);
    await render(props({ layout: 'regular' }));
    const layout = node('beat-song-library-layout-regular'), children = layout.children as any[];
    expect(children.map(child => child.props.testID)).toEqual(['beat-song-library-list-pane', 'beat-song-library-detail-pane']);
    expect(RN.StyleSheet.flatten(layout.props.style).flexDirection).toBe('row');
    expect(RN.StyleSheet.flatten(layout.props.style).direction).toBeUndefined();
    expect(root.container.queryAll(item => item.props.horizontal === true)).toHaveLength(0);
});

test('loading becomes a localized empty state without showing an error or blank sheet', async () => {
    let finish!: (rows: readonly BeatLibrarySong[]) => void;
    mockSession.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    expect(status()).toBe(t('beat.library.loading'));
    expect(root.container.queryAll(item => item.children.includes(t('beat.library.empty.title')))).toHaveLength(0);
    await act(async () => finish([]));
    expect(root.container.queryAll(item => item.children.includes(t('beat.library.empty.title')))).toHaveLength(1);
});

test('local search reports exact bounded counts, filters rows and always offers Clear for an empty result', async () => {
    await render();
    expect(status()).toBe(t('beat.library.count', { count: 2, shown: 2 }));
    await act(async () => field().props.onChangeText('solar'));
    expect(status()).toBe(t('beat.library.count', { count: 2, shown: 1 }));
    expect(node(`beat-song-library-row-${first.id}`)).toBeUndefined();
    expect(node(`beat-song-library-row-${second.id}`)).toBeDefined();
    await act(async () => field().props.onChangeText('nothing'));
    expect(root.container.queryAll(item => item.children.includes(t('beat.library.searchEmpty', { query: 'nothing' })))).toHaveLength(1);
    await press(t('beat.library.clear'));
    expect(field().props.value).toBe(''); expect(node(`beat-song-library-row-${first.id}`)).toBeDefined();
});

test('read-only keeps browsing and audition active while Add has visible and semantic disabled state', async () => {
    await render(props({ disabled: true }));
    expect(node('beat-song-library-read-only').props.children).toBe(t('beat.library.readOnly'));
    expect(control(t('beat.library.auditionNamed', { name: first.name })).props.accessibilityState.disabled).toBe(false);
    expect(control(t('beat.library.addNamed', { name: first.name, position: position(960) })).props.accessibilityState.disabled).toBe(true);
    await press(t('beat.library.auditionNamed', { name: first.name }));
    expect(mockSession.togglePreview).toHaveBeenCalledWith(first, expect.any(AbortSignal), expect.any(Function), expect.any(Function));
});

test('audition exposes Preparing and Playing cues, and re-tapping Stop owns the exclusive preview', async () => {
    let finish!: (value: 'playing') => void;
    mockSession.togglePreview.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => { void (control(t('beat.library.auditionNamed', { name: first.name })).props.onClick
        ?? control(t('beat.library.auditionNamed', { name: first.name })).props.onPress)({ nativeEvent: {} }); });
    expect(status()).toBe(t('beat.library.preparing', { name: first.name }));
    await act(async () => finish('playing'));
    expect(status()).toBe(t('beat.library.playing', { name: first.name }));
    await press(t('beat.library.stopNamed', { name: first.name }));
    expect(mockSession.stopPreview).toHaveBeenCalled();
});

test('Add captures placement, rechecks the session, commits once, and leaves success announcement to the route', async () => {
    const placement = jest.fn(() => ({ start: 960, trackId: 'audio-track' }));
    const onCommit = jest.fn(() => true), onClose = jest.fn();
    await render(props({ placement, onCommit, onClose })); placement.mockClear();
    await press(t('beat.library.addNamed', { name: first.name, position: position(960) }));
    expect(placement).toHaveBeenCalled();
    expect(mockSession.prepare).toHaveBeenCalledWith(first, expect.any(AbortSignal));
    expect(mockSession.assertCurrent).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(mockSession.assertCurrent.mock.invocationCallOrder[0]).toBeLessThan(onCommit.mock.invocationCallOrder[0]);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(asset, { start: 960, trackId: 'audio-track' });
    expect(RN.AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(t('beat.library.added', { name: first.name, position: position(960) }));
    expect(onClose).toHaveBeenCalledTimes(1);
});

test('a lock change aborts an in-flight Add and publishes a recoverable inline status', async () => {
    let finish!: (value: PreparedRemoteSong) => void;
    mockSession.prepare.mockImplementationOnce((_item, signal) => new Promise(resolve => {
        expect(signal.aborted).toBe(false); finish = resolve;
    }));
    const onCommit = jest.fn(() => true);
    const input = props({ onCommit });
    await render(input);
    await act(async () => { void (control(t('beat.library.addNamed', { name: first.name, position: position(960) })).props.onClick
        ?? control(t('beat.library.addNamed', { name: first.name, position: position(960) })).props.onPress)({ nativeEvent: {} }); });
    const signal = mockSession.prepare.mock.calls[0][1];
    expect(status()).toBe(t('beat.library.adding', { name: first.name, position: position(960) }));
    await rerender({ ...input, disabled: true });
    expect(signal.aborted).toBe(true);
    expect(status()).toBe(t('beat.library.addRefused'));
    expect(node('beat-song-library-read-only')).toBeDefined();
    await act(async () => finish({ asset, buffer: { numberOfChannels: 2, sampleRate: 48000, length: 576000 } }));
    expect(onCommit).not.toHaveBeenCalled();
});

test('refused Add remains recoverable and initial typed errors render exact copy and Retry policy', async () => {
    const onClose = jest.fn();
    await render(props({ onCommit: () => false, onClose }));
    await press(t('beat.library.addNamed', { name: first.name, position: position(960) }));
    expect(onClose).not.toHaveBeenCalled();
    expect(status()).toBe(t('beat.library.addRefused'));
    await act(async () => root.unmount()); root = createRoot();
    mockSession = session(); mockSession.list.mockRejectedValueOnce(new BeatSongLibraryError('offline'));
    await render();
    expect(status()).toBe(t('beat.library.error.offline'));
    expect(control(t('beat.library.retry'))).toBeDefined();
});

test('refresh retains rows and reports progress; close/system dismiss preserve the focus-restoration contract', async () => {
    let finish!: (rows: readonly BeatLibrarySong[]) => void;
    await render();
    mockSession.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => node('beat-song-library-list').props.onRefresh());
    expect(node(`beat-song-library-row-${first.id}`)).toBeDefined();
    expect(status()).toBe(t('beat.library.refreshing'));
    await act(async () => finish([first, second]));
    const order: string[] = [];
    const close = jest.fn(() => order.push('close')), dismiss = jest.fn(() => order.push('dismiss'));
    await act(async () => { root.unmount(); root = createRoot(); }); mockSession = session();
    await render(props({ onClose: close, onDismiss: dismiss }));
    await press(t('beat.library.close')); expect(close).toHaveBeenCalledTimes(1); expect(mockSession.dispose).toHaveBeenCalled();
    expect(order).toEqual(['close']);
    const modal = root.container.queryAll(item => typeof item.props.onDismiss === 'function')[0];
    modal.props.onDismiss(); expect(dismiss).toHaveBeenCalledTimes(1); expect(order).toEqual(['close', 'dismiss']);
});

test('blur disposes the focused lifetime and refocus creates a fresh session', async () => {
    const input = props(); const firstSession = mockSession;
    await render(input);
    mockFocused = false; ++mockFocusVersion; await rerender(input);
    expect(firstSession.dispose).toHaveBeenCalledTimes(1);
    const next = session([second]); mockSession = next;
    mockFocused = true; ++mockFocusVersion; await rerender(input);
    expect(next.list).toHaveBeenCalledTimes(1);
    expect(node(`beat-song-library-row-${second.id}`)).toBeDefined();
});

test('background teardown and foreground recreation use a new lifetime only while focused', async () => {
    const firstSession = mockSession;
    await render();
    await appState('background');
    expect(firstSession.dispose).toHaveBeenCalledTimes(1);
    const next = session([second]); mockSession = next;
    await appState('active');
    expect(next.list).toHaveBeenCalledTimes(1);
});

test('auth generation change replaces the focused session and fences its pending list', async () => {
    let finish!: (rows: readonly BeatLibrarySong[]) => void;
    mockSession.list.mockImplementationOnce(signal => new Promise(resolve => {
        expect(signal.aborted).toBe(false); finish = resolve;
    }));
    const firstSession = mockSession, input = props();
    await render(input);
    const firstSignal = firstSession.list.mock.calls[0][0];
    const next = session([second]); mockSession = next; ++mockAuth.generation;
    await rerender(input);
    expect(firstSession.dispose).toHaveBeenCalledTimes(1);
    expect(firstSignal.aborted).toBe(true);
    expect(next.list).toHaveBeenCalledTimes(1);
    await act(async () => finish([first]));
});

test('unmount aborts and disposes a pending focused lifetime without late publication', async () => {
    let finish!: (rows: readonly BeatLibrarySong[]) => void;
    mockSession.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const current = mockSession;
    await render();
    const signal = current.list.mock.calls[0][0];
    await act(async () => root.unmount());
    expect(signal.aborted).toBe(true);
    expect(current.dispose).toHaveBeenCalledTimes(1);
    await act(async () => finish([first]));
});

test('preview error callbacks cannot be overwritten as Playing and Add supersedes pending preview', async () => {
    mockSession.togglePreview.mockImplementationOnce(async (_item, _signal, _ended, onError) => {
        onError?.(new BeatSongLibraryError('invalidMedia')); return 'playing';
    });
    await render();
    await press(t('beat.library.auditionNamed', { name: first.name }));
    expect(status()).toBe(t('beat.library.error.invalidMedia'));

    let finish!: (value: 'playing') => void;
    let staleError!: (error: BeatSongLibraryError) => void;
    mockSession.togglePreview.mockImplementationOnce((_item, _signal, _ended, onError) => new Promise(resolve => {
        finish = resolve; staleError = onError!;
    }));
    await press(t('beat.library.auditionNamed', { name: second.name }));
    const previewSignal = mockSession.togglePreview.mock.calls[1][1];
    const onCommit = jest.fn(() => false);
    await rerender(props({ onCommit }));
    await press(t('beat.library.addNamed', { name: first.name, position: position(960) }));
    expect(previewSignal.aborted).toBe(true);
    expect(mockSession.stopPreview).toHaveBeenCalled();
    await act(async () => { staleError(new BeatSongLibraryError('invalidMedia')); finish('playing'); });
    expect(status()).toBe(t('beat.library.addRefused'));
});

test('a failed immediate current check prevents the commit and leaves a typed recoverable error', async () => {
    const onCommit = jest.fn(() => true), onClose = jest.fn();
    mockSession.assertCurrent.mockImplementationOnce(() => { throw new BeatSongLibraryError('accountChanged'); });
    await render(props({ onCommit, onClose }));
    await press(t('beat.library.addNamed', { name: first.name, position: position(960) }));
    expect(mockSession.prepare).toHaveBeenCalledTimes(1);
    expect(mockSession.assertCurrent).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(RN.AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalledWith(expect.stringContaining(first.name));
    expect(status()).toBe(t('beat.library.error.accountChanged'));
});

test('one global live region owns status changes while row cues remain visible and non-live', async () => {
    await render();
    await press(t('beat.library.auditionNamed', { name: first.name }));
    expect(root.container.queryAll(item => item.props.accessibilityLiveRegion != null)).toHaveLength(1);
    expect(root.container.queryAll(item => item.children.includes(t('beat.library.playing', { name: first.name })))).not.toHaveLength(0);
    expect(root.container.queryAll(item => item.children.includes(t('beat.library.playing', { name: first.name }))
        && item.props.accessibilityLiveRegion != null)).toHaveLength(0);
});
