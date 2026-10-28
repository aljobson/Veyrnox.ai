import { formatNumber, t } from './i18n';
import type { EditorTrack } from './nativeEditorModel';
// Translate generated names at display time; keep saved names and ids untouched.
export function editorTrackLabel(track: Pick<EditorTrack, 'kind' | 'name' | 'id'>): string {
    const generated = /^(Video|Audio|Text) (\d+)$/.exec(track.name);
    if (generated && generated[1].toLowerCase() === track.kind) return `${t(`editor.track.${track.kind}`)} ${formatNumber(Number(generated[2]))}`;
    return track.name === track.id || track.name === track.kind ? t(`editor.track.${track.kind}`) : track.name;
}
