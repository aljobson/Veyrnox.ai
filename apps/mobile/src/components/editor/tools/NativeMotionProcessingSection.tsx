import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { formatNumber, t } from '../../../lib/i18n';
import { Action, PanelHeading } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import type { EditorMotionProcessingActions, EditorMotionProcessingError } from './useEditorMotionProcessing';

const key = (error: EditorMotionProcessingError) => error === 'source' ? 'editorNativeMotion.source' : error === 'stale' ? 'editorNativeMotion.stale'
    : error === 'disk-full' ? 'editorNativeMotion.storage' : error === 'unsupported-platform' ? 'editorNativeMotion.unavailable' : 'editorNativeMotion.failed';
export function NativeMotionProcessingSection({ actions }: { actions: EditorMotionProcessingActions }) {
    const busy = !!actions.progress;
    return <View style={{ gap: ds.space.sm }}><PanelHeading title={t('editorNativeMotion.title')} detail={t('editorNativeMotion.help')} />
        {actions.checking ? <Text accessibilityLiveRegion="polite" style={styles.panelDetail}>{t('editorScenes.checking')}</Text> : null}
        {!actions.checking && !actions.tools.length ? <Text style={styles.panelDetail}>{t('editorNativeMotion.unavailable')}</Text> : null}
        {actions.progress ? <Text accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(actions.progress.value * 100) }}
            style={styles.panelDetail}>{t('editorNativeMotion.progress', { stage: t(`editorNativeMotion.${actions.progress.stage}` as Parameters<typeof t>[0]), percent: formatNumber(actions.progress.value * 100, 0) })}</Text> : null}
        {actions.error ? <Text accessibilityRole="alert" style={styles.problem}>{t(key(actions.error))}</Text> : null}
        {actions.done ? <Text accessibilityLiveRegion="polite" style={styles.panelDetail}>{t('editorNativeMotion.done')}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }}>{actions.tools.map(tool => <Action key={tool}
            label={t(`editorNativeMotion.${tool}` as Parameters<typeof t>[0])} disabled={busy || !actions.sourceAvailable} onPress={() => actions.run(tool)} />)}
            {busy ? <Action label={t('editorScenes.cancel')} onPress={actions.cancel} /> : null}</View>
    </View>;
}
