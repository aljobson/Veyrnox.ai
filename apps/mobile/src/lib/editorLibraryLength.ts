import type { ApiClient } from './api';
import { isAccountChanged } from './auth/tokenUser';
import { fetchClipLength } from './clipEdit';
import { probeDuration } from './editorMediaDuration';
import { exportSourceLink } from './editorServerExport';
import type { LibraryChoice } from './librarySource';
import type { Media } from './nativeEditorModel';
import type { SlotKind } from './sources';

export const LIBRARY_STOPPED = Symbol('library-stopped');
type Choice = Pick<LibraryChoice, 'jobId' | 'name'>;
export function libraryMedia(api: ApiClient, choice: Choice, kind: SlotKind): Promise<Media | null>;
export function libraryMedia(api: ApiClient, choice: Choice, kind: SlotKind, alive: () => boolean): Promise<Media | null | typeof LIBRARY_STOPPED>;
export async function libraryMedia(api: ApiClient, choice: Choice, kind: SlotKind, alive: () => boolean = () => true): Promise<Media | null | typeof LIBRARY_STOPPED> {
    if (!alive()) return LIBRARY_STOPPED;
    const media: Media = { id: `j-${choice.jobId}`, name: choice.name, kind, hasAudio: kind !== 'image', width: 0, height: 0 };
    if (kind === 'image') return { ...media, frames: 90 };
    try {
        let seconds = kind === 'video' ? await fetchClipLength(api, choice.jobId) : null;
        if (!alive()) return LIBRARY_STOPPED;
        if (seconds === null) {
            const uri = await exportSourceLink(api, media);
            if (!alive()) return LIBRARY_STOPPED;
            seconds = uri ? await probeDuration(uri) : null;
        }
        if (!alive()) return LIBRARY_STOPPED;
        return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? { ...media, frames: Math.max(1, Math.floor(seconds * 30)) } : null;
    } catch (error) { if (isAccountChanged(error)) throw error; return null; }
}
