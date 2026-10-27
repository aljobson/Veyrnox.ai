import { useReducedMotion } from '../ui/useReducedMotion';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { switchableModels, type ChatModel } from '../../lib/chat';
import { plural, t } from '../../lib/i18n';
import { Text, Button, Card, themedStyles, useThemedStyles } from '../ui';
import { radius } from '../../theme';

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
    const styles = useThemedStyles(sheets);
    const reducedMotion = useReducedMotion();
    return (
        <Modal visible={visible} transparent animationType={reducedMotion ? 'none' : 'slide'} onRequestClose={onClose}>
            <Pressable style={styles.backdrop} accessibilityRole="button" accessibilityLabel={t('chat.model.close')} onPress={onClose} />
            <View style={styles.sheet}>
                <Text variant="title3" style={styles.title} accessibilityRole="header">{t('chat.model.title')}</Text>
                <ScrollView contentContainerStyle={styles.list}>
                    {switchableModels(models).map((m) => (
                        <Card key={m.id} accessibilityRole="radio" accessibilityLabel={`${m.name}, ${plural('chat.perReply', m.credits_per_reply)}`} accessibilityState={{ selected: m.id === currentId }} style={[styles.row]} onPress={() => onPick(m.id)} selected={m.id === currentId}>
                            <Text variant="body" style={styles.name}>{m.name}</Text>
                            <Text variant="footnote" style={styles.note}>{m.maker_label} · <Text variant="footnote" tone="warning">{plural('chat.perReply', m.credits_per_reply)}</Text></Text>
                        </Card>
                    ))}
                </ScrollView>
                <Button accessibilityRole="button" containerStyle={styles.close} onPress={onClose} variant="tertiary" size="md" label={(t('chat.model.close'))}><Text style={styles.closeText}>{t('chat.model.close')}</Text></Button>
            </View>
        </Modal>
    );
}

const sheets = themedStyles((p) => ({
    backdrop: { flex: 1, backgroundColor: p.scrim },
    sheet: { maxHeight: '70%', backgroundColor: p.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 16, paddingBottom: 28, gap: 10 },
    title: { color: p.textPrimary },
    list: { gap: 8 },
    row: { minHeight: MIN_TARGET, padding: 12 },
    name: { color: p.textPrimary },
    note: { color: p.textTertiary },
    close: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: p.accent },
}));
