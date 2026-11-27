import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { getCacheUser } from '../appCache';
import { createEditorMediaClient } from '../editorMedia';
import { putBeatTake, takeAsset, type AudioTake, type TakeAsset } from './takeShared';

const SAMPLE_RATE = 48_000;
const CHUNK_SECONDS = 30;
const MAX_SECONDS = 600;
const AUDIO_TYPES = [
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/wave',
    'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg',
];

export type DeviceAudioImport = { asset: TakeAsset; takeId: string };

const titleOf = (name: string) => name.replace(/\.[^.]+$/, '').trim().slice(0, 80) || 'Imported audio';

function readFloat32(bytes: Uint8Array, expectedFrames: number) {
    if (bytes.byteLength !== expectedFrames * 4) throw new Error('device_audio_invalid');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const result = new Float32Array(expectedFrames);
    for (let index = 0; index < result.length; index++) {
        const value = view.getFloat32(index * 4, true);
        if (!Number.isFinite(value)) throw new Error('device_audio_invalid');
        result[index] = value;
    }
    return result;
}

/** Pick an audio file, decode it to the editor's durable mono take format, and return a playable asset. */
export async function pickDeviceAudio(beatId: string): Promise<DeviceAudioImport | null> {
    const picked = await DocumentPicker.getDocumentAsync({ type: AUDIO_TYPES, copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return null;
    const selected = picked.assets[0];
    const owner = getCacheUser();
    if (!owner) throw new Error('account_required');

    const media = createEditorMediaClient();
    try {
        await media.setOwner(owner);
        const capability = await media.capabilities();
        if (!capability.available || !capability.operations.inspect || !capability.operations.decodePcm) throw new Error('device_audio_unavailable');
        const inspected = await media.inspect(beatId, selected.uri);
        if (!inspected.ok || !inspected.value.hasAudio) throw new Error('device_audio_invalid');
        const durationSec = Math.min(MAX_SECONDS, (inspected.value.audioDurationUs ?? inspected.value.durationUs) / 1_000_000);
        if (!(durationSec > 0)) throw new Error('device_audio_invalid');

        const chunks: Float32Array[] = [];
        let totalFrames = 0;
        for (let from = 0; from < durationSec; from += CHUNK_SECONDS) {
            if (owner !== getCacheUser()) throw new Error('account_changed');
            const to = Math.min(durationSec, from + CHUNK_SECONDS);
            const decoded = await media.decodePcm(beatId, {
                uri: selected.uri, fromSeconds: from, toSeconds: to,
                sampleRate: SAMPLE_RATE, channels: 1, mixMode: 'web-average',
            });
            if (!decoded.ok) throw new Error(decoded.code === 'cancelled' ? 'account_changed' : 'device_audio_invalid');
            try {
                const bytes = await new File(decoded.value.uri).bytes();
                const chunk = readFloat32(bytes, decoded.value.frames);
                chunks.push(chunk); totalFrames += chunk.length;
            } finally {
                await media.release(beatId, decoded.value.artifactId);
            }
        }
        if (!totalFrames) throw new Error('device_audio_invalid');
        const samples = new Float32Array(totalFrames);
        let offset = 0;
        for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
        const id = crypto.randomUUID();
        const row: AudioTake = {
            id, beatId, label: titleOf(selected.name), sampleRate: SAMPLE_RATE, samples,
            length: samples.length, createdAt: Date.now(), state: 'committed',
        };
        if (owner !== getCacheUser()) throw new Error('account_changed');
        await putBeatTake(row, () => { if (owner !== getCacheUser()) throw new Error('account_changed'); });
        return { asset: takeAsset(row), takeId: id };
    } finally {
        media.close();
    }
}
