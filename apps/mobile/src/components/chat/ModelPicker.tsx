import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { switchableModels, type ChatModel } from '../../lib/chat';
import { plural, t } from '../../lib/i18n';
import { colors, radius } from '../../theme';

interface Props {
    readonly visible: boolean;
    readonly currentId: string;
    readonly models: readonly ChatModel[];
    readonly onPick: (id: string) => void;
    readonly onClose: () => void;
}

// A short list of the models a chat can switch to, opened from the model name in the chat itself. Choosing one hands the id
// back and the parent saves it and closes the list; the price shows next to each name, as in the full chat settings.
export function ModelPicker({ visible, currentId, models, onPick, onClose }: Props) {
    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
            <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel={t('chat.model.close')} onPress={onClose} />
            <View style={styles.sheet}>
                <Text style={styles.title} accessibilityRole="header">{t('chat.model.title')}</Text>
                <ScrollView contentContainerStyle={styles.list}>
                    {switchableModels(models).map((m) => (
                        <Pressable key={m.id} accessibilityRole="radio" accessibilityLabel={`${m.name}, ${plural('chat.perReply', m.credits_per_reply)}`} accessibilityState={{ selected: m.id === currentId }} style={[styles.row, m.id === currentId && styles.on]} onPress={() => onPick(m.id)}>
                            <Text style={styles.name}>{m.name}</Text>
                            <Text style={styles.note}>{m.maker_label} · {plural('chat.perReply', m.credits_per_reply)}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
                <Pressable accessibilityRole="button" style={styles.close} onPress={onClose}><Text style={styles.closeText}>{t('chat.model.close')}</Text></Pressable>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
    sheet: { maxHeight: '70%', backgroundColor: colors.background, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, paddingBottom: 28, gap: 10 },
    title: { color: colors.text, fontSize: 18, fontWeight: '600' },
    list: { gap: 8 },
    row: { minHeight: MIN_TARGET, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
    on: { borderColor: colors.accent, backgroundColor: colors.surface },
    name: { color: colors.text, fontSize: 16 },
    note: { color: colors.muted, fontSize: 13 },
    close: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: colors.accent },
});
