import { Input, BlobSource, ALL_FORMATS, Output, BufferTarget, Mp4OutputFormat, WebMOutputFormat, Conversion } from 'mediabunny';
import { validateExportAudio } from './videoEnhance.mjs';

async function inspectInput(input) {
    const videos = await input.getVideoTracks();
    const audios = await input.getAudioTracks();
    if (videos.length !== 1 || audios.length > 1) {
        return 'Export supports exactly one video track and at most one audio track. Choose a single-track version of this clip.';
    }
    return validateExportAudio(audios.length ? await audios[0].getCodec() : null);
}

export async function inspectVideoExport(file) {
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
        return await inspectInput(input);
    } catch {
        return 'Export compatibility could not be checked. Try an MP4 clip with AAC audio.';
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
        for (const format of [new Mp4OutputFormat(), new WebMOutputFormat()]) {
            output = new Output({ format, target: new BufferTarget() });
            conversion = await Conversion.init({
                input, output, tracks: 'primary', tags: {},
                video: {
                    process: async sample => {
                        // Yield to the UI so cancellation works even on short, fast exports.
                        await new Promise(resolve => setTimeout(resolve, 0));
                        cancelled();
                        return process(sample);
                    },
                },
            });
            cancelled();
            // A successful video-only conversion must not hide unsupported source audio.
            if (conversion.isValid && conversion.discardedTracks.length === 0) break;
            await conversion.cancel(); conversion = undefined;
        }
        if (!conversion) throw new Error('This browser cannot export all tracks in this clip. Try desktop Chrome or a different video.');
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
