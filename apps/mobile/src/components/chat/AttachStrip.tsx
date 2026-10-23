import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { MAX_ATTACHMENTS, roomFor, type ChatImage } from '../../lib/chatAttach';
import { plural, t } from '../../lib/i18n';
import { MENU_ICONS } from '../../lib/menuIcons';
import { colors } from '../../theme';

interface Props {
    readonly items: readonly ChatImage[];
    readonly extra: number;
    readonly max?: number;
    readonly disabled?: boolean;
    readonly embedded?: boolean;
    readonly onLibrary: () => void;
    readonly onPhotos: () => void;
    readonly onRemove: (id: string) => void;
}

// The images for the next reply, and how to add more. The extra credits are shown here, before anything is sent.
export function AttachStrip({ items, extra, max = MAX_ATTACHMENTS, disabled, embedded = false, onLibrary, onPhotos, onRemove }: Props) {
    const full = roomFor(items.length, max) === 0;
    return (
        <View style={[styles.wrap, embedded && styles.embedded]}>
            <View style={styles.row}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('chat.attach.libraryLabel')} disabled={disabled || full} style={[styles.btn, (disabled || full) && styles.off]} onPress={onLibrary}>
                    <Image source={MENU_ICONS.image} style={styles.btnIcon} tintColor={colors.text} contentFit="contain" accessibilityElementsHidden />
                    <Text style={styles.btnText}>{t('chat.attach.library')}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t('chat.attach.photosLabel')} disabled={disabled || full} style={[styles.btn, (disabled || full) && styles.off]} onPress={onPhotos}>
                    <Image source={MENU_ICONS.paperclip} style={styles.btnIcon} tintColor={colors.text} contentFit="contain" accessibilityElementsHidden />
                    <Text style={styles.btnText}>{t('chat.attach.photos')}</Text>
                </Pressable>
                <Text style={styles.note}>{items.length > 0 ? `${plural('chat.attach.extra', extra)} · ${items.length}/${max}` : plural('chat.attach.hint', extra)}</Text>
            </View>
            {items.length > 0 ? (
                <ScrollView horizontal contentContainerStyle={styles.thumbs}>
                    {items.map((it, i) => (
                        <View key={it.id} style={styles.thumb}>
                            <Image source={it.preview ? { uri: it.preview } : undefined} style={styles.img} accessibilityLabel={t('chat.attach.imageN', { n: String(i + 1) })} />
                            <Pressable accessibilityRole="button" accessibilityLabel={t('chat.attach.removeN', { n: String(i + 1) })} disabled={disabled} style={styles.x} onPress={() => onRemove(it.id)}>
                                <Text style={styles.xText}>×</Text>
                            </Pressable>
                        </View>
                    ))}
                </ScrollView>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: { paddingHorizontal: 12, paddingTop: 4 },
    embedded: { borderBottomWidth: 1, borderBottomColor: colors.border, paddingTop: 2, paddingBottom: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
    btn: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 10 },
    btnIcon: { width: 18, height: 18 },
    btnText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    off: { opacity: 0.4 },
    note: { color: colors.muted, fontSize: 12, flexShrink: 1 },
    thumbs: { gap: 8, paddingVertical: 4 },
    thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: colors.surface },
    img: { width: 64, height: 64, borderRadius: 8 },
    x: { position: 'absolute', top: -10, right: -10, width: MIN_TARGET, height: MIN_TARGET, alignItems: 'center', justifyContent: 'center' },
    xText: { color: colors.text, backgroundColor: colors.border, width: 22, height: 22, borderRadius: 11, textAlign: 'center', lineHeight: 22, overflow: 'hidden' },
});
