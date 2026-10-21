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
        if (!clean) return setProblem('Fill in the name, keyword and reply. They can be up to 80, 100 and 8000 characters.');
        setProblem(null);
        onSave(clean);
    }

    return (
        <View style={styles.form}>
            <Field label="Name" value={draft.name} max={80} onChange={(name) => setDraft({ ...draft, name })} />
            <Text style={styles.label}>Listens to</Text>
            <View style={styles.row}>
                {KINDS.map((k) => (
                    <Chip key={k ?? 'any'} label={t(`publishWorkflows.kind.${k ?? 'any'}`)} on={draft.kind === k} onPress={() => setDraft({ ...draft, kind: k })} />
                ))}
            </View>
            <Text style={styles.label}>Match</Text>
            <View style={styles.row}>
                {MATCHES.map((m) => (
                    <Chip key={m} label={t(`publishWorkflows.match.${m}`)} on={draft.matchMode === m} onPress={() => setDraft({ ...draft, matchMode: m })} />
                ))}
            </View>
            <Field label="Keyword" value={draft.keyword} max={100} onChange={(keyword) => setDraft({ ...draft, keyword })} />
            <Field label="Suggested reply" value={draft.replyText} max={8000} multiline onChange={(replyText) => setDraft({ ...draft, replyText })} />
            {problem ? <Text style={styles.error} accessibilityRole="alert">{problem}</Text> : null}
            <View style={styles.row}>
                <Pressable accessibilityRole="button" disabled={busy} style={[styles.save, touchTarget, busy && styles.off]} onPress={save}>
                    <Text style={styles.saveText}>{busy ? '…' : 'Save'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} style={touchTarget} onPress={onCancel}>
                    <Text style={styles.link}>Cancel</Text>
                </Pressable>
            </View>
        </View>
    );
}

function Field({ label, value, max, multiline, onChange }: { label: string; value: string; max: number; multiline?: boolean; onChange: (v: string) => void }) {
    return (
        <View style={styles.field}>
            <Text style={styles.label}>{label}</Text>
            <TextInput style={[styles.input, multiline && styles.multi]} value={value} onChangeText={onChange} maxLength={max} multiline={multiline} accessibilityLabel={label} placeholderTextColor={colors.muted} />
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
    input: { color: colors.text, backgroundColor: colors.background, borderRadius: 10, borderColor: colors.border, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
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
