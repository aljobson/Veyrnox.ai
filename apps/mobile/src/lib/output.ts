import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import * as Sharing from 'expo-sharing';

const EXTENSIONS: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
};

export function extensionFor(mime: string): string {
    return Object.hasOwn(EXTENSIONS, mime) ? EXTENSIONS[mime] : 'bin';
}

// The name comes from the job id, never from the link, so a hostile name cannot choose a path.
// The six stems a vocal/instrument split makes (lib/audioStems.mjs); only these may be added to a name.
export const STEMS = ['vocals', 'drums', 'bass', 'other', 'guitar', 'piano'] as const;

export function fileNameFor(jobId: string, mime: string, stem?: string): string {
    const short = /^[0-9a-f]{8}-/i.test(jobId) ? jobId.slice(0, 8).toLowerCase() : 'job';
    const part = stem && (STEMS as readonly string[]).includes(stem) ? `-${stem}` : '';
    return `veyrnox-${short}${part}.${extensionFor(mime)}`;
}

// The asset link lasts 15 minutes and is not kept: download it to the cache once, then hand the file on.
export async function downloadToCache(url: string, jobId: string, mime: string, stem?: string): Promise<string> {
    const file = await File.downloadFileAsync(url, new File(Paths.cache, fileNameFor(jobId, mime, stem)), { idempotent: true });
    return file.uri;
}

// Opens the system share sheet for the finished file.
export async function shareOutput(url: string, jobId: string, mime: string, stem?: string): Promise<void> {
    const uri = await downloadToCache(url, jobId, mime, stem);
    await Sharing.shareAsync(uri, { mimeType: mime });
}

// Adds a finished image or video to the photo library. Asks for add-only access, never read access.
// Returns false when the person declined, so the screen can say where to change it.
export async function saveOutput(url: string, jobId: string, mime: string): Promise<boolean> {
    const permission = await requestPermissionsAsync(true);
    if (!permission.granted) return false;
    const uri = await downloadToCache(url, jobId, mime);
    await Asset.create(uri);
    return true;
}
