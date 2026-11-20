import { emptyTimeline, type Timeline } from '../../src/lib/nativeEditorModel';

// Phone captions created before S4 were ordinary text clips, without a caption flag.
export function legacyPhoneCaptions(): Timeline {
    return { ...emptyTimeline(), seq: 3, text: [
        { id: 't1', text: 'Legacy first line', start: 0, len: 60, trackId: 'text-0', x: .5, y: .92, size: 4 },
        { id: 't2', text: 'Legacy second line', start: 60, len: 60, trackId: 'text-0', x: .5, y: .92, size: 4 },
        { id: 't3', text: 'Title stays text', start: 120, len: 60, trackId: 'text-0', x: .5, y: .85, size: 6 },
    ] };
}
