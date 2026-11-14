import { clampFrame, holdsClip, insertMediaAt } from '../src/lib/editorInsertMedia';
import { emptyTimeline, removeSelections, type Timeline } from '../src/lib/nativeEditorModel';

const media = { id: 'source', kind: 'video', frames: 90 };
function inserted(timeline = emptyTimeline(), item = media, at = 0) {
    const result = insertMediaAt(timeline, item, at);
    if ('error' in result) throw new Error(result.error);
    return result;
}

test.each(['audio', 'video', 'image'])('%s uses the first unlocked track of its kind', kind => {
    const timeline = emptyTimeline();
    const lane = kind === 'audio' ? 'audio' : 'video';
    const first = timeline.tracks.find(track => track.kind === lane)!;
    first.locked = true;
    timeline.tracks.push({ ...first, id: 'unlocked', locked: false });
    const result = inserted(timeline, { ...media, kind }, 12);
    expect(result.timeline[lane][0]).toMatchObject({ trackId: 'unlocked', start: 12, in: 0, len: 90, volume: 1, transition: 0, rate: 1 });
    expect(result.selection).toEqual({ track: lane, id: `${lane[0]}1` });
    expect(timeline[lane]).toHaveLength(0);
});

test('a locked-only kind gives track', () => {
    const timeline = emptyTimeline();
    timeline.tracks.forEach(track => { track.locked = true; });
    expect(insertMediaAt(timeline, media, 0)).toEqual({ error: 'track' });
});

test('40 media gives full, but an existing media id does not count', () => {
    const timeline = emptyTimeline();
    timeline.media = Object.fromEntries(Array.from({ length: 40 }, (_, n) => [`m${n}`, { ...media, id: `m${n}` }]));
    expect(insertMediaAt(timeline, media, 0)).toEqual({ error: 'full' });
    expect(inserted(timeline, { ...media, id: 'm0' }).timeline.video).toHaveLength(1);
});

test.each(['video', 'audio'] as const)('40 %s clips gives full', kind => {
    const timeline = emptyTimeline();
    timeline[kind] = Array.from({ length: 40 }, (_, n) => ({ id: `${kind}${n}`, start: 0, len: 1 }));
    expect(insertMediaAt(timeline, { ...media, kind }, 0)).toEqual({ error: 'full' });
});

test('length is capped at SEQUENCE_MAX minus the insertion frame', () => {
    expect(inserted(emptyTimeline(), media, 17980).timeline.video[0].len).toBe(20);
});

test('H4 clampFrame maps 18000 to 17999 and a clip inserted at 18000 starts at 17999 with len 1', () => {
    expect(clampFrame(18000)).toBe(17999);
    expect(clampFrame(-10)).toBe(0);
    expect(clampFrame(2.6)).toBe(3);
    expect(inserted(emptyTimeline(), media, 18000).timeline.video[0]).toMatchObject({ start: 17999, len: 1 });
});

test('AI-06 holdsClip is false when only timeline.media holds the id after removeSelections', () => {
    const result = inserted();
    expect(holdsClip(result.timeline, media.id)).toBe(true);
    const removed: Timeline = removeSelections(result.timeline, [result.selection], 'none');
    expect(removed.media[media.id]).toEqual(media);
    expect(holdsClip(removed, media.id)).toBe(false);
});

describe('QA build 50 F10: a new clip never lands on top of another clip', () => {
    test('a clip at the playhead over an existing clip goes on a new video track', () => {
        const first = inserted(emptyTimeline(), { id: 'boat', kind: 'video', frames: 219 }, 0).timeline;
        const result = inserted(first, { id: 'lantern', kind: 'image', frames: 150 }, 0);
        const tracks = result.timeline.tracks.filter(track => track.kind === 'video');
        expect(tracks).toHaveLength(2);
        const [boat, lantern] = result.timeline.video;
        expect(boat.trackId).toBe(tracks[0].id);
        expect(lantern).toMatchObject({ mediaId: 'lantern', start: 0, trackId: tracks[1].id });
        expect(tracks[1]).toMatchObject({ name: 'Video 2', locked: false, hidden: false });
        expect(result.selection).toEqual({ track: 'video', id: lantern.id });
    });

    test('a free gap on the first track is used, and a busy first track falls through to a free second one', () => {
        const first = inserted(emptyTimeline(), media, 0).timeline;
        expect(inserted(first, { id: 'later', kind: 'video', frames: 30 }, 90).timeline.tracks.filter(track => track.kind === 'video')).toHaveLength(1);
        const two = inserted(first, { id: 'second', kind: 'video', frames: 30 }, 0).timeline;
        const third = inserted(two, { id: 'third', kind: 'video', frames: 30 }, 60).timeline;
        expect(third.tracks.filter(track => track.kind === 'video')).toHaveLength(2);
        expect(third.video.at(-1)!.trackId).toBe(third.tracks.filter(track => track.kind === 'video')[1].id);
    });

    test('audio over audio gets its own audio track; a clip that ends exactly at the playhead does not count as overlap', () => {
        const first = inserted(emptyTimeline(), { id: 'music', kind: 'audio', frames: 90 }, 0).timeline;
        expect(inserted(first, { id: 'voice', kind: 'audio', frames: 30 }, 10).timeline.tracks.filter(track => track.kind === 'audio')).toHaveLength(2);
        expect(inserted(first, { id: 'next', kind: 'audio', frames: 30 }, 90).timeline.tracks.filter(track => track.kind === 'audio')).toHaveLength(1);
    });
});
