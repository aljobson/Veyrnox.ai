import { Text } from 'react-native';
import { t } from '../../../lib/i18n';
import type { TextClip, Timeline } from '../../../lib/nativeEditorModel';
import { Action } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import type { CaptionActions } from './useCaptionActions';
export function CaptionFileSection({ timeline, selected, actions }: { timeline: Timeline; selected?: TextClip; actions: CaptionActions }) {
    return <>
        <Action label={t('editorCaptionTools.import')} disabled={actions.busy} onPress={actions.pick} />
        <Text style={styles.panelDetail}>{t('editorCaptionTools.importHelp')}</Text>
        {timeline.text.some(c => c.caption) ? <>
            <Action label={t('editorCaptionTools.shareSrt')} disabled={actions.busy} onPress={() => actions.share('srt')} />
            <Action label={t('editorCaptionTools.shareVtt')} disabled={actions.busy} onPress={() => actions.share('vtt')} />
            <Text style={styles.panelDetail}>{t('editorCaptionTools.exportHelp')}</Text>
            <Action label={t('editorCaptionTools.styleAll')} disabled={actions.busy} onPress={() => actions.styleAll('web')} />
            {selected?.caption && selected.style ? <Action label={t('editorCaptionTools.styleSelected')} disabled={actions.busy}
                onPress={() => actions.styleAll(selected.style)} /> : null}
        </> : null}
    </>;
}
