import { mediaFrames, overlaySpan } from '../src/lib/editorOverlay';
import { plural } from '../src/lib/i18n';

const clip = (start: number, len: number) => ({ start, len }) as never;
const timeline = (video: number[][], audio: number[][] = []) => ({ video: video.map(([s, l]) => clip(s, l)), audio: audio.map(([s, l]) => clip(s, l)) });

describe('overlaySpan', () => {
    it('keeps the wanted length when it fits inside the video', () => {
        expect(overlaySpan(timeline([[0, 300]]), 30, 90)).toEqual({ start: 30, len: 90 });
    });
    it('cuts a title short at the end of the video instead of lengthening the project', () => {
        const t = timeline([[0, 300]]);
        const span = overlaySpan(t, 250, 90);
        expect(span).toEqual({ start: 250, len: 50 });
        expect(span.start + span.len).toBeLessThanOrEqual(mediaFrames(t));
    });
    it('pulls a playhead parked past the end back inside the video', () => {
        expect(overlaySpan(timeline([[0, 300]]), 900, 90)).toEqual({ start: 299, len: 1 });
    });
    it('counts audio when there is no video', () => {
        expect(overlaySpan(timeline([], [[0, 120]]), 100, 90)).toEqual({ start: 100, len: 20 });
    });
    it('keeps the wanted length when the project has no media yet', () => {
        expect(overlaySpan(timeline([]), 0, 90)).toEqual({ start: 0, len: 90 });
    });
});

describe('plural labels added for the QA pass', () => {
    it('says 1 clip, not 1 clips', () => {
        expect(plural('editor.clipsOnTimelineCount', 1)).toBe('1 clip');
        expect(plural('editor.clipsOnTimelineCount', 2)).toBe('2 clips');
    });
    it('labels face filter chips with the word credits', () => {
        expect(plural('faceFilters.chipCredits', 3)).toBe('3 credits');
        expect(plural('faceFilters.chipCredits', 1)).toBe('1 credit');
    });
    it('names the tool, not a generic model, on the feature card', () => {
        expect(plural('features.modelCredits', 12, { name: 'Lip Sync' })).toBe('Lip Sync · 12 credits');
    });
});
