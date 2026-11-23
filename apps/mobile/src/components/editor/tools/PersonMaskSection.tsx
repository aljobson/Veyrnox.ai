import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t } from '../../../lib/i18n';
import { useAnnouncement } from '../../../lib/useAnnouncement';
import { Action, PanelHeading } from '../EditorControls';
import { SegmentedChoice } from './SegmentedChoice';
import { styles } from '../fullEditorStyles';
import type { EditorPersonMaskActions, EditorPersonMaskError } from './useEditorPersonMask';

const errorKey = (error: EditorPersonMaskError) => error === 'source' ? 'editorPersonMask.source' : error === 'unsupported-source' ? 'editorPersonMask.moving'
    : error === 'stale' ? 'editorPersonMask.stale' : error === 'capture-failed' ? 'editorPersonMask.capture' : 'editorPersonMask.failed';
export function PersonMaskSection({ actions }: { actions: EditorPersonMaskActions }) {
    const busy = actions.status === 'processing';
    const processing = busy ? t('editorPersonMask.processing') : null;
    const error = actions.error ? t(errorKey(actions.error)) : null;
    const done = actions.done ? t('editorPersonMask.done') : null;
    useAnnouncement(error ?? done ?? processing);
    return <View style={{ gap: ds.space.sm }}><PanelHeading title={t('editorPersonMask.title')} detail={t('editorPersonMask.help')} />
        <SegmentedChoice label={t('editorPersonMask.category')} value={actions.category}
            options={actions.categories.map(value => ({ value, label: t(`editorPersonMask.${value}` as Parameters<typeof t>[0]) }))}
            onChange={value => actions.setCategory(value as typeof actions.category)} />
        {!actions.supported ? <Text style={styles.panelDetail}>{t('editorPersonMask.moving')}</Text> : null}
        {processing ? <Text accessibilityRole="progressbar" style={styles.panelDetail}>{processing}</Text> : null}
        {error ? <Text style={styles.problem}>{error}</Text> : null}
        {done ? <Text style={styles.panelDetail}>{done}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: ds.space.sm }}><Action label={t('editorPersonMask.start')} disabled={busy || !actions.supported} onPress={actions.apply} />
            {actions.applied ? <Action label={t('editorPersonMask.remove')} disabled={busy} danger onPress={actions.remove} /> : null}
            {busy ? <Action label={t('editorScenes.cancel')} onPress={actions.cancel} /> : null}</View>
    </View>;
}
