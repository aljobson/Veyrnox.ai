import { Text, View } from 'react-native';
import { ds } from '../../../theme';
import { t } from '../../../lib/i18n';
import { clipAt } from '../../../lib/nativeEditorModel';
import { styles } from '../fullEditorStyles';
import { MaskSection } from './MaskSection';
import { SmartPictureSection } from './SmartPictureSection';
import type { ToolPanelProps } from './types';
import { PersonMaskSection } from './PersonMaskSection';
export function MaskPanel({ timeline, selection, maskActions: actions, personMaskActions }: Pick<ToolPanelProps, 'timeline' | 'selection' | 'maskActions' | 'personMaskActions'>) {
    const clip = clipAt(timeline, selection);
    if (!clip || selection?.track !== 'video' || !actions) return <Text style={styles.body}>{t('editorMotion.selectVideo')}</Text>;
    return <View key={clip.id} style={{ gap: ds.space.md }}>
        <MaskSection clip={clip} fps={timeline.fps} actions={actions} />
        <SmartPictureSection clip={clip} actions={actions} />
        {personMaskActions ? <PersonMaskSection actions={personMaskActions} /> : null}
    </View>;
}
