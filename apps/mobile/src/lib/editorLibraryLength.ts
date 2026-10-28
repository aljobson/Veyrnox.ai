import type { ApiClient } from './api';
import { fetchClipLength } from './clipEdit';
import { probeDuration } from './editorMediaDuration';
import { exportSourceLink } from './editorServerExport';
import type { LibraryChoice } from './librarySource';
import type { Media } from './nativeEditorModel';
import type { SlotKind } from './sources';

export async function libraryMedia(api: ApiClient, choice: Pick<LibraryChoice, 'jobId' | 'name'>, kind: SlotKind): Promise<Media | null> {
    const media: Media = { id: `j-${choice.jobId}`, name: choice.name, kind, hasAudio: kind !== 'image', width: 0, height: 0 };
    if (kind === 'image') return { ...media, frames: 90 };
    try {
        let seconds = kind === 'video' ? await fetchClipLength(api, choice.jobId) : null;
        if (seconds === null) {
            const uri = await exportSourceLink(api, media);
            seconds = uri ? await probeDuration(uri) : null;
        }
        return seconds !== null && Number.isFinite(seconds) && seconds > 0 ? { ...media, frames: Math.max(1, Math.floor(seconds * 30)) } : null;
    } catch { return null; }
}
