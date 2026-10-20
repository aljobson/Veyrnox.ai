import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

export interface PickChoice {
    readonly value: string;
    readonly label: string;
    readonly swatch?: string | null;
}

interface Props {
    title: string;
    choices: readonly PickChoice[];
    value: string;
    onPick: (value: string) => void;
    onClose: () => void;
}

// One group's options in a list. "Not set" clears the pick.
export function PickSheet({ title, choices, value, onPick, onClose }: Props) {
    const rows: readonly PickChoice[] = [{ value: '', label: t('oddlings.build.notSet') }, ...choices];
    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <View style={styles.sheet}>
                <View style={styles.bar}>
                    <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>{title}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={t('oddlings.build.done')} style={styles.done} onPress={onClose}>
                        <Text style={styles.doneText}>{t('oddlings.build.done')}</Text>
                    </Pressable>
                </View>
                <FlatList
                    data={rows}
                    keyExtractor={(item) => item.value || '__none'}
                    initialNumToRender={20}
                    renderItem={({ item }) => {
                        const on = item.value === value;
                        return (
                            <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} style={styles.row} onPress={() => { onPick(item.value); onClose(); }}>
                                {item.swatch ? <View style={[styles.dot, { backgroundColor: item.swatch }]} /> : null}
                                <Text style={[styles.label, on && styles.labelOn]}>{item.label}</Text>
                                {on ? <Text style={styles.check} accessible={false}>✓</Text> : null}
                            </Pressable>
                        );
                    }}
                />
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    sheet: { flex: 1, backgroundColor: colors.background },
    bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    title: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700', paddingVertical: 14 },
    done: { minHeight: MIN_TARGET, minWidth: MIN_TARGET, justifyContent: 'center', alignItems: 'center' },
    doneText: { color: colors.accent, fontSize: 16, fontWeight: '700' },
    row: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
    dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong },
    label: { flex: 1, color: colors.body, fontSize: 16 },
    labelOn: { color: colors.accent, fontWeight: '700' },
    check: { color: colors.accent, fontSize: 18 },
});
