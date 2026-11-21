import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t, formatNumber } from '../../../lib/i18n';
import type { Clip } from '../../../lib/nativeEditorModel';
import { exportRefusal } from '../../../lib/editorExportRefusal';
import { Action, PanelHeading } from '../EditorControls';
import { styles } from '../fullEditorStyles';
import { useEditorFrame } from '../editorFrameStore';
import { EasingChoice } from './MotionPathSection';
import type { MotionActions } from './useMotionActions';
export function PictureKeysSection({ clip, fps, actions }: { clip: Clip; fps: number; actions: MotionActions }) {
    const at = useEditorFrame(actions.frameStore) - clip.start, keys = clip.parameterKeyframes ?? [];
    return <View style={{ gap: ds.space.sm }}>
        <PanelHeading detail="" title={t('editorMotion.picture')} />
        <Action label={t('editorMotion.addPicture')} disabled={at < 0 || at >= clip.len || keys.length >= 40} onPress={actions.addPicture} />
        {keys.map((key, index) => <View key={index} style={{ gap: ds.space.sm }}>
            <Text style={styles.fieldLabel}>{t('editorMotion.point', { n: index + 1, s: formatNumber(key.frame / fps, 2) })}</Text>
            <EasingChoice value={String(key.easing)} onChange={value => actions.pictureEasing(index, value)} />
            <Action label={t('editorMotion.deletePicture', { n: index + 1 })} onPress={() => actions.removePicture(index)} />
        </View>)}
        <Action label={t('editorMotion.clearPicture')} disabled={!keys.length} onPress={actions.clearPicture} />
        <Text style={styles.muted}>{t('editorMotion.pictureHelp')}</Text>
        <Text style={styles.muted}>{t('editorMotion.pictureNote')}</Text>
        {keys.length ? <Text style={styles.muted}>{exportRefusal('parameterKeyframes')}</Text> : null}
    </View>;
}
