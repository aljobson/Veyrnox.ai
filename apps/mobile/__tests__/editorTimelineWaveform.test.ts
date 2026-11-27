import { decodeTimelineWaveform, normalizePeakBins, pcmPeakBins, waveformClipInputs, waveformSourceRange } from '../src/lib/editorTimelineWaveform';
import { emptyTimeline, type Clip } from '../src/lib/nativeEditorModel';

function pcm(values: number[]) {
    const bytes = new Uint8Array(values.length * 4), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat32(index * 4, value, true));
    return bytes;
}

test('PCM bins keep real peaks and normalize without inventing sound', () => {
    const peaks = pcmPeakBins(pcm([0, -.2, .4, -.8]), 2);
    expect(peaks[0]).toBeCloseTo(.2); expect(peaks[1]).toBeCloseTo(.8);
    expect(normalizePeakBins([0, .2, .8])).toEqual([0, .25, 1]);
    expect(normalizePeakBins([0, 0])).toEqual([0, 0]);
    expect(pcmPeakBins(new Uint8Array(3), 2)).toEqual([]);
});

test('source ranges follow forward, reverse, speed and freeze edits', () => {
    const clip: Clip = { id: 'v1', mediaId: 'm', start: 0, in: 90, len: 30, rate: 2, trackId: 'video-0' };
    expect(waveformSourceRange(clip, 30)).toEqual({ fromSeconds: 3, toSeconds: 149 / 30 });
    expect(waveformSourceRange({ ...clip, reverse: true }, 30)).toEqual({ fromSeconds: 32 / 30, toSeconds: 91 / 30 });
    expect(waveformSourceRange({ ...clip, freezeFrame: 100 }, 30)).toBeNull();
});

test('waveform inputs include only locally readable clips with sound', () => {
    const timeline = emptyTimeline();
    timeline.media = { video: { id: 'video', kind: 'video', frames: 90, hasAudio: true }, silent: { id: 'silent', kind: 'video', frames: 90, hasAudio: false } };
    timeline.video = [
        { id: 'v1', mediaId: 'video', start: 0, in: 0, len: 30, trackId: 'video-0' },
        { id: 'v2', mediaId: 'silent', start: 30, in: 0, len: 30, trackId: 'video-0' },
    ];
    expect(waveformClipInputs(timeline, { video: 'file:///video.mp4', silent: 'file:///silent.mp4' }).map(row => row.clip.id)).toEqual(['v1']);
});

test('native PCM artifacts become bounded timeline peaks and are always released', async () => {
    const bytes = pcm(Array.from({ length: 480 }, (_, index) => index % 80 === 0 ? .8 : .1));
    const release = jest.fn(async () => ({ ok: true as const, value: null }));
    const decodePcm = jest.fn(async () => ({ ok: true as const, value: { artifactId: 'wave-1', uri: 'file:///audio.f32le', kind: 'pcm' as const, size: bytes.length,
        sampleRate: 48000 as const, channels: 1 as const, frames: bytes.length / 4, encoding: 'f32le-interleaved' as const, mixMode: 'web-average' as const, segments: [] } }));
    const clip: Clip = { id: 'a1', mediaId: 'audio', start: 0, in: 0, len: 30, trackId: 'audio-0' };
    const peaks = await decodeTimelineWaveform('project-1', 'file:///audio.wav', clip, 30, undefined, { media: { decodePcm, release }, files: { bytes: async () => bytes } });
    expect(peaks).toHaveLength(64);
    expect(Math.max(...peaks)).toBe(1);
    expect(decodePcm).toHaveBeenCalledWith('project-1', expect.objectContaining({ mixMode: 'web-average' }), undefined, undefined);
    expect(release).toHaveBeenCalledWith('project-1', 'wave-1');
});
