import { randomUUID } from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ApiError } from '../api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGE_MARKER = '.created';
const isTimestamp = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const MAX_AGE = 24 * 60 * 60 * 1000;
const active = new Set<string>();
const formats: Record<string, { extension: string; UTI?: string }> = {
    'application/zip': { extension: 'zip', UTI: 'public.zip-archive' },
    'audio/mpeg': { extension: 'mp3', UTI: 'public.mp3' },
    'audio/wav': { extension: 'wav', UTI: 'com.microsoft.waveform-audio' },
    'audio/x-wav': { extension: 'wav', UTI: 'com.microsoft.waveform-audio' },
    'audio/mp4': { extension: 'm4a', UTI: 'public.mpeg-4-audio' },
    'audio/aac': { extension: 'aac', UTI: 'public.aac-audio' },
    'audio/flac': { extension: 'flac', UTI: 'org.xiph.flac' },
    'audio/ogg': { extension: 'ogg', UTI: 'org.xiph.ogg' },
};
export class StemFileError extends ApiError {
    constructor(readonly reason: 'size_mismatch' | 'unavailable' | 'transfer_failed') {
        super(0, 'stem_share_failed');
        this.name = 'StemFileError';
    }
}
const stagingRoot = () => new Directory(Paths.cache, 'veyrnox-stem-share');
const removeAttempt = (directory: Directory) => {
    try { directory.delete(); } catch { /* Cache cleanup is best effort. */ }
};

// Expo's modern directory info and file modificationTime are milliseconds since epoch.
export function sweepStemFiles(): void {
    try {
        const root = stagingRoot(), prefix = `${root.uri.replace(/\/$/, '')}/`;
        if (!root.exists) return;
        for (const entry of root.list()) {
            if (!(entry instanceof Directory) || active.has(entry.uri)) continue;
            const relative = entry.uri.startsWith(prefix) ? entry.uri.slice(prefix.length).replace(/\/$/, '') : '';
            if (!UUID.test(relative)) continue; // Only direct attempt directories within our root.
            try {
                const info = entry.info();
                const times = [info.modificationTime, ...entry.list().map(file => file instanceof File ? file.modificationTime : null)]
                    .filter(isTimestamp);
                let timestamp = times.length ? Math.max(...times) : info.creationTime;
                if (!isTimestamp(timestamp)) {
                    const marker = new File(entry, AGE_MARKER).textSync();
                    timestamp = /^\d+$/.test(marker) ? Number(marker) : undefined;
                }
                if (isTimestamp(timestamp) && Date.now() - timestamp > MAX_AGE) removeAttempt(entry);
            } catch { /* One inaccessible attempt must not prevent sweeping the others. */ }
        }
    } catch { /* A missing or inaccessible cache must not prevent sharing. */ }
}

type StemFile = {
    url: string; mimeType: string; sizeBytes: number; requestId: string;
    kind: 'archive' | 'target' | 'residual' | 'export'; isCurrent(): boolean;
};
export async function shareStemFile({ url, mimeType, sizeBytes, requestId, kind, isCurrent }: StemFile): Promise<void> {
    sweepStemFiles();
    if (!isCurrent()) return;
    const format = Object.hasOwn(formats, mimeType) ? formats[mimeType] : { extension: 'bin' };
    const id = UUID.test(requestId) ? requestId.toLowerCase() : 'request';
    const part = kind === 'target' || kind === 'residual' || kind === 'export' ? kind : 'archive';
    const attempt = new Directory(stagingRoot(), randomUUID());
    let created = false, handedOver = false;
    active.add(attempt.uri);
    try {
        // Refuse an existing attempt rather than ever overwriting a shared attachment.
        attempt.create({ intermediates: true });
        created = true;
        const marker = new File(attempt, AGE_MARKER);
        marker.create();
        marker.writeSync(String(Date.now()));
        const file = await File.downloadFileAsync(url, new File(attempt, `veyrnox-${id}-${part}.${format.extension}`), { idempotent: true });
        if (!isCurrent()) return;
        if (file.size !== sizeBytes) throw new StemFileError('size_mismatch');
        if (!isCurrent()) return;
        const available = await Sharing.isAvailableAsync();
        if (!isCurrent()) return;
        if (!available) throw new StemFileError('unavailable');
        const options = { mimeType, ...(format.UTI ? { UTI: format.UTI } : {}) };
        if (!isCurrent()) return;
        // Retain even on a share rejection: the platform may already have handed out a URI.
        handedOver = true;
        await Sharing.shareAsync(file.uri, options);
    } catch (error) {
        // Native download errors may contain the signed URL; expose only a fixed error code.
        if (isCurrent()) throw error instanceof StemFileError ? error : new StemFileError('transfer_failed');
    } finally {
        active.delete(attempt.uri);
        if (created && !handedOver) removeAttempt(attempt);
    }
}
