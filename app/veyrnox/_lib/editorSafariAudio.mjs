import { EncodedPacket, EncodedAudioPacketSource } from 'mediabunny';

const SAMPLE_RATE = 48000, CHANNELS = 2;
const config = { codec: 'mp4a.40.2', sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, bitrate: 128000 };
const cancelled = () => Object.assign(new Error('Export cancelled.'), { name: 'AbortError' });

/** Keep AAC priming, but trim encoder padding at the exact end of the mixed timeline. */
export async function createSafariAudioSource({ samples, signal, timeoutMs = 15000 }) {
    if (signal?.aborted) throw cancelled();
    if (typeof AudioEncoder === 'undefined' || typeof AudioData === 'undefined' || !(await AudioEncoder.isConfigSupported(config)).supported) throw new Error('This browser cannot encode AAC audio.');
    const source = new EncodedAudioPacketSource('aac');
    let offset = 0, metadata, failure, closed = false, writes = Promise.resolve(), packets = 0;
    const encoder = new AudioEncoder({
        output(chunk, meta) {
            if (closed || failure) return;
            if (meta?.decoderConfig) {
                // WebKit can omit or corrupt AAC's description (bug 302253). This mix is always 48 kHz stereo AAC-LC.
                metadata = { decoderConfig: { ...meta.decoderConfig, ...config, description: new Uint8Array([0x11, 0x90]) } };
            }
            const start = Math.round(chunk.timestamp / 1000000 * SAMPLE_RATE);
            if (start >= samples) return;
            const length = Math.min(chunk.duration == null ? 1024 : Math.round(chunk.duration / 1000000 * SAMPLE_RATE), samples - start);
            const packet = EncodedPacket.fromEncodedChunk(chunk).clone({ timestamp: start / SAMPLE_RATE, duration: length / SAMPLE_RATE });
            const packetMetadata = metadata;
            writes = writes.then(async () => {
                if (!packetMetadata || length <= 0) throw new Error('The audio encoder returned invalid audio timing.');
                await source.add(packet, packetMetadata); packets++;
            }).catch(error => { failure = error; });
        },
        error(error) { failure = error; },
    });
    const dispose = () => { if (closed) return; closed = true; if (encoder.state !== 'closed') encoder.close(); };
    try { encoder.configure(config); } catch (error) { dispose(); throw error; }

    async function bounded(work) {
        if (signal?.aborted) throw cancelled();
        let timer, abort;
        try {
            await Promise.race([work, new Promise((_, reject) => {
                abort = () => { dispose(); reject(cancelled()); };
                signal?.addEventListener('abort', abort, { once: true });
                timer = setTimeout(() => { dispose(); reject(new Error('Audio encoding timed out. Retry this export.')); }, timeoutMs);
            })]);
            if (signal?.aborted) throw cancelled();
            if (failure) throw failure;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }

    return {
        source,
        async add(buffer) {
            if (signal?.aborted) throw cancelled();
            if (closed) throw new Error('The audio encoder was closed.');
            if (buffer.sampleRate !== SAMPLE_RATE || buffer.numberOfChannels !== CHANNELS || offset + buffer.length > samples) throw new Error('The audio mix did not match its timeline.');
            const data = new Float32Array(buffer.length * CHANNELS);
            for (let channel = 0; channel < CHANNELS; channel++) data.set(buffer.getChannelData(channel), channel * buffer.length);
            const frame = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfChannels: CHANNELS, numberOfFrames: buffer.length, timestamp: Math.round(offset / SAMPLE_RATE * 1000000), data });
            try { encoder.encode(frame); } finally { frame.close(); }
            offset += buffer.length;
            if (encoder.encodeQueueSize > 2) {
                let drain;
                try { await bounded(new Promise(resolve => { drain = () => { if (encoder.encodeQueueSize <= 2) resolve(); }; encoder.addEventListener('dequeue', drain); drain(); })); }
                finally { encoder.removeEventListener('dequeue', drain); }
            }
            await bounded(writes);
        },
        async close() {
            if (signal?.aborted) throw cancelled();
            await bounded(encoder.flush());
            await bounded(writes);
            if (offset !== samples || !packets) throw new Error('The audio encoder did not complete the timeline.');
            dispose(); source.close();
        },
        dispose,
    };
}
