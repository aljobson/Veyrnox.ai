import { bestCutProjectClips } from '../src/lib/bestCutProjectClips';
import { emptyTimeline } from '../src/lib/nativeEditorModel';

test('seeds Best Cut from each current project source once in visual order', () => {
    const timeline = emptyTimeline();
    timeline.fps = 30;
    timeline.media = {
        'l-11111111-1111-4111-8111-111111111111': { id: 'l-11111111-1111-4111-8111-111111111111', kind: 'video', name: 'Phone take', frames: 300 },
        'j-22222222-2222-4222-8222-222222222222': { id: 'j-22222222-2222-4222-8222-222222222222', kind: 'video', name: 'Library take', frames: 180 },
    };
    timeline.video = [
        { id: 'v2', mediaId: 'l-11111111-1111-4111-8111-111111111111', start: 90, in: 30, len: 120 },
        { id: 'v1', mediaId: 'j-22222222-2222-4222-8222-222222222222', start: 0, in: 0, len: 180 },
        { id: 'v3', mediaId: 'j-22222222-2222-4222-8222-222222222222', start: 210, in: 30, len: 60 },
    ];
    const clips = bestCutProjectClips(timeline, {
        'l-11111111-1111-4111-8111-111111111111': { file: 'file:///take.mp4', type: 'video/mp4', size: 1000, seconds: 10, verified: true },
    });
    expect(clips.map(clip => clip.media.name)).toEqual(['Library take', 'Phone take']);
    expect(clips[0].source).toEqual({ type: 'job', jobId: '22222222-2222-4222-8222-222222222222' });
    expect(clips[1].file?.file).toBe('file:///take.mp4');
});

test('skips project media that cannot be analysed without inventing a remote source', () => {
    const timeline = emptyTimeline();
    timeline.media.remote = { id: 'remote', kind: 'video', frames: 90 };
    timeline.video = [{ id: 'v1', mediaId: 'remote', start: 0, len: 90 }];
    expect(bestCutProjectClips(timeline, {})).toEqual([]);
});
