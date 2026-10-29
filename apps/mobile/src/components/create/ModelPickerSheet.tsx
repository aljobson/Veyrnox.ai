import { Modal, Pressable, ScrollView, View } from 'react-native';
import { Icon, Text, themedStyles, useThemedStyles } from '../ui';
import { rawText } from '../../lib/i18n/translate';
import { plural, t } from '../../lib/i18n';
import { freeLeftFor } from '../../lib/createOptions';
import type { FreeLeft } from '../../lib/freeAllowance';
import type { CatalogModel } from '../../lib/media';
import { MIN_TARGET, selectedState } from '../../lib/a11y';
import { ds } from '../../theme';

interface ModelPickerSheetProps {
    readonly visible: boolean;
    readonly models: readonly CatalogModel[];
    readonly currentId: string;
    readonly freeLeft: FreeLeft;
    readonly onPick: (id: string) => void;
    readonly onClose: () => void;
}

// "Change model" on the Create form: a native page sheet (swipe down to close) listing the models that do the same
// job. Names only, with today's free runs where there are some; the form's Generate button shows the exact cost.
export function ModelPickerSheet({ visible, models, currentId, freeLeft, onPick, onClose }: ModelPickerSheetProps) {
    const styles = useThemedStyles(sheets);
    return (
        <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={styles.sheet}>
                <View style={styles.head}>
                    <Text variant="title3" tone="primary" accessibilityRole="header" style={styles.title}>{t('chat.model.title')}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('common.close')} onPress={onClose} hitSlop={8} style={styles.close}>
                        <Icon name="close" size={20} />
                    </Pressable>
                </View>
                <ScrollView contentContainerStyle={styles.list}>
                    {models.map((m) => {
                        const current = m.id === currentId;
                        const free = freeLeftFor(freeLeft, m.id);
                        return (
                            <Pressable key={m.id} accessibilityRole="button" accessibilityState={selectedState(current)}
                                accessibilityLabel={rawText(free > 0 ? t('create.freeLeftLabel', { name: m.name, count: String(free) }) : m.name)}
                                onPress={() => onPick(m.id)}
                                style={({ pressed }) => [styles.row, current && styles.rowCurrent, pressed && styles.pressed]}>
                                <View style={styles.rowText}>
                                    <Text variant="bodyStrong" tone="primary">{m.name}</Text>
                                    {free > 0 ? <Text variant="footnote" tone="accent">{plural('create.freeLeft', free)}</Text> : null}
                                </View>
                                {current ? <Icon name="check" size={20} tint={styles.accentInk.color} /> : null}
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>
        </Modal>
    );
}

const sheets = themedStyles((p) => ({
    accentInk: { color: p.accent },
    sheet: { flex: 1, backgroundColor: p.bg },
    head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: ds.space.md, paddingHorizontal: ds.space.lg, paddingTop: ds.space.lg, paddingBottom: ds.space.sm },
    title: { flex: 1, color: p.textPrimary },
    close: { width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderRadius: MIN_TARGET / 2, backgroundColor: p.bgElevated1 },
    list: { padding: ds.space.lg, paddingTop: ds.space.sm, gap: ds.space.sm },
    row: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: ds.space.md, paddingHorizontal: ds.space.md, paddingVertical: ds.space.sm, borderRadius: ds.radius.md, borderWidth: 1, borderColor: p.borderSubtle, backgroundColor: p.bgElevated1 },
    rowCurrent: { borderColor: p.accent },
    rowText: { flex: 1, gap: ds.space.xxs },
    pressed: { opacity: 0.7 },
}));
