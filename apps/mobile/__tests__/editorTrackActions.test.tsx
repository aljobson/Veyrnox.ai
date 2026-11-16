import { act } from 'react';
import { Alert } from 'react-native';
import { createRoot, type Root } from 'test-renderer';
import { useEditorTrackActions } from '../src/components/editor/useEditorTrackActions';
import { addTrack, emptyTimeline, type Timeline } from '../src/lib/nativeEditorModel';

let root: Root, actions: ReturnType<typeof useEditorTrackActions>;
const apply = jest.fn();
function Harness({ shown, live }: { shown: Timeline; live: () => Timeline }) { actions = useEditorTrackActions(shown, live, apply); return null; }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; jest.clearAllMocks(); jest.spyOn(Alert, 'alert').mockImplementation(() => {}); root = createRoot(); });
afterEach(async () => { await act(async () => root.unmount()); jest.restoreAllMocks(); });
const confirm = async () => act(async () => jest.mocked(Alert.alert).mock.calls.at(-1)![2]![1].onPress!());

test('confirming removes the empty track from the live document, keeping what arrived while the alert was open', async () => {
    const shown = addTrack(emptyTimeline(), 'video'); const extra = shown.tracks[3].id;
    const arrived: Timeline = { ...shown, seq: shown.seq + 1, media: { m: { id: 'm' } }, video: [{ id: 'v9', mediaId: 'm', start: 0, len: 10, trackId: 'video-0' }] };
    await act(async () => root.render(<Harness shown={shown} live={() => arrived} />));
    await act(async () => actions.pressTrack(extra)); await confirm();
    const next = apply.mock.calls[0][0] as Timeline;
    expect(next.video).toHaveLength(1); expect(next.media.m).toBeTruthy(); expect(next.tracks.some(t => t.id === extra)).toBe(false);
});
test('a track that gained a clip before confirming is not removed; the last track of a kind never prompts', async () => {
    const shown = addTrack(emptyTimeline(), 'video'); const extra = shown.tracks[3].id;
    const filled: Timeline = { ...shown, video: [{ id: 'v9', mediaId: 'm', start: 0, len: 10, trackId: extra }] };
    await act(async () => root.render(<Harness shown={shown} live={() => filled} />));
    await act(async () => actions.pressTrack(extra)); await confirm(); expect(apply).not.toHaveBeenCalled();
    jest.mocked(Alert.alert).mockClear(); await act(async () => actions.pressTrack('audio-0')); expect(Alert.alert).not.toHaveBeenCalled();
});
