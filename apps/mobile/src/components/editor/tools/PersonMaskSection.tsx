import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t } from '../../../lib/i18n';
import { Action, PanelHeading } from '../EditorControls';
import { SegmentedChoice } from './SegmentedChoice';
import { styles } from '../fullEditorStyles';
import type { EditorPersonMaskActions, EditorPersonMaskError } from './useEditorPersonMask';

const errorKey = (error: EditorPersonMaskError) => error === 'source' ? 'editorPersonMask.source' : error === 'unsupported-source' ? 'editorPersonMask.moving'
    : error === 'stale' ? 'editorPersonMask.stale' : error === 'capture-failed' ? 'editorPersonMask.capture' : 'editorPersonMask.failed';
export function PersonMaskSection({ actions }: { actions: EditorPersonMaskActions }) {
    const busy = actions.status === 'processing';
    return <View style={{ gap: ds.space.sm }}><PanelHeading title={t('editorPersonMask.title')} detail={t('editorPersonMask.help')} />
        <SegmentedChoice label={t('editorPersonMask.category')} value={actions.category}
            options={actions.categories.map(value => ({ value, label: t(`editorPersonMask.${value}` as Parameters<typeof t>[0]) }))}
            onChange={value => actions.setCategory(value as typeof actions.category)} />
        {!actions.supported ? <Text style={styles.panelDetail}>{t('editorPersonMask.moving')}</Text> : null}
        {busy ? <Text accessibilityRole="progressbar" accessibilityLiveRegion="polite" style={styles.panelDetail}>{t('editorPersonMask.processing')}</Text> : null}
        {actions.error ? <Text accessibilityRole="alert" style={styles.problem}>{t(errorKey(actions.error))}</Text> : null}
        {actions.done ? <Text accessibilityLiveRegion="polite" style={styles.panelDetail}>{t('editorPersonMask.done')}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }}><Action label={t('editorPersonMask.start')} disabled={busy || !actions.supported} onPress={actions.apply} />
            {actions.applied ? <Action label={t('editorPersonMask.remove')} disabled={busy} danger onPress={actions.remove} /> : null}
            {busy ? <Action label={t('editorScenes.cancel')} onPress={actions.cancel} /> : null}</View>
    </View>;
}
