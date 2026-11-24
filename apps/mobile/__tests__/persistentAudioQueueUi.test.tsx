import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { PersistentAudioQueueProvider, usePersistentAudioQueue } from '../src/components/music/PersistentAudioQueue';
import { claimAudioFocus, resetAudioFocusForTests } from '../src/lib/audioFocus';

let mockOwner: string | undefined = 'account-a';
function mockListeners(): Set<() => void> {
    return ((globalThis as any).__persistentAudioQueueOwnerListeners ??= new Set<() => void>());
}
const mockDocuments = new Map<string, string>();
const mockGetEntitlements = jest.fn();
const mockGetAsset = jest.fn();
const mockPlayers: any[] = [];

jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: {} }) }));
jest.mock('../src/lib/appCache', () => ({
    getCacheUser: () => mockOwner,
    subscribeCacheUser: (listener: () => void) => { mockListeners().add(listener); return () => mockListeners().delete(listener); },
    userDocStorage: {
        get: async (key: string) => mockDocuments.get(key) ?? null,
        set: async (key: string, value: string) => void mockDocuments.set(key, value),
        remove: async (key: string) => void mockDocuments.delete(key),
        keys: async () => [...mockDocuments.keys()],
    },
}));
jest.mock('../src/lib/music/client', () => ({ getEntitlements: (...args: unknown[]) => mockGetEntitlements(...args) }));
jest.mock('../src/lib/media', () => ({ mediaApi: () => ({ getAsset: (...args: unknown[]) => mockGetAsset(...args) }) }));
jest.mock('../src/lib/config', () => ({ config: { apiBase: 'https://api.example' } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 12 }) }));
jest.mock('expo-audio', () => ({
    setAudioModeAsync: jest.fn(async () => undefined),
    createAudioPlayer: jest.fn((source: { uri: string }) => {
        const listeners: Record<string, (value: any) => void> = {};
        const player = { source, play: jest.fn(), pause: jest.fn(), remove: jest.fn(), seekTo: jest.fn(async () => undefined),
            addListener: jest.fn((name: string, listener: (value: any) => void) => { listeners[name] = listener; return { remove: jest.fn() }; }), listeners };
        mockPlayers.push(player); return player;
    }),
}));

void RN.View;
let root: Root;
let queue: ReturnType<typeof usePersistentAudioQueue>;
function Probe() { queue = usePersistentAudioQueue(); return <RN.Text testID="queue-capability">{queue?.capability}</RN.Text>; }
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const press = async (label: string) => {
    const control = root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
    await act(async () => { control.props.onClick({ nativeEvent: {} }); await Promise.resolve(); await Promise.resolve(); });
};

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    resetAudioFocusForTests();
    root = createRoot(); mockOwner = 'account-a'; mockDocuments.clear(); mockPlayers.length = 0; mockGetEntitlements.mockReset(); mockGetAsset.mockReset();
    RN.AppState.currentState = 'active';
    jest.spyOn(RN.AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() } as any);
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });

test('loading, unknown and explicit off keep the iOS queue hidden without exposing public enqueue', async () => {
    mockGetEntitlements.mockRejectedValueOnce(new Error('offline'));
    await act(async () => root.render(<PersistentAudioQueueProvider><Probe /></PersistentAudioQueueProvider>)); await flush();
    expect(queue?.capability).toBe('unknown'); expect(queue?.publicEnabled).toBe(false); expect(queue?.ownedEnabled).toBe(false);
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Listening queue')).toHaveLength(0);

    await act(async () => root.unmount()); root = createRoot();
    mockGetEntitlements.mockResolvedValueOnce({ features: { persistentQueue: false } });
    await act(async () => root.render(<PersistentAudioQueueProvider><Probe /></PersistentAudioQueueProvider>)); await flush();
    expect(queue?.capability).toBe('off'); expect(queue?.publicEnabled).toBe(false); expect(queue?.ownedEnabled).toBe(false);
});

