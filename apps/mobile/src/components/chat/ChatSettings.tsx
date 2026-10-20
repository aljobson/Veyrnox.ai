import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { MAX_SYSTEM_PROMPT, settingsPatch, switchableModels, type ChatModel, type ChatThread } from '../../lib/chat';
import { plural, t } from '../../lib/i18n';
import { colors } from '../../theme';

interface Props {
    readonly visible: boolean;
    readonly thread: Pick<ChatThread, 'model_id' | 'system_prompt'>;
    readonly models: readonly ChatModel[];
    readonly onSave: (patch: { model_id?: string; system_prompt?: string }) => Promise<void>;
    readonly onClose: () => void;
}

// Which model answers, and the chat's instructions. Nothing is sent until the person sends a message, and the price of the
// model shows next to its name; changing the model changes what the next reply costs, not what an earlier one did.
export function ChatSettings({ visible, thread, models, onSave, onClose }: Props) {
    const [modelId, setModelId] = useState(thread.model_id);
    const [instructions, setInstructions] = useState(thread.system_prompt ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const patch = settingsPatch(thread, { model_id: modelId, instructions });

    async function save() {
        if (!patch || busy) return;
        setBusy(true);
        setError(null);
        try {
            await onSave(patch);
            onClose();
        } catch {
            setError(t('chat.settings.failed'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
            <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Text style={styles.title} accessibilityRole="header">{t('chat.settings.title')}</Text>
                <Text style={styles.heading} accessibilityRole="header">{t('chat.settings.model')}</Text>
                {switchableModels(models).map((m) => (
                    <Pressable key={m.id} accessibilityRole="radio" accessibilityLabel={`${m.name}, ${plural('chat.perReply', m.credits_per_reply)}`} accessibilityState={{ selected: m.id === modelId }} style={[styles.row, m.id === modelId && styles.on]} onPress={() => setModelId(m.id)}>
                        <Text style={styles.name}>{m.name}</Text>
                        <Text style={styles.note}>{m.maker_label} · {plural('chat.perReply', m.credits_per_reply)}</Text>
                    </Pressable>
                ))}
                <Text style={styles.heading} accessibilityRole="header">{t('chat.settings.instructions')}</Text>
                <TextInput style={styles.input} value={instructions} onChangeText={setInstructions} multiline maxLength={MAX_SYSTEM_PROMPT} placeholder={t('chat.settings.instructionsHint')} accessibilityLabel={t('chat.settings.instructions')} placeholderTextColor={colors.muted} />
                <Text style={styles.note}>{t('chat.settings.count', { n: String(instructions.length), max: String(MAX_SYSTEM_PROMPT) })}</Text>
                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <Pressable accessibilityRole="button" disabled={!patch || busy} style={[styles.save, (!patch || busy) && styles.off]} onPress={save}>
                    {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.saveText}>{t('chat.settings.save')}</Text>}
                </Pressable>
                <Pressable accessibilityRole="button" style={styles.close} onPress={onClose}><Text style={styles.closeText}>{t('chat.settings.close')}</Text></Pressable>
            </ScrollView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingTop: 56, gap: 10 },
    title: { color: colors.text, fontSize: 20, fontWeight: '600' },
    heading: { color: colors.muted, fontSize: 13, fontWeight: '700', marginTop: 8 },
    row: { minHeight: MIN_TARGET, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
    on: { borderColor: colors.accent, backgroundColor: colors.surface },
    name: { color: colors.text, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
    input: { color: colors.text, backgroundColor: colors.surface, borderRadius: 12, padding: 12, minHeight: 120, maxHeight: 260 },
    error: { color: colors.danger },
    save: { minHeight: MIN_TARGET, borderRadius: 12, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    saveText: { color: colors.accentInk, fontWeight: '600' },
    off: { opacity: 0.4 },
    close: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: colors.accent },
});
