import { Text, View } from 'react-native';
import { t } from '../../../lib/i18n';
import type { TextClip, Timeline } from '../../../lib/nativeEditorModel';
import { Action, Choice } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import type { CaptionActions } from './useCaptionActions';
import { CAPTION_STYLE_PRESETS, captionStylePresetId } from '../../../lib/editorCaptionEdit';
export function CaptionFileSection({ timeline, selected, actions }: { timeline: Timeline; selected?: TextClip; actions: CaptionActions }) {
    const captionPresetIds = timeline.text.filter(item => item.caption !== false).map(item => captionStylePresetId(item.style));
    const activePreset = captionPresetIds.length && captionPresetIds.every(id => id === captionPresetIds[0]) ? captionPresetIds[0] : null;
    return <>
        <Action label={t('editorCaptionTools.import')} disabled={actions.busy || actions.sharing} onPress={actions.pick} />
        <Text style={styles.panelDetail}>{t('editorCaptionTools.importHelp')}</Text>
        {timeline.text.some(c => c.caption) ? <>
            <Action label={t('editorCaptionTools.shareSrt')} disabled={actions.busy || actions.sharing} onPress={() => actions.share('srt')} />
            <Action label={t('editorCaptionTools.shareVtt')} disabled={actions.busy || actions.sharing} onPress={() => actions.share('vtt')} />
            <Text style={styles.panelDetail}>{t('editorCaptionTools.exportHelp')}</Text>
            <Text accessibilityRole="header" style={styles.sectionTitle}>{t('editorCaptionTools.stylePicker')}</Text>
            <View style={styles.choices}>{CAPTION_STYLE_PRESETS.map(preset => <Choice key={preset.id}
                label={t(`editorCaptionTools.style.${preset.id}` as Parameters<typeof t>[0])} selected={activePreset === preset.id}
                onPress={() => actions.styleAll(preset.style)} />)}</View>
            <Action label={t('editorCaptionTools.styleAll')} disabled={actions.busy} onPress={() => actions.styleAll('web')} />
            {selected?.caption && selected.style ? <Action label={t('editorCaptionTools.styleSelected')} disabled={actions.busy}
                onPress={() => actions.styleAll(selected.style)} /> : null}
        </> : null}
    </>;
}
