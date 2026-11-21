import { ORIGINAL_AUDIO, originalAudioFrames, originalAudioMedia, originalAudioWavBytes } from '../src/lib/editorOriginalAudio';
import { synthesizeOriginalAudio } from '../../../app/veyrnox/_lib/editorOriginalAudio.mjs';
import { addSequenceMedia, emptySequence } from '../../../app/veyrnox/_lib/editorSequence.mjs';
import { validateSequence } from '../../../app/veyrnox/_lib/editorSequenceValidation.mjs';
import { insertMediaAt } from '../src/lib/editorInsertMedia';
import { emptyTimeline } from '../src/lib/nativeEditorModel';
test('all ten media entries equal web storage and phone placement validates', () => {
    expect(ORIGINAL_AUDIO).toHaveLength(10);
    for (const preset of ORIGINAL_AUDIO) {
        const media = originalAudioMedia(preset.id, `l-${preset.id}`);
        expect(media.frames).toBe(Math.floor(Math.round(preset.seconds * 48000) / 48000 * 30));
        expect(originalAudioFrames(preset.id)).toBe(media.frames);
        expect(addSequenceMedia(emptySequence(), media).media[media.id]).toEqual(media);
        const result = insertMediaAt(emptyTimeline(), media, 15);
        expect('timeline' in result && validateSequence(result.timeline)).toBeNull();
        expect(media.assetSource).toBeUndefined();
    }
});
test.each(['tap-click', 'soft-keys'])('WAV header and every sample match web: %s', id => {
    const bytes = originalAudioWavBytes(id), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const samples = synthesizeOriginalAudio(id);
    const ascii = (at: number, n: number) => String.fromCharCode(...bytes.slice(at, at + n));
    expect([ascii(0, 4), ascii(8, 4), ascii(12, 4), ascii(36, 4)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect([view.getUint32(4, true), view.getUint32(16, true), view.getUint16(20, true), view.getUint16(22, true),
        view.getUint32(24, true), view.getUint32(28, true), view.getUint16(32, true), view.getUint16(34, true), view.getUint32(40, true)])
        .toEqual([bytes.length - 8, 16, 1, 1, 48000, 96000, 2, 16, samples.length * 2]);
    const actual = Array.from(samples, (_, i) => view.getInt16(44 + i * 2, true));
    expect(actual).toEqual(Array.from(samples, s => Math.round(s * 32767) || 0));
});