test('enabled queue persists across navigation, disposes synchronously on account change and resolves media only on play', async () => {
    mockGetEntitlements.mockResolvedValue({ features: { persistentQueue: true } });
    mockGetAsset.mockResolvedValue({ url: 'https://signed.example/audio', mime_type: 'audio/mpeg' });
    await act(async () => root.render(<PersistentAudioQueueProvider><Probe /></PersistentAudioQueueProvider>)); await flush();
    expect(queue?.publicEnabled).toBe(true); expect(queue?.ownedEnabled).toBe(true);
    await act(async () => queue?.addOwned({ jobId: '12345678-1234-1234-1234-1234567890ab', title: 'Owned song', source: 'music' }));
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Listening queue')).toHaveLength(1);
    expect(mockGetAsset).not.toHaveBeenCalled();
    await press('Play');
    expect(mockGetAsset).toHaveBeenCalledWith('12345678-1234-1234-1234-1234567890ab'); expect(mockPlayers).toHaveLength(1);
    mockOwner = 'account-b';
    await act(async () => { for (const listener of mockListeners()) listener(); });
    expect(mockPlayers[0].pause).toHaveBeenCalled(); expect(mockPlayers[0].remove).toHaveBeenCalled();
    expect(root.container.queryAll(n => n.props.accessibilityLabel === 'Listening queue')).toHaveLength(0);
});

test('signed links refresh at twelve minutes, resume position and retry one failed URL once', async () => {
    let now = 1_000; jest.spyOn(Date, 'now').mockImplementation(() => now);
    mockGetEntitlements.mockResolvedValue({ features: { persistentQueue: true } });
    mockGetAsset.mockResolvedValue({ url: 'https://signed.example/audio', mime_type: 'audio/mpeg' });
    await act(async () => root.render(<PersistentAudioQueueProvider><Probe /></PersistentAudioQueueProvider>)); await flush();
    await act(async () => queue?.addOwned({ jobId: '12345678-1234-1234-1234-1234567890ab', title: 'Owned song', source: 'music' }));
    await press('Play'); expect(mockPlayers).toHaveLength(1);
    await act(async () => mockPlayers[0].listeners.playbackStatusUpdate({ currentTime: 42, didJustFinish: false, playbackState: 'ready', error: null }));
    await press('Pause'); now += 12 * 60_000 + 1; await press('Play');
    expect(mockPlayers).toHaveLength(2); expect(mockPlayers[1].seekTo).toHaveBeenCalledWith(42);
    await act(async () => { mockPlayers[1].listeners.playbackStatusUpdate({ currentTime: 42, didJustFinish: false, playbackState: 'error', error: 'expired' }); await Promise.resolve(); await Promise.resolve(); });
    expect(mockPlayers).toHaveLength(3);
    await act(async () => { mockPlayers[2].listeners.playbackStatusUpdate({ currentTime: 42, didJustFinish: false, playbackState: 'error', error: 'again' }); await Promise.resolve(); });
    expect(mockPlayers).toHaveLength(3); expect(mockPlayers[2].remove).toHaveBeenCalled();
});

test('focus taken while an owned asset is resolving cancels the pending queue player', async () => {
    let resolveAsset!: (value: { url: string; mime_type: string }) => void;
    mockGetEntitlements.mockResolvedValue({ features: { persistentQueue: true } });
    mockGetAsset.mockReturnValue(new Promise(resolve => { resolveAsset = resolve; }));
    await act(async () => root.render(<PersistentAudioQueueProvider><Probe /></PersistentAudioQueueProvider>)); await flush();
    await act(async () => queue?.addOwned({ jobId: '12345678-1234-1234-1234-1234567890ab', title: 'Owned song', source: 'music' }));
    await press('Play');
    expect(mockGetAsset).toHaveBeenCalledTimes(1);
    claimAudioFocus('another-player', jest.fn());
    resolveAsset({ url: 'https://signed.example/audio', mime_type: 'audio/mpeg' });
    await flush();
    expect(mockPlayers).toHaveLength(0);
});
