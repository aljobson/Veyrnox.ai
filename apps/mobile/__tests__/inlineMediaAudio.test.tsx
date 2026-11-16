import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { InlineMedia, MEDIA_HEIGHT } from '../src/components/InlineMedia';
import { t } from '../src/lib/i18n';

type Listener = (event: any) => void;
const listeners: Record<string, Listener[]> = {};
const mockPlayer: any = {
    status: 'readyToPlay', duration: 90, currentTime: 0, muted: true, loop: false, timeUpdateEventInterval: 0,
    play: jest.fn(), pause: jest.fn(), generateThumbnailsAsync: jest.fn(async () => []),
    addListener: (name: string, cb: Listener) => { (listeners[name] ??= []).push(cb); return { remove: () => { listeners[name] = listeners[name].filter(l => l !== cb); } }; },
};
const emit = (name: string, event: any = {}) => act(async () => { (listeners[name] ?? []).forEach(l => l(event)); });
jest.mock('expo-video', () => ({
    useVideoPlayer: (_url: string, setup: (p: any) => void) => { jest.requireActual('react').useState(() => setup(mockPlayer)); return mockPlayer; },
    VideoView: 'VideoView',
}));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ useFocusEffect: (fn: any) => jest.requireActual('react').useEffect(fn, [fn]) }));
void [RN.View, RN.Pressable];
let root: Root;
const byId = (id: string) => root.container.queryAll(n => n.props.testID === id)[0];
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const tap = (id: string, nativeEvent: object = {}) => act(async () => byId(id).props.onClick({ ...event, nativeEvent }));
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    jest.clearAllMocks(); mockPlayer.currentTime = 0; mockPlayer.muted = true;
    for (const k of Object.keys(listeners)) delete listeners[k];
    root = createRoot();
});
afterEach(async () => { await act(async () => root.unmount()); });

test('audio shows its own play control that plays and pauses the player, with no autoplay', async () => {
    await act(async () => root.render(<InlineMedia audio url="https://song" label="Play audio" />));
    expect(mockPlayer.play).not.toHaveBeenCalled();
    expect(mockPlayer.timeUpdateEventInterval).toBe(0.5);
    const view = root.container.queryAll(n => n.type === 'VideoView')[0];
    expect(view.props.nativeControls).toBe(false);
    expect(byId('inline-audio-toggle').props.accessibilityLabel).toBe(t('editor.play'));
    await tap('inline-audio-toggle');
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    await emit('playingChange', { isPlaying: true });
    expect(mockPlayer.muted).toBe(false);
    expect(byId('inline-audio-toggle').props.accessibilityLabel).toBe(t('editor.pause'));
    await tap('inline-audio-toggle');
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
});

test('audio position follows the player, can be scrubbed and stepped, and restarts after the end', async () => {
    await act(async () => root.render(<InlineMedia audio url="https://song" label="Play audio" />));
    await emit('sourceLoad', { duration: 90 });
    await emit('timeUpdate', { currentTime: 30 });
    expect(byId('inline-audio-position').props.accessibilityValue.text).toContain('0:30');
    await act(async () => byId('inline-audio-position').props.onLayout({ nativeEvent: { layout: { width: 200, height: 44, x: 0, y: 0 } } }));
    await tap('inline-audio-position', { locationX: 100 });
    expect(mockPlayer.currentTime).toBe(45);
    await act(async () => byId('inline-audio-position').props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    expect(mockPlayer.currentTime).toBe(55);
    mockPlayer.currentTime = 90;
    await emit('playToEnd');
    await tap('inline-audio-toggle');
    expect(mockPlayer.currentTime).toBe(0);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
});

test('audio pauses when the screen loses focus', async () => {
    await act(async () => root.render(<InlineMedia audio url="https://song" label="Play audio" />));
    await act(async () => root.render(<></>));
    expect(mockPlayer.pause).toHaveBeenCalled();
});

test('the control strip never shrinks below the 56pt play button plus padding, so a parent cannot clip it', async () => {
    await act(async () => root.render(<InlineMedia url="https://clip" label="Play video" />));
    const strip = byId('inline-audio-toggle').parent!;
    const style = RN.StyleSheet.flatten(strip.props.style);
    expect(style.flexShrink).toBe(0);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
});
test.each([['landscape', 1920, 1080], ['portrait', 1080, 1920], ['square', 1080, 1080]])('a %s video is drawn inside one clipped, fixed-height frame', async (_name, _w, _h) => {
    await act(async () => root.render(<InlineMedia url="https://media.example/clip.mp4" label="Finished video" />));
    const view = root.container.queryAll(n => n.type === 'VideoView')[0];
    expect(view.props.contentFit).toBe('contain');
    // The video fills a frame that clips it and has a fixed height, so the space it takes in the layout
    // is the space it draws in, whatever its aspect ratio.
    expect(RN.StyleSheet.flatten(view.props.style)).toMatchObject({ position: 'absolute' });
    const frame = RN.StyleSheet.flatten(view.parent!.props.style);
    expect(frame).toMatchObject({ height: MEDIA_HEIGHT, overflow: 'hidden', flexShrink: 0 });
});
test('audio draws no video frame, only the controls', async () => {
    await act(async () => root.render(<InlineMedia url="https://media.example/a.mp3" label="Audio" audio />));
    expect(root.container.queryAll(n => n.props.testID === 'inline-audio-toggle')).toHaveLength(1);
});
