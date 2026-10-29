import { Pressable, Text, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { useAnnouncement } from '../../lib/useAnnouncement';
import { Action, PanelHeading } from './EditorControls';
import { styles } from './fullEditorStyles';
import type { GenerationRow } from './useEditorGenerationReturns';

const statuses = { queued: 'job.queued', running: 'job.running', notAdded: 'editorAi.notAdded', removed: 'editorAi.removed' } as const;
export function EditorGeneratePanel({ rows, note, onOpen, onAdd, onDismiss }: {
    rows: GenerationRow[]; note: string | null; onOpen(): void; onAdd(jobId: string): void; onDismiss(jobId: string): void;
}) {
    useAnnouncement(note);
    return <>
        <PanelHeading title={t('editor.generate')} detail="" />
        <Text style={styles.body}>{t('editorAi.body')}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t('editor.generate')} style={[styles.primary, touchTarget]} onPress={onOpen}><Text style={styles.primaryText}>{t('editor.generate')}</Text></Pressable>
        {rows.map(row => <View key={row.jobId} style={styles.workflowCard}>
            <Text style={styles.rowTitle}>{row.name}</Text>
            <Text style={styles.body}>{row.status === 'placed' ? t('editorAi.added', { name: row.name }) : t(statuses[row.status])}</Text>
            {row.status === 'notAdded' || row.status === 'removed' ? <>
                <Action label={t('editorAi.addAtPlayhead')} onPress={() => onAdd(row.jobId)} />
                <Action label={t('editorAi.dismiss')} onPress={() => onDismiss(row.jobId)} />
            </> : null}
        </View>)}
        {note ? <Text style={styles.body}>{note}</Text> : null}
    </>;
}
