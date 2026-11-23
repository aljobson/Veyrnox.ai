import { editorSpeechMixRequest, placeEditorSpeechTranscript, type EditorSpeechSource } from '../src/components/editor/tools/useEditorSpeechCaptions';

const source: EditorSpeechSource = { uri: 'file:///clip.mp4', mediaId: 'media', startFrame: 300, inFrame: 150, lenFrames: 90, fps: 30 };

test('mixes only the selected source range at project time zero', () => {
    expect(editorSpeechMixRequest(source)).toEqual({ clips: [{ mediaId: 'media', timelineStartSeconds: 0, sourceStartSeconds: 5,
        durationSeconds: 3, volume: 1, fadeInSeconds: 0, fadeOutSeconds: 0 }], sources: { media: 'file:///clip.mp4' }, frames: 90, fps: 30 });
});

test('maps bounded speech timestamps onto the selected clip timeline start', () => {
    const transcript = { locale: 'en-US', text: 'hello', onDevice: true as const, segments: [{ text: 'hello', startMs: 250, durationMs: 400 }] };
    expect(placeEditorSpeechTranscript(transcript, source).segments).toEqual([{ text: 'hello', startMs: 10_250, durationMs: 400 }]);
    expect(transcript.segments[0].startMs).toBe(250);
});
