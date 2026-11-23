import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { formatNumber, t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { Action, PanelHeading } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import type { EditorMotionProcessingActions, EditorMotionProcessingError } from './useEditorMotionProcessing';

const key = (error: EditorMotionProcessingError) => error === 'source' ? 'editorNativeMotion.source' : error === 'stale' ? 'editorNativeMotion.stale'
    : error === 'disk-full' ? 'editorNativeMotion.storage' : error === 'unsupported-platform' ? 'editorNativeMotion.unavailable' : 'editorNativeMotion.failed';
export function NativeMotionProcessingSection({ actions }: { actions: EditorMotionProcessingActions }) {
    const busy = !!actions.progress;
    const checking = actions.checking ? t('editorScenes.checking') : null;
    const progress = actions.progress ? t('editorNativeMotion.progress', { stage: t(`editorNativeMotion.${actions.progress.stage}` as Parameters<typeof t>[0]), percent: formatNumber(actions.progress.value * 100, 0) }) : null;
    const error = actions.error ? t(key(actions.error)) : null;
    const done = actions.done ? t('editorNativeMotion.done') : null;
    useAnnouncement(error ?? done ?? progress ?? checking);
    return <View style={{ gap: ds.space.sm }}><PanelHeading title={t('editorNativeMotion.title')} detail={t('editorNativeMotion.help')} />
        {checking ? <Text style={styles.panelDetail}>{checking}</Text> : null}
        {!actions.checking && !actions.tools.length ? <Text style={styles.panelDetail}>{t('editorNativeMotion.unavailable')}</Text> : null}
        {actions.progress ? <Text accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(actions.progress.value * 100) }}
            style={styles.panelDetail}>{progress}</Text> : null}
        {error ? <Text style={styles.problem}>{error}</Text> : null}
        {done ? <Text style={styles.panelDetail}>{done}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }}>{actions.tools.map(tool => <Action key={tool}
            label={t(`editorNativeMotion.${tool}` as Parameters<typeof t>[0])} disabled={busy || !actions.sourceAvailable} onPress={() => actions.run(tool)} />)}
            {busy ? <Action label={t('editorScenes.cancel')} onPress={actions.cancel} /> : null}</View>
    </View>;
}
