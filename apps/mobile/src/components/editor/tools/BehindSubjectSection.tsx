import { Text, View } from 'react-native';
import { behindSubjectCandidates } from '../../../../../../app/veyrnox/_lib/editorBehindSubject.mjs';
import type { Clip, TextClip, Timeline } from '../../../lib/nativeEditorModel';
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
        <PanelHeading title="Behind subject" detail="Place this title or image between the original scene and a whole-person mask. The source media stays unchanged." />
        <View style={styles.choices}>
            <Choice label="Off" selected={!item.behindSubject} onPress={() => patch({ behindSubject: undefined })} />
            {subjects.map(subject => <Choice key={subject.id}
                label={timeline.media[subject.mediaId || '']?.name || 'Masked subject'}
                selected={item.behindSubject === subject.id}
                onPress={() => patch({ behindSubject: subject.id })} />)}
        </View>
        {item.behindSubject && !subjects.some(subject => subject.id === item.behindSubject)
            ? <Text style={styles.problem}>The masked subject no longer covers this overlay. Turn the effect off or adjust its timing.</Text> : null}
    </View>;
}
