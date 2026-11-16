import { Alert } from 'react-native';
import { t } from '../../lib/i18n';
import { editorTrackLabel } from '../../lib/editorTrackLabel';
import { canRemoveTrack, emptyExtraTracks, removeTrack, type Timeline } from '../../lib/nativeEditorModel';

/** Remove-empty-track actions for the pro editor: a track-name tap and a toolbar command, both undoable via `apply`. */
/** `latest` reads the live document so a confirmation never applies a stale snapshot over an import that landed meanwhile. */
export function useEditorTrackActions(timeline: Timeline, latest: () => Timeline, apply: (next: Timeline) => void) {
    const empty = emptyExtraTracks(timeline);
    const confirm = (title: string, run: () => void) => Alert.alert(title, t('editor.removetrackbody'), [
        { text: t('projects.cancel'), style: 'cancel' }, { text: t('editor.removetrack'), style: 'destructive', onPress: run },
    ]);
    return {
        emptyCount: empty.length,
        pressTrack(trackId: string) {
            const track = timeline.tracks.find((item) => item.id === trackId);
            if (!track || !canRemoveTrack(timeline, trackId)) return;
            confirm(t('editor.removetracktitle', { value1: editorTrackLabel(track) }), () => { const next = removeTrack(latest(), trackId); if (next) apply(next); });
        },
        removeEmptyTracks() {
            if (!empty.length) return;
            confirm(t('editor.removeemptytracks', { value1: empty.map(editorTrackLabel).join(', ') }), () => {
                const current = latest();
                let next: Timeline = current;
                for (const track of empty) next = removeTrack(next, track.id) ?? next;
                if (next !== current) apply(next);
            });
        },
    };
}
