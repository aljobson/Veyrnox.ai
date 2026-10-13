import { EncodedPacket, EncodedVideoPacketSource } from 'mediabunny';

export function usesWebKit(userAgent = globalThis.navigator?.userAgent || '') {
    return /AppleWebKit\//.test(userAgent) && !/(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent);
}

export function safariEncoderConfig({ width, height }, { frameRate = 30, bitrate = 8000000 } = {}) {
    return {
        codec: width * height <= 1920 * 1080 && frameRate <= 60 ? 'avc1.64002a' : 'avc1.640034',
        width, height, framerate: frameRate, bitrate,
        latencyMode: 'quality', hardwareAcceleration: 'no-preference', avc: { format: 'avc' },
    };
}

export async function canEncodeSafariVideo(size, options) {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false;
    return (await VideoEncoder.isConfigSupported(safariEncoderConfig(size, options))).supported;
}

const cancelled = () => Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });

// WebKit's quality encoder can wait for more frames than the library's four-frame queue permits.
// Flush one frame at a time, retaining quality mode and checking every output timestamp.
export async function createSafariCanvasSource(canvas, { frameRate, bitrate, signal, timeoutMs = 15000 }) {
    if (signal?.aborted) throw cancelled();
    const config = safariEncoderConfig(canvas, { frameRate, bitrate });
    if (!await canEncodeSafariVideo(canvas, { frameRate, bitrate })) throw new Error('This browser cannot encode this H.264 export size and frame rate.');
    const source = new EncodedVideoPacketSource('avc');
    let chunks = [], metadata, failure, closed = false, count = 0;
    const encoder = new VideoEncoder({
        output(chunk, meta) { chunks.push(chunk); if (meta?.decoderConfig) metadata = meta; },
        error(error) { failure = error; },
    });
    const dispose = () => { if (closed) return; closed = true; if (encoder.state !== 'closed') encoder.close(); chunks = []; };
    try { encoder.configure(config); } catch (error) { dispose(); throw error; }

    async function flush() {
        if (signal?.aborted) throw cancelled();
        let timer, abort;
        try {
            await Promise.race([
                encoder.flush(),
                new Promise((_, reject) => {
                    abort = () => { dispose(); reject(cancelled()); };
                    signal?.addEventListener('abort', abort, { once: true });
                    timer = setTimeout(() => { dispose(); reject(new Error('Video encoding timed out. Retry this export.')); }, timeoutMs);
                }),
            ]);
            if (signal?.aborted) throw cancelled();
            if (failure) throw failure;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }

    return {
        source,
        async add(timestamp, duration) {
            if (signal?.aborted) throw cancelled();
            if (closed) throw new Error('The video encoder was closed.');
            const requestedTimestamp = Math.round(timestamp * 1000000);
            const frame = new VideoFrame(canvas, { timestamp: requestedTimestamp, duration: Math.round(duration * 1000000) });
            // WebKit can round a canvas VideoFrame's timestamp down by 1 us (bug 321880).
            // Correlate the output with the actual frame, then mux the exact timeline time.
            const frameTimestamp = frame.timestamp;
            try { encoder.encode(frame, { keyFrame: count % (frameRate * 2) === 0 }); }
            finally { frame.close(); }
            await flush();
            if (Math.abs(frameTimestamp - requestedTimestamp) > 1 || chunks.length !== 1 || chunks[0].timestamp !== frameTimestamp || !metadata) throw new Error('The video encoder did not preserve every frame. Retry this export.');
            const packet = EncodedPacket.fromEncodedChunk(chunks.shift()).clone({ timestamp, duration });
            await source.add(packet, metadata);
            count++;
        },
        close() { dispose(); source.close(); },
        dispose,
    };
}
