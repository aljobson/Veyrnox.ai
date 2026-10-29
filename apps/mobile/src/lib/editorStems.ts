import type { ApiClient } from './api';
import { getCacheUser } from './appCache';
import { probeDuration } from './editorMediaDuration';
import { t } from './i18n';
import { mediaApi } from './media';
import type { Media } from './nativeEditorModel';
import { STEMS } from './output';

export type EditorStem = typeof STEMS[number];
const labels = { vocals: 'stem.vocals', drums: 'stem.drums', bass: 'stem.bass', other: 'stem.other', guitar: 'stem.guitar', piano: 'stem.piano' } as const;
export const stemLabel = (stem: EditorStem) => t(labels[stem]);
export async function libraryStems(api: ApiClient, jobId: string): Promise<EditorStem[]> {
    const owner = getCacheUser();
    try {
        const asset = await mediaApi(api).getAsset(jobId);
        if (getCacheUser() !== owner) return [];
        return STEMS.filter(stem => Array.isArray(asset.output_stems) && asset.output_stems.includes(stem));
    } catch { return []; }
}
export async function stemMedia(api: ApiClient, jobId: string, name: string, stem: EditorStem): Promise<Media | null> {
    const owner = getCacheUser();
    try {
        if (!STEMS.includes(stem)) return null;
        const asset = await mediaApi(api).getAsset(jobId, stem);
        if (getCacheUser() !== owner || new URL(asset.url).protocol !== 'https:' || !asset.mime_type.startsWith('audio/')) return null;
        const seconds = await probeDuration(asset.url);
        if (getCacheUser() !== owner || seconds === null || !Number.isFinite(seconds) || seconds <= 0) return null;
        return { id: `j-${jobId}--${stem}`, name: t('editorAi.stemName', { name, stem: stemLabel(stem) }).slice(0, 120),
            kind: 'audio', frames: Math.max(1, Math.floor(seconds * 30)), hasAudio: true, width: 0, height: 0 };
    } catch { return null; }
}
