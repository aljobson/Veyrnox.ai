// Exercise the actual component's effect wiring without a native renderer. Mount effects and router
// focus effects have independent lifetimes: a focus cycle must never recreate the playback session.
const mockEffects: Array<() => void | (() => void)> = [];
const mockFocusEffects: Array<() => void | (() => void)> = [];
const mockSave = jest.fn(async (_position: number, _final: boolean) => undefined);
const mockRequest = jest.fn(async (_path: string, _init?: RequestInit) => ({
    token: 'head.body.sig', customer_code: 'abc', expires_at: new Date(900_000).toISOString(),
}));
const mockPlayer = {
    currentTime: 0, playing: false, keepScreenOnWhilePlaying: false,
    replaceAsync: jest.fn(async (_source: unknown) => undefined),
    play: jest.fn(() => { mockPlayer.playing = true; }),
    pause: jest.fn(() => { mockPlayer.playing = false; }),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
};

jest.mock('react', () => ({
    ...jest.requireActual('react'),
    useEffect: (effect: () => void | (() => void)) => { mockEffects.push(effect); },
    useCallback: (callback: unknown) => callback,
    useRef: (value: unknown) => ({ current: value }),
    useState: (value: unknown) => [value, jest.fn()],
}));
jest.mock('react-native', () => ({
    ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', View: 'View',
    StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
    AppState: { addEventListener: () => ({ remove: jest.fn() }) },
}));
jest.mock('expo-router', () => ({
    Link: 'Link',
    useFocusEffect: (effect: () => void | (() => void)) => { mockFocusEffects.push(effect); },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'test-key' }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: 'VideoView' }));
jest.mock('../src/auth/AuthProvider', () => ({ useAuth: () => ({ api: { request: mockRequest }, getAccessToken: jest.fn() }) }));
jest.mock('../src/lib/cinemaProgress', () => ({ getCinemaProgress: () => ({ recorder: () => mockSave, getUserId: () => 'alice' }) }));

import { CinemaPlayer } from '../src/components/cinema/CinemaPlayer';
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

test('one mount requests one initial play grant; blur saves progress and refocus does not mint again', async () => {
    jest.useFakeTimers(); jest.setSystemTime(0);
    const cleanup: Array<() => void> = [];
    let blur: void | (() => void) = undefined;
    try {
        CinemaPlayer({ contentId: '11111111-1111-4111-8111-111111111111', resumePosition: 23 });
        for (const effect of mockEffects) { const off = effect(); if (off) cleanup.push(off); }
        blur = mockFocusEffects[0](); await settle();
        expect(mockRequest.mock.calls.filter(([path]) => path === '/api/v1/cinema/play')).toHaveLength(1);
        expect(mockPlayer.currentTime).toBe(23);
        mockPlayer.currentTime = 42;
        if (blur) blur(); await settle();
        expect(mockSave).toHaveBeenLastCalledWith(42, true);
        expect(mockPlayer.pause).not.toHaveBeenCalled();
        blur = mockFocusEffects[0](); await settle();
        expect(mockRequest.mock.calls.filter(([path]) => path === '/api/v1/cinema/play')).toHaveLength(1);
        expect(mockPlayer.replaceAsync).toHaveBeenCalledTimes(1);
        expect(mockPlayer.currentTime).toBe(42);
    } finally {
        if (blur) blur();
        cleanup.forEach((off) => off());
        jest.clearAllTimers(); jest.useRealTimers();
    }
});
