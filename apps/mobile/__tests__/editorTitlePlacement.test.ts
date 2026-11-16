import { placeTitle, TITLE_FRAMES } from '../src/lib/editorTitlePlacement';
import { mediaFrames } from '../src/lib/editorOverlay';

test('an empty timeline keeps the old behaviour: at the playhead, three seconds', () => {
    expect(placeTitle(0, 0, 0)).toEqual({ start: 0, len: TITLE_FRAMES });
    expect(placeTitle(500, 0, 120)).toEqual({ start: 120, len: TITLE_FRAMES });
});
test('with video, a title in the middle of the clip is left where it was', () => {
    expect(placeTitle(100, 1000, 1000)).toEqual({ start: 100, len: TITLE_FRAMES });
});
test('with video, a title at or past the end is pulled back so it ends at the clip end', () => {
    expect(placeTitle(1000, 1000, 1000)).toEqual({ start: 910, len: TITLE_FRAMES });
    expect(placeTitle(5000, 1000, 1000)).toEqual({ start: 910, len: TITLE_FRAMES });
    expect(placeTitle(950, 1000, 1000)).toEqual({ start: 910, len: TITLE_FRAMES });
});
test('a clip shorter than the title gets a title as long as the clip', () => {
    expect(placeTitle(40, 60, 60)).toEqual({ start: 0, len: 60 });
});

test('the end a title must respect counts audio too, so a title never lengthens an audio-only project', () => {
    const end = mediaFrames({ video: [], audio: [{ start: 0, len: 120 } as never] });
    expect(placeTitle(500, end, 120)).toEqual({ start: 30, len: TITLE_FRAMES });
});
