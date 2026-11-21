import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { PresetCard } from '../src/components/home/PresetCard';
import { packFullRows } from '../src/lib/exploreTemplates';
import type { Preset } from '../src/lib/presets';

jest.mock('expo-image', () => ({ Image: 'PosterImage' }));
const mockPlay = jest.fn();
const mockPause = jest.fn();
let mockStatus: ((event: { status: string }) => void) | null = null;
jest.mock('expo-video', () => ({
    VideoView: 'PreviewVideo',
    useVideoPlayer: (url: string) => ({
        url, play: mockPlay, pause: mockPause,
        addListener: (_name: string, listener: (event: { status: string }) => void) => { mockStatus = listener; return { remove: jest.fn() }; },
    }),
}));

void [RN.View, RN.Text, RN.Pressable];
const preset = { id: 'p1', title: 'Neon Run', modelId: 'm', modelName: 'Model', category: 'OTHER', modality: 'text-to-video', prompt: 'x', needs: null, durationSeconds: 5, credits: 9, available: true, isNew: false, previewUrl: 'https://veyrnox.ai/p.mp4', posterUrl: 'https://veyrnox.ai/p.jpg' } as unknown as Preset;
let root: Root;
const labelled = (label: string) => root.container.queryAll(n => n.props.accessibilityLabel === label && typeof n.props.onClick === 'function')[0];
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; root = createRoot(); mockPlay.mockClear(); mockPause.mockClear(); mockStatus = null; });
afterEach(async () => { await act(async () => root.unmount()); });

test('a video tile plays from its play control without opening the template', async () => {
    const onPlay = jest.fn(), onOpen = jest.fn();
    await act(async () => root.render(<PresetCard preset={preset} price="9 credits" onPlay={onPlay} onOpen={onOpen} />));
    expect(mockPlay).not.toHaveBeenCalled();
    await act(async () => labelled('Play, Neon Run').props.onClick());
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    await act(async () => root.render(<PresetCard preset={preset} price="9 credits" playing onPlay={onPlay} onOpen={onOpen} />));
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(labelled('Pause, Neon Run')).toBeDefined();
});

test('a preview that cannot load hands back to the poster', async () => {
    const onPlay = jest.fn();
    await act(async () => root.render(<PresetCard preset={preset} price="9 credits" playing onPlay={onPlay} onOpen={jest.fn()} />));
    await act(async () => mockStatus?.({ status: 'error' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
});

test('a template with no preview video shows no play control', async () => {
    await act(async () => root.render(<PresetCard preset={{ ...preset, previewUrl: null }} price="9 credits" onPlay={jest.fn()} onOpen={jest.fn()} />));
    expect(labelled('Play, Neon Run')).toBeUndefined();
});

test('full-width audio rows never leave a hole in the two-column grid', () => {
    const isAudio = (id: string) => id.startsWith('a');
    expect(packFullRows(['v1', 'a1', 'v2', 'a2', 'v3'], isAudio)).toEqual(['v1', 'v2', 'a1', 'a2', 'v3']);
    expect(packFullRows(['a1', 'v1', 'a2'], isAudio)).toEqual(['a1', 'v1', 'a2']);
});
