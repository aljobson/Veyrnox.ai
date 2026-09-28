import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, MP4, Conversion, canEncodeVideo, Quality } from 'mediabunny';
import { validateExportAudio } from './videoEnhance.mjs';

async function inspectInput(input) {
    const videos = await input.getVideoTracks();
    const audios = await input.getAudioTracks();
    if (videos.length !== 1 || audios.length > 1) {
        return 'Export supports exactly one video track and at most one audio track. Choose a single-track version of this clip.';
    }
    const audioError = validateExportAudio(audios.length ? (await audios[0].getCodec() ?? undefined) : null);
    if (audioError) return audioError;
    if (await input.getFormat() !== MP4) return 'Export supports MP4 input only. Convert this clip to MP4 with AAC audio, or no audio.';
    return null;
}

const capabilityError = conversion => {
    if (conversion.discardedTracks.some(track => ['unknown_source_codec', 'undecodable_source_codec'].includes(track.reason))) {
        return 'This browser cannot decode this clip for export. Try an H.264 MP4 in a browser with WebCodecs support.';
    }
    return 'This browser cannot encode this clip as H.264 MP4 with all its tracks. Try another desktop browser or a smaller MP4 clip.';
};

const exportQuality = new Quality('high');
function prepareConversion(input, output, process) {
    return Conversion.init({
        input, output, tracks: 'primary', tags: {}, showWarnings: false,
        video: { codec: 'avc', quality: exportQuality, process },
    });
}

export async function inspectVideoExport(file, signal) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
        signal?.throwIfAborted();
        const error = await inspectInput(input);
        if (error) return error;
        const [video] = await input.getVideoTracks();
        signal?.throwIfAborted();
        if (!await video.canDecode()) return capabilityError({ discardedTracks: [{ reason: 'undecodable_source_codec' }] });
        const supported = await canEncodeVideo('avc', {
            width: await video.getDisplayWidth(), height: await video.getDisplayHeight(), quality: exportQuality,
        });
        signal?.throwIfAborted();
        return supported ? null : capabilityError({ discardedTracks: [] });
    } catch {
        return 'Export compatibility could not be checked. Try an H.264 MP4 clip with AAC audio in a desktop browser with WebCodecs support.';
    } finally {
        input.dispose();
    }
}

// Decoding and encoding use source timestamps, never the playback wall clock.
export async function exportEnhancedVideo(file, { signal, process }) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    let conversion, output;
    const cancelled = () => { if (signal.aborted) throw new Error('Export cancelled.'); };
    const abort = () => { void conversion?.cancel().catch(() => {}); };
    signal.addEventListener('abort', abort, { once: true });
    try {
        cancelled();
        const audioError = await inspectInput(input);
        cancelled();
        if (audioError) throw new Error(audioError);
        output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
        conversion = await prepareConversion(input, output, async sample => {
            // Yield to the UI so cancellation works even on short, fast exports.
            await new Promise(resolve => setTimeout(resolve, 0));
            cancelled();
            return process(sample);
        });
        cancelled();
        if (!conversion.isValid || conversion.discardedTracks.length) throw new Error(capabilityError(conversion));
        await conversion.execute();
        cancelled();
        if (!output.target.buffer?.byteLength) throw new Error('The export was empty.');
        return new Blob([output.target.buffer], { type: output.format.mimeType });
    } catch (error) {
        await conversion?.cancel().catch(() => {});
        if (signal.aborted) throw new Error('Export cancelled.');
        throw error;
    } finally {
        signal.removeEventListener('abort', abort);
        input.dispose();
    }
}
