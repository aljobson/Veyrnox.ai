import { addTrack, canRemoveTrack, copySelections, emptyExtraTracks, emptyTimeline, pasteClipboard, pruneEmptiedExtraTracks, removeSelections, removeTrack, type Clip, type Timeline } from '../src/lib/nativeEditorModel';

const clip = (id: string, trackId: string): Clip => ({ id, mediaId: 'm', start: 0, len: 30, trackId });
const withSecondVideo = (): Timeline => { const base = addTrack(emptyTimeline(), 'video'); return { ...base, video: [clip('v1', 'video-0'), clip('v2', base.tracks[3].id)] }; };

describe('track removal model', () => {
    test('removes an empty extra track immutably and leaves the input untouched', () => {
        const base = addTrack(emptyTimeline(), 'video'); const id = base.tracks[3].id; const frozen = JSON.stringify(base);
        const next = removeTrack(base, id)!;
        expect(next.tracks.map(t => t.id)).toEqual(['video-0', 'audio-0', 'text-0']);
        expect(JSON.stringify(base)).toBe(frozen); expect(next).not.toBe(base);
    });
    test('never removes the last track of a kind or a track that holds clips', () => {
        const base = withSecondVideo();
        expect(canRemoveTrack(emptyTimeline(), 'video-0')).toBe(false); expect(removeTrack(emptyTimeline(), 'audio-0')).toBeNull();
        expect(removeTrack(base, base.tracks[3].id)).toBeNull(); expect(removeTrack(base, 'missing')).toBeNull();
    });
    test('emptyExtraTracks lists only empty tracks beyond the first of each kind', () => {
        const base = withSecondVideo(); expect(emptyExtraTracks(base)).toEqual([]);
        const emptied = removeSelections(base, [{ track: 'video', id: 'v2' }], 'none');
        expect(emptyExtraTracks(emptied).map(t => t.id)).toEqual([base.tracks[3].id]);
        expect(emptyExtraTracks(addTrack(emptyTimeline(), 'text')).map(t => t.kind)).toEqual(['text']);
    });
    test('deleting the last clip of an extra track drops it; the first track of a kind stays even when emptied', () => {
        const base = withSecondVideo(); const extra = base.tracks[3].id;
        const gone = pruneEmptiedExtraTracks(removeSelections(base, [{ track: 'video', id: 'v2' }], 'none'), [extra]);
        expect(gone.tracks.some(t => t.id === extra)).toBe(false);
        const first = pruneEmptiedExtraTracks(removeSelections(base, [{ track: 'video', id: 'v1' }], 'none'), ['video-0']);
        expect(first.tracks.map(t => t.id)).toContain('video-0'); expect(first.tracks.map(t => t.id)).toContain(extra);
    });
    test('pasting a clip copied from a removed track lands on a track that exists', () => {
        const base = withSecondVideo(); const extra = base.tracks[3].id;
        const board = copySelections(base, [{ track: 'video', id: 'v2' }]);
        const pruned = pruneEmptiedExtraTracks(removeSelections(base, [{ track: 'video', id: 'v2' }], 'none'), [extra]);
        const pasted = pasteClipboard(pruned, board, 0)!.timeline;
        expect(pasted.video.every(item => pruned.tracks.some(t => t.id === item.trackId && t.kind === 'video'))).toBe(true);
    });
});
