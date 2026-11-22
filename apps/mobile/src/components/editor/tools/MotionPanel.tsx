import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t } from '../../../lib/i18n';
import { clipAt } from '../../../lib/nativeEditorModel';
import { styles } from '../fullEditorStyles';
import { TransformSection } from './TransformSection';
import { MotionPathSection } from './MotionPathSection';
import { PictureKeysSection } from './PictureKeysSection';
import type { ToolPanelProps } from './types';
export function MotionPanel({ timeline, selection, motionActions: actions }: Pick<ToolPanelProps, 'timeline' | 'selection' | 'motionActions'>) {
    const clip = clipAt(timeline, selection);
    if (!clip || !selection || selection.track === 'audio' || !actions) return <Text style={styles.body}>{t('editorMotion.selectMotion')}</Text>;
    return <View key={clip.id} style={{ gap: ds.space.md }}>
        {selection.track === 'video' ? <TransformSection clip={clip} actions={actions} /> : null}
        <MotionPathSection clip={clip} fps={timeline.fps} actions={actions} text={selection.track === 'text'} />
        {selection.track === 'video' ? <PictureKeysSection clip={clip} fps={timeline.fps} actions={actions} /> : null}
    </View>;
}
