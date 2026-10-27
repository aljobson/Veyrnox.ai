import { act } from 'react';
import * as RN from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { InlineMedia } from '../src/components/InlineMedia';
import { StemList } from '../src/components/StemList';
import { ReviewMedia } from '../src/components/ReviewMedia';
import { t } from '../src/lib/i18n';
import type { ApiClient } from '../src/lib/api';

const mockPlayers: any[] = [];
const mockAsset = jest.fn();
const mockShare = jest.fn();
jest.mock('expo-router', () => ({ useFocusEffect: (fn: any) => jest.requireActual('react').useEffect(fn, [fn]) }));
jest.mock('expo-video', () => ({
    VideoView: 'VideoView',
    useVideoPlayer: (url: string, setup: (p: any) => void) => {
        const React = jest.requireActual('react');
        const player = React.useMemo(() => {
            const p: any = { url, muted: false, play: jest.fn(), pause: jest.fn(), release: jest.fn(), listeners: {}, removals: [] };
            p.addListener = (name: string, fn: any) => { p.listeners[name] = fn; const remove = jest.fn(); p.removals.push(remove); return { remove }; };
            setup(p); mockPlayers.push(p); return p;
        }, [url]);
        React.useEffect(() => () => player.release(), [player]);
        return player;
    },
}));
jest.mock('../src/lib/media', () => ({ mediaApi: () => ({ getAsset: (...args: any[]) => mockAsset(...args) }) }));
jest.mock('../src/lib/output', () => ({ STEMS: ['vocals', 'drums'], shareOutput: (...args: any[]) => mockShare(...args) }));
void [RN.View, RN.Text, RN.Pressable];
let root: Root;
let background: (state: string) => void;
let removeState: jest.Mock;
const event = { nativeEvent: {}, currentTarget: 1, target: 1 };
const press = async (label: string) => {
    const node = root.container.queryAll(n => n.props.accessibilityLabel === label)[0];
    await act(async () => node.props.onClick(event));
};
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(); mockPlayers.length = 0; mockAsset.mockReset(); mockShare.mockReset();
    removeState = jest.fn();
    jest.spyOn(RN.AppState, 'addEventListener').mockImplementation((_name, fn: any) => { background = fn; return { remove: removeState }; });
});
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
test('native media never autoplays, unmutes on deliberate play only once, and pauses on background/unmount', async () => {
    await act(async () => root.render(<InlineMedia url="https://media.example/clip.mp4" label="Finished video" />));
    const player = mockPlayers[0];
    expect(player.muted).toBe(true); expect(player.play).not.toHaveBeenCalled(); expect(player.loop).toBe(false);
    expect(root.container.queryAll(n => n.type === 'VideoView')[0].props.nativeControls).toBe(true);
    await act(async () => player.listeners.playingChange({ isPlaying: true }));
    expect(player.muted).toBe(false);
    player.muted = true; // A later user mute choice must survive pause/resume.
    await act(async () => player.listeners.playingChange({ isPlaying: true }));
    expect(player.muted).toBe(true);
    await act(async () => background('background'));
    expect(player.pause).toHaveBeenCalledTimes(1);
    await act(async () => root.render(<></>));
    expect(player.pause).toHaveBeenCalledTimes(2);
    expect(player.release).toHaveBeenCalledTimes(1);
    expect(player.removals[0]).toHaveBeenCalledTimes(1); expect(removeState).toHaveBeenCalledTimes(1);
});
test('selecting another stem disposes the old player; sharing retains the native share flow', async () => {
    const api = {} as ApiClient;
    mockAsset.mockImplementation(async (_id, stem) => ({ url: `https://media.example/${stem}.mp3`, mime_type: 'audio/mpeg' }));
    await act(async () => root.render(<StemList api={api} jobId="job-1" stems={['vocals', 'drums']} />));
    await press(t('stems.play', { stem: t('stem.vocals') }));
    expect(mockPlayers).toHaveLength(1);
    await press(t('stems.play', { stem: t('stem.drums') }));
    expect(mockPlayers).toHaveLength(2);
    expect(mockPlayers[0].release).toHaveBeenCalledTimes(1);
    const views = root.container.queryAll(n => n.type === 'VideoView');
    expect(views).toHaveLength(1); expect(views[0].props.player.url).toContain('drums');
    await press(t('stems.share', { stem: t('stem.vocals') }));
    expect(mockShare).toHaveBeenCalledWith('https://media.example/vocals.mp3', 'job-1', 'audio/mpeg', 'vocals');
    expect(mockPlayers).toHaveLength(2);
});
test('review videos load only on tap, never autoplay, and only one player survives selection', async () => {
    const attachments = ['first', 'second', 'third'].map(name => ({ mediaType: 'video', previewUrl: `https://media.example/${name}.mp4`, held: false }));
    await act(async () => root.render(<ReviewMedia attachments={attachments} />));
    expect(mockPlayers).toHaveLength(0);
    expect(root.container.queryAll(n => n.type === 'VideoView')).toHaveLength(0);
    await press(t('share.review.loadVideo', { count: 1 }));
    expect(mockPlayers).toHaveLength(1);
    expect(mockPlayers[0].muted).toBe(true);
    expect(mockPlayers[0].play).not.toHaveBeenCalled();
    await act(async () => mockPlayers[0].listeners.playingChange({ isPlaying: true }));
    expect(mockPlayers[0].muted).toBe(false);
    await press(t('share.review.loadVideo', { count: 2 }));
    expect(mockPlayers).toHaveLength(2);
    expect(mockPlayers[0].pause).toHaveBeenCalledTimes(1);
    expect(mockPlayers[0].release).toHaveBeenCalledTimes(1);
    expect(mockPlayers[1].muted).toBe(true);
    expect(mockPlayers[1].play).not.toHaveBeenCalled();
    expect(root.container.queryAll(n => n.type === 'VideoView')).toHaveLength(1);
    await press(t('share.review.loadVideo', { count: 1 }));
    expect(mockPlayers[1].pause).toHaveBeenCalledTimes(1);
    expect(mockPlayers[1].release).toHaveBeenCalledTimes(1);
    expect(mockPlayers[2].muted).toBe(true);
    expect(mockPlayers[2].play).not.toHaveBeenCalled();
});
