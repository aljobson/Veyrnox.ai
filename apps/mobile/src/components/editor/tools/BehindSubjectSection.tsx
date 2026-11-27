import { Text, View } from 'react-native';
import { behindSubjectCandidates } from '../../../../../../app/veyrnox/_lib/editorBehindSubject.mjs';
import type { Clip, TextClip, Timeline } from '../../../lib/nativeEditorModel';
import { t } from '../../../lib/i18n';
import { ds } from '../../../theme';
import { styles } from '../fullEditorStyles';
import { Choice, PanelHeading } from '../EditorControls';

export function BehindSubjectSection({ timeline, item, patch }: {
    timeline: Timeline;
    item: Clip | TextClip;
    patch(value: Partial<Clip & TextClip>): void;
}) {
    const subjects = behindSubjectCandidates(timeline, item);
    if (!subjects.length && !item.behindSubject) return null;
    return <View style={{ gap: ds.space.sm }}>
        <PanelHeading title={t('editor.behindSubject')} detail={t('editor.behindSubjectHelp')} />
        <View style={styles.choices}>
            <Choice label={t('editor.safeArea.off')} selected={!item.behindSubject} onPress={() => patch({ behindSubject: undefined })} />
            {subjects.map(subject => <Choice key={subject.id}
                label={timeline.media[subject.mediaId || '']?.name || t('editor.maskedSubject')}
                selected={item.behindSubject === subject.id}
                onPress={() => patch({ behindSubject: subject.id })} />)}
        </View>
        {item.behindSubject && !subjects.some(subject => subject.id === item.behindSubject)
            ? <Text style={styles.problem}>{t('editor.behindSubjectMissing')}</Text> : null}
    </View>;
}
