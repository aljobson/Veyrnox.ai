import { useReducedMotion } from '../ui/useReducedMotion';
import { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { MAX_SYSTEM_PROMPT, settingsPatch, switchableModels, type ChatModel, type ChatThread } from '../../lib/chat';
import { plural, t } from '../../lib/i18n';
import { Text, TextField, Button, Card, Icon, themedStyles, useThemedStyles } from '../ui';

interface Props {
    readonly visible: boolean;
    readonly instructionsLocked?: boolean;
    readonly thread: Pick<ChatThread, 'model_id' | 'system_prompt'>;
    readonly models: readonly ChatModel[];
    readonly onSave: (patch: { model_id?: string; system_prompt?: string }) => Promise<void>;
    readonly onClose: () => void;
}

// Which model answers, and the chat's instructions. Nothing is sent until the person sends a message, and the price of the
// model shows next to its name; changing the model changes what the next reply costs, not what an earlier one did.
export function ChatSettings({ visible, thread, models, onSave, onClose, instructionsLocked = false }: Props) {
    const styles = useThemedStyles(sheets);
    const reducedMotion = useReducedMotion();
    const [modelId, setModelId] = useState(thread.model_id);
    const [instructions, setInstructions] = useState(thread.system_prompt ?? '');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const patch = settingsPatch(thread, { model_id: modelId, instructions: instructionsLocked ? thread.system_prompt ?? '' : instructions });

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
        <Modal visible={visible} animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose}>
            <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
                <Button accessibilityRole="button" accessibilityLabel={t('chat.settings.back')} containerStyle={styles.back} onPress={onClose} variant="tertiary" size="md" label={t('chat.settings.back')}><Icon name="arrowLeft" size={20} /><Text style={styles.closeText}>{t('chat.settings.back')}</Text></Button>
                <Text variant="title2" style={styles.title} accessibilityRole="header">{t('chat.settings.title')}</Text>
                <Text variant="footnote" style={styles.heading} accessibilityRole="header">{t('chat.settings.model')}</Text>
                {switchableModels(models).map((m) => (
                    <Card key={m.id} accessibilityRole="radio" accessibilityLabel={`${m.name}, ${plural('chat.perReply', m.credits_per_reply)}`} accessibilityState={{ selected: m.id === modelId }} style={[styles.row]} onPress={() => setModelId(m.id)} selected={m.id === modelId}>
                        <Text variant="body" style={styles.name}>{m.name}</Text>
                        <Text variant="footnote" style={styles.note}>{m.maker_label} · <Text variant="footnote" tone="warning">{plural('chat.perReply', m.credits_per_reply)}</Text></Text>
                    </Card>
                ))}
                <Text variant="footnote" style={styles.heading} accessibilityRole="header">{t('chat.settings.instructions')}</Text>
                {instructionsLocked ? <><Text selectable>{thread.system_prompt ?? ''}</Text><Text variant="footnote">{t('oddlingsStudio.instructionsLocked')}</Text></> : <>
                <TextField style={styles.input} value={instructions} onChangeText={setInstructions} multiline maxLength={MAX_SYSTEM_PROMPT} placeholder={t('chat.settings.instructionsHint')} accessibilityLabel={t('chat.settings.instructions')} />
                <Text variant="footnote" style={styles.note}>{t('chat.settings.count', { n: String(instructions.length), max: String(MAX_SYSTEM_PROMPT) })}</Text></>}

                {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
                <Button accessibilityRole="button" disabled={!patch || busy} containerStyle={styles.save} onPress={save} variant="secondary" size="md" label={(t('chat.settings.save'))}>
                    {busy ? <ActivityIndicator color={styles.accentInkInk.color} /> : <Text variant="bodyStrong" style={styles.saveText}>{t('chat.settings.save')}</Text>}
                </Button>
                <Button accessibilityRole="button" containerStyle={styles.close} onPress={onClose} variant="tertiary" size="md" label={(t('chat.settings.close'))}><Text style={styles.closeText}>{t('chat.settings.close')}</Text></Button>
            </ScrollView>
        </Modal>
    );
}

const sheets = themedStyles((p) => ({
    accentInkInk: { color: p.textPrimary },
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: 16, paddingTop: 56, gap: 10 },
    title: { color: p.textPrimary },
    heading: { color: p.textTertiary, marginTop: 8 },
    row: { minHeight: MIN_TARGET, padding: 12 },
    name: { color: p.textPrimary },
    note: { color: p.textTertiary },
    input: { minHeight: 120, maxHeight: 260 },
    error: { color: p.danger },
    save: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
    saveText: { color: p.textPrimary },
    back: { minHeight: MIN_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
    close: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: p.accent },
}));
