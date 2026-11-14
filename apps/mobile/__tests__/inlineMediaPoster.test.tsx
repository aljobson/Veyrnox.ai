import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { InlineMedia } from '../src/components/InlineMedia';

type Listener = (event: any) => void;
const listeners: Record<string, Listener[]> = {};
const mockPlayer: any = {
    status: 'readyToPlay', duration: 5, currentTime: 0, muted: true, loop: false,
    play: jest.fn(), pause: jest.fn(),
    generateThumbnailsAsync: jest.fn(async () => [{ id: 'frame' }]),
    addListener: (name: string, cb: Listener) => { (listeners[name] ??= []).push(cb); return { remove: () => { listeners[name] = listeners[name].filter(l => l !== cb); } }; },
};
const emit = (name: string, event: any = {}) => act(async () => { (listeners[name] ?? []).forEach(l => l(event)); });
jest.mock('expo-video', () => ({ useVideoPlayer: () => mockPlayer, VideoView: () => null }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
void [RN.View, RN.Pressable];
let root: Root;
const poster = () => root.container.queryAll(n => n.props.testID === 'inline-media-poster');
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); for (const k of Object.keys(listeners)) delete listeners[k]; root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); });

test('a video shows a frame from half a second in before play and again after it ends', async () => {
    await act(async () => root.render(<InlineMedia url="https://file" label="Play video" />));
    expect(mockPlayer.generateThumbnailsAsync).toHaveBeenCalledWith([0.5], expect.anything());
    expect(poster()).toHaveLength(1);
    await emit('playingChange', { isPlaying: true });
    expect(poster()).toHaveLength(0);
    await emit('playingChange', { isPlaying: false });
    expect(poster()).toHaveLength(0);
    await emit('playToEnd');
    expect(poster()).toHaveLength(1);
});
test('audio takes no poster', async () => {
    await act(async () => root.render(<InlineMedia url="https://file" label="Play audio" audio />));
    expect(mockPlayer.generateThumbnailsAsync).not.toHaveBeenCalled();
    expect(poster()).toHaveLength(0);
});
