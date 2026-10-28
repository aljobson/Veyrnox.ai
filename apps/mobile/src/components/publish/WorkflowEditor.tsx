import { rawText } from '../../lib/i18n/translate';
import { Text as StatusText } from '../ui/Text';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { cleanWorkflowDraft, type WorkflowDraft } from '../../lib/publishWorkflows';
import { colors } from '../../theme';

interface Props {
    readonly initial: WorkflowDraft;
    readonly busy: boolean;
    readonly onSave: (draft: WorkflowDraft) => void;
    readonly onCancel: () => void;
}

const KINDS = [null, 'message', 'comment', 'review'] as const;
const MATCHES = ['contains', 'exact'] as const;

// The inline form for a workflow: what it listens to, the keyword, and the reply it suggests. Same fields and limits as the web.
export function WorkflowEditor({ initial, busy, onSave, onCancel }: Props) {
    const [draft, setDraft] = useState<WorkflowDraft>(initial);
    const [problem, setProblem] = useState<string | null>(null);

    function save() {
        const clean = cleanWorkflowDraft(draft);
        if (!clean) return setProblem(t('publish.fillinthenamekeywordandreply'));
        setProblem(null);
        onSave(clean);
    }

    return (
        <View style={styles.form}>
            <Field label={t('publish.name')} value={draft.name} max={80} onChange={(name) => setDraft({ ...draft, name })} />
            <Text style={styles.label}>{t('publish.listensto')}</Text>
            <View style={styles.row}>
                {KINDS.map((k) => (
                    <Chip key={k ?? 'any'} label={t(`publishWorkflows.kind.${k ?? 'any'}`)} on={draft.kind === k} onPress={() => setDraft({ ...draft, kind: k })} />
                ))}
            </View>
            <Text style={styles.label}>{t('publish.match')}</Text>
            <View style={styles.row}>
                {MATCHES.map((m) => (
                    <Chip key={m} label={t(`publishWorkflows.match.${m}`)} on={draft.matchMode === m} onPress={() => setDraft({ ...draft, matchMode: m })} />
                ))}
            </View>
            <Field label={t('publish.keyword')} value={draft.keyword} max={100} onChange={(keyword) => setDraft({ ...draft, keyword })} />
            <Field label={t('publish.suggestedreply')} value={draft.replyText} max={8000} multiline onChange={(replyText) => setDraft({ ...draft, replyText })} />
            {problem ? <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{problem}</StatusText> : null}
            <View style={styles.row}>
                <Pressable accessibilityRole="button" disabled={busy} style={[styles.save, touchTarget, busy && styles.off]} onPress={save}>
                    <Text style={styles.saveText}>{busy ? '…' : t('publish.save')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={onCancel}>
                    <Text style={styles.link}>{t('publish.cancel2')}</Text>
                </Pressable>
            </View>
        </View>
    );
}

function Field({ label, value, max, multiline, onChange }: { label: string; value: string; max: number; multiline?: boolean; onChange: (v: string) => void }) {
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput style={[styles.input, multiline && styles.multi]} value={value} onChangeText={onChange} maxLength={max} multiline={multiline} accessibilityLabel={rawText(label)} placeholderTextColor={colors.muted} />
        </View>
    );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
    return (
        <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} style={[styles.chip, touchTarget, on && styles.chipOn]} onPress={onPress}>
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    form: { gap: 10, paddingTop: 8 },
    field: { gap: 4 },
    label: { color: colors.muted, fontSize: 13 },
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    input: { color: colors.text, backgroundColor: colors.background, borderRadius: 10, borderColor: colors.borderStrong, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
    multi: { minHeight: 96, textAlignVertical: 'top' },
    chip: { justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    save: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 18, justifyContent: 'center' },
    saveText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
    link: { color: colors.accent, textDecorationLine: 'underline' },
    error: { color: colors.danger },
});
