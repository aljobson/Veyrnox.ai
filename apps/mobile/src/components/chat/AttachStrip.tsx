import { Image } from 'expo-image';
import { ScrollView, StyleSheet, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { MAX_ATTACHMENTS, roomFor, type ChatImage } from '../../lib/chatAttach';
import { plural, t } from '../../lib/i18n';

import { Text, Button, Icon, themedStyles, useThemedStyles } from '../ui';

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
    const styles = useThemedStyles(sheets);
    const full = roomFor(items.length, max) === 0;
    return (
        <View style={[styles.wrap, embedded && styles.embedded]}>
            <View style={styles.row}>
                <Button accessibilityRole="button" accessibilityLabel={t('chat.attach.libraryLabel')} disabled={disabled || full} containerStyle={styles.btn} onPress={onLibrary} variant="secondary" size="md" label={t('chat.attach.libraryLabel')}>
                    <Icon name="image" size={20} />
                    <Text variant="footnote" style={styles.btnText}>{t('chat.attach.library')}</Text>
                </Button>
                <Button accessibilityRole="button" accessibilityLabel={t('chat.attach.photosLabel')} disabled={disabled || full} containerStyle={styles.btn} onPress={onPhotos} variant="secondary" size="md" label={t('chat.attach.photosLabel')}>
                    <Icon name="paperclip" size={20} />
                    <Text variant="footnote" style={styles.btnText}>{t('chat.attach.photos')}</Text>
                </Button>
                <Text variant="caption" tone="warning" style={styles.note}>{items.length > 0 ? <>{plural('chat.attach.extra', extra)}<Text variant="caption" tone="tertiary"> · {items.length}/{max}</Text></> : plural('chat.attach.hint', extra)}</Text>
            </View>
            {items.length > 0 ? (
                <ScrollView horizontal contentContainerStyle={styles.thumbs}>
                    {items.map((it, i) => (
                        <View key={it.id} style={styles.thumb}>
                            <Image source={it.preview ? { uri: it.preview } : undefined} style={styles.img} accessibilityLabel={t('chat.attach.imageN', { n: String(i + 1) })} />
                            <Button accessibilityRole="button" accessibilityLabel={t('chat.attach.removeN', { n: String(i + 1) })} disabled={disabled} containerStyle={styles.x} style={styles.removeBadge} hitSlop={{ top: 0, right: 0, bottom: 20, left: 20 }} onPress={() => onRemove(it.id)} variant="secondary" size="md" label={t('chat.attach.removeN', { n: String(i + 1) })}>
                                <Icon name="close" size={16} />
                            </Button>
                        </View>
                    ))}
                </ScrollView>
            ) : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({
    wrap: { paddingHorizontal: 12, paddingTop: 4 },
    embedded: { borderBottomWidth: 1, borderBottomColor: p.borderSubtle, paddingTop: 2, paddingBottom: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
    btn: { minHeight: MIN_TARGET, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
    btnText: { color: p.textPrimary },
    note: { flexShrink: 1 },
    thumbs: { gap: 8, paddingVertical: 4 },
    thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: p.bgElevated1 },
    img: { width: 64, height: 64, borderRadius: 8 },
    x: { position: 'absolute', top: 0, right: 0, width: MIN_TARGET, height: MIN_TARGET, alignItems: 'flex-end', justifyContent: 'flex-start' },
    removeBadge: { minWidth: 24, minHeight: 24, width: 24, height: 24, paddingHorizontal: 0, borderRadius: 12, backgroundColor: p.bgElevated2, borderWidth: StyleSheet.hairlineWidth, borderColor: p.borderSubtle },
}));
