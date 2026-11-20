import { act, useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { useLibraryAudio } from '../src/lib/useLibraryAudio';
const listeners: Record<string, (event: any) => void> = {};
let mockBlur: () => void;
let mockUser: () => void;
const mockPlayer = {
    duration: 90, currentTime: 0, muted: true, loop: false, timeUpdateEventInterval: 0,
    play: jest.fn(), pause: jest.fn(), replaceAsync: jest.fn(async (_url: string | null) => {}),
    addListener: (name: string, cb: (event: any) => void) => { listeners[name] = cb; return { remove: () => { delete listeners[name]; } }; },
};
jest.mock('expo-video', () => ({ useVideoPlayer: (_url: any, setup: any) => { jest.requireActual('react').useState(() => setup(mockPlayer)); return mockPlayer; } }));
jest.mock('expo-router', () => ({ useFocusEffect: (cb: any) => jest.requireActual('react').useEffect(() => { mockBlur = cb(); return mockBlur; }, [cb]) }));
jest.mock('../src/lib/appCache', () => ({ subscribeCacheUser: (cb: any) => { mockUser = cb; return jest.fn(); } }));
const links = { request: jest.fn(async (id: string) => ({ kind: 'file' as const, url: `https://${id}`, mime: 'audio/mpeg', expiresAt: null })) };
let audio: ReturnType<typeof useLibraryAudio>;
function Harness() { const value = useLibraryAudio(links); useEffect(() => { audio = value; }); return null; }
let root: Root;
let background: (value: AppStateStatus) => void;
beforeEach(async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks();
    mockPlayer.currentTime = 0;
    mockPlayer.replaceAsync.mockImplementation(async () => {});
    links.request.mockImplementation(async id => ({ kind: 'file', url: `https://${id}`, mime: 'audio/mpeg', expiresAt: null }));
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => { background = cb; return { remove: jest.fn() }; });
    root = createRoot(); await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
const toggle = (id: string) => act(async () => audio.toggle(id));
test('pause, seek to 30, resume keeps the same source and position', async () => {
    await toggle('a');
    expect(mockPlayer.timeUpdateEventInterval).toBe(0.5);
    await act(async () => listeners.timeUpdate({ currentTime: 20 }));
    await toggle('a');
    expect(audio).toMatchObject({ loaded: 'a', playing: null, position: 20 });
    await act(async () => audio.seek(30));
    await toggle('a');
    expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);
    expect(links.request).toHaveBeenCalledTimes(1);
    expect(mockPlayer.currentTime).toBe(30);
    expect(audio).toMatchObject({ loaded: 'a', playing: 'a', position: 30 });
});
test('switching resets position and end retains the bar, then play restarts', async () => {
    await toggle('a'); await act(async () => audio.seek(30)); await toggle('b');
    expect(audio).toMatchObject({ loaded: 'b', playing: 'b', position: 0 });
    await act(async () => listeners.sourceLoad({ duration: 90 }));
    mockPlayer.currentTime = 90;
    await act(async () => listeners.playToEnd({}));
    expect(audio).toMatchObject({ loaded: 'b', playing: null, position: 90 });
    await toggle('b'); expect(mockPlayer.currentTime).toBe(0);
    expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(2);
});
test.each(['blur', 'background', 'user', 'unmount'])('%s clears loaded state and ignores late player events', async reason => {
    await toggle('a'); await act(async () => audio.seek(30));
    await act(async () => {
        if (reason === 'blur') mockBlur();
        if (reason === 'background') background('background');
        if (reason === 'user') mockUser();
        if (reason === 'unmount') root.unmount();
    });
    expect(mockPlayer.pause).toHaveBeenCalled();
    if (reason === 'unmount') { expect(Object.keys(listeners)).toHaveLength(0); return; }
    await act(async () => { listeners.timeUpdate({ currentTime: 44 }); listeners.sourceLoad({ duration: 110 }); listeners.playToEnd({}); });
    expect(audio).toMatchObject({ loaded: null, playing: null, position: 0, duration: 0 });
});
test.each(['blur', 'background', 'user', 'unmount'])('%s invalidates an in-flight asset lookup', async reason => {
    let resolve!: (value: any) => void;
    links.request.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    let pending!: Promise<void>;
    await act(async () => { pending = audio.toggle('a'); });
    await act(async () => {
        if (reason === 'blur') mockBlur();
        if (reason === 'background') background('inactive');
        if (reason === 'user') mockUser();
        if (reason === 'unmount') root.unmount();
    });
    await act(async () => { resolve({ kind: 'file', url: 'https://a' }); await pending; });
    expect(mockPlayer.play).not.toHaveBeenCalled();
    expect(mockPlayer.replaceAsync).not.toHaveBeenCalledWith('https://a');
});
test('overlapping replacements serialize and a stale failure cannot clear the next source', async () => {
    let reject!: (error: Error) => void;
    mockPlayer.replaceAsync.mockImplementationOnce(() => new Promise((_resolve, r) => { reject = r; }));
    let a!: Promise<void>, b!: Promise<void>;
    await act(async () => { a = audio.toggle('a'); });
    await act(async () => { b = audio.toggle('b'); });
    expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);
    await act(async () => { reject(new Error('old replacement failed')); await Promise.all([a, b]); });
    expect(audio).toMatchObject({ loaded: 'b', playing: 'b', position: 0 });
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

test('pausing just before the end does not restart; seeking after end resumes the chosen position', async () => {
    await toggle('a');
    await act(async () => audio.seek(89.99));
    await toggle('a'); await toggle('a');
    expect(mockPlayer.currentTime).toBe(89.99);
    await act(async () => listeners.playToEnd({}));
    await act(async () => audio.seek(30));
    await toggle('a');
    expect(mockPlayer.currentTime).toBe(30);
    expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);
});
