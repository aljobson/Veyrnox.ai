import { act } from 'react';
import * as RN from 'react-native';
import { createRoot } from 'test-renderer';
import { ExampleVideo } from '../src/components/ExampleVideo';

let statusListener: ((event: { status: string }) => void) | undefined;
jest.mock('expo-video', () => ({
    useVideoPlayer: () => ({ addListener: (_name: string, cb: (event: { status: string }) => void) => { statusListener = cb; return { remove: () => undefined }; } }),
    VideoView: (props: any) => jest.requireActual('react').createElement('VideoView', props),
}));
jest.mock('expo-image', () => ({ Image: (props: any) => jest.requireActual('react').createElement('Poster', props) }));
void [RN.View];

const posters = (root: any) => root.container.queryAll((n: any) => n.type === 'Poster');
const videos = (root: any) => root.container.queryAll((n: any) => n.type === 'VideoView');

test('the poster stays until the first frame renders, then goes', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    try {
        await act(async () => root.render(<ExampleVideo url="https://veyrnox.ai/examples/a.mp4" poster="https://veyrnox.ai/examples/a.jpg" title="A" />));
        expect(posters(root)).toHaveLength(1);
        expect(videos(root)).toHaveLength(1);
        await act(async () => { videos(root)[0].props.onFirstFrameRender(); });
        expect(posters(root)).toHaveLength(0);
        expect(videos(root)).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
});

test('a clip that errors falls back to the poster still and drops the player', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    try {
        await act(async () => root.render(<ExampleVideo url="https://veyrnox.ai/examples/a.mp4" poster="https://veyrnox.ai/examples/a.jpg" title="A" />));
        await act(async () => { statusListener?.({ status: 'error' }); });
        expect(videos(root)).toHaveLength(0);
        expect(posters(root)).toHaveLength(1);
    } finally { await act(async () => root.unmount()); }
});

test('without a poster nothing is overlaid', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot();
    try {
        await act(async () => root.render(<ExampleVideo url="https://veyrnox.ai/examples/a.mp4" title="A" />));
        expect(posters(root)).toHaveLength(0);
    } finally { await act(async () => root.unmount()); }
});
