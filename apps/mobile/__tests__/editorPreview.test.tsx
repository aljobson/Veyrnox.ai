import { act } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { EditorMediaPreview } from '../src/components/editor/EditorMediaPreview';
import { activeEditorMedia, editorSourceTimeSeconds, resolveEditorMediaSource } from '../src/lib/editorPreview';
import { emptyTimeline, type Clip, type Media, type Timeline } from '../src/lib/nativeEditorModel';

void [ActivityIndicator, StyleSheet, Text, View];

const mockPlayer = {
    loop: false, keepScreenOnWhilePlaying: false, timeUpdateEventInterval: 0, currentTime: 0, playbackRate: 1, volume: 1,
    play: jest.fn(), pause: jest.fn(), addListener: jest.fn(() => ({ remove: jest.fn() })),
};

jest.mock('expo-image', () => ({ Image: (props: any) => require('react').createElement(require('react-native').View, props) }));
jest.mock('expo-video', () => ({
    useVideoPlayer: (_source: string, setup: (value: typeof mockPlayer) => void) => { setup(mockPlayer); return mockPlayer; },
    VideoView: (props: any) => require('react').createElement(require('react-native').View, props),
}));

const projectId = '11111111-1111-1111-1111-111111111111';
const assetId = '22222222-2222-2222-2222-222222222222';
const jobId = '33333333-3333-3333-3333-333333333333';
const clip: Clip = { id: 'v1', mediaId: 'media', start: 30, in: 15, len: 90, trackId: 'video-0', rate: 2 };

test('finds the top visible visual clip at the playhead', () => {
    const timeline: Timeline = {
        ...emptyTimeline(),
        media: {
            hidden: { id: 'hidden', kind: 'video', frames: 90 },
            image: { id: 'image', kind: 'image', frames: 90 },
        },
        tracks: [
            { id: 'video-0', kind: 'video', name: 'Video 1', locked: false, muted: false, hidden: false },
            { id: 'video-1', kind: 'video', name: 'Video 2', locked: false, muted: false, hidden: true },
        ],
        video: [
            { id: 'v1', mediaId: 'image', start: 0, len: 60, trackId: 'video-0' },
            { id: 'v2', mediaId: 'hidden', start: 0, len: 60, trackId: 'video-1' },
        ],
    };
    expect(activeEditorMedia(timeline, 30)?.media.id).toBe('image');
    expect(activeEditorMedia(timeline, 60)).toBeNull();
});

test('resolves owned project and Library media without persisting the signed URL', async () => {
    const request = jest.fn()
        .mockResolvedValueOnce({ url: 'https://assets.example/project.mp4', content_type: 'video/mp4' })
        .mockResolvedValueOnce({ url: 'https://assets.example/library.png', mime_type: 'image/png' });
    await expect(resolveEditorMediaSource({ request }, { id: `p-${assetId}`, kind: 'video', assetSource: { projectId, assetId } })).resolves.toEqual({ uri: 'https://assets.example/project.mp4', kind: 'video' });
    await expect(resolveEditorMediaSource({ request }, { id: `j-${jobId}`, kind: 'image' })).resolves.toEqual({ uri: 'https://assets.example/library.png', kind: 'image' });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
        `/api/v1/projects/${projectId}/assets/${assetId}/download`,
        `/api/v1/jobs/${jobId}/asset`,
    ]);
});

test('maps the timeline playhead into source time', () => {
    expect(editorSourceTimeSeconds(clip, 45, 30)).toBe(1.5);
    expect(editorSourceTimeSeconds({ ...clip, in: 75, reverse: true }, 45, 30)).toBe(1.5);
});

describe('EditorMediaPreview', () => {
    let root: Root;
    beforeEach(() => {
        (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
        jest.clearAllMocks();
        mockPlayer.currentTime = 0;
        root = createRoot();
    });
    afterEach(async () => { await act(async () => root.unmount()); });

    test('renders a picked device image immediately from its session URI', async () => {
        const media: Media = { id: 'l-local', kind: 'image', name: 'Device image', frames: 90 };
        await act(async () => root.render(<EditorMediaPreview api={{ request: jest.fn() }} clip={{ ...clip, mediaId: media.id }} media={media} frame={30} fps={30} playing={false} localUri="file:///device/photo.jpg" />));
        await act(async () => Promise.resolve());
        expect(root.container.queryAll((node) => node.props.accessibilityLabel === 'Preview Device image')).toHaveLength(1);
    });

    test('renders resolved video and follows the editor transport', async () => {
        const media: Media = { id: `j-${jobId}`, kind: 'video', name: 'Library clip', frames: 90 };
        const request = jest.fn().mockResolvedValue({ url: 'https://assets.example/clip.mp4', mime_type: 'video/mp4' });
        const api = { request };
        await act(async () => root.render(<EditorMediaPreview api={api} clip={{ ...clip, mediaId: media.id }} media={media} frame={45} fps={30} playing />));
        await act(async () => Promise.resolve());
        expect(root.container.queryAll((node) => node.props.accessibilityLabel === 'Preview Library clip')).toHaveLength(1);
        expect(mockPlayer.play).toHaveBeenCalled();
        expect(mockPlayer.currentTime).toBe(1.5);
        await act(async () => root.render(<EditorMediaPreview api={api} clip={{ ...clip, mediaId: media.id }} media={{ ...media }} frame={46} fps={30} playing />));
        expect(request).toHaveBeenCalledTimes(1);
    });
});
