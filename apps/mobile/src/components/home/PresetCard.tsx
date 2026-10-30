import { rawText } from '../../lib/i18n/translate';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../../lib/i18n';
import type { Preset } from '../../lib/presets';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';

export function PresetCard({ preset, price, onOpen }: { preset: Preset; price: string; onOpen: (preset: Preset) => void }) {
    const styles = useThemedStyles(sheets);
    const label = `${preset.title}, ${preset.modelName}, ${price}${preset.available ? '' : `, ${t('presets.unavailable')}`}`;
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} style={({ pressed }) => [styles.presetCard, pressed && styles.pressed]} onPress={() => onOpen(preset)}>
            <Card style={styles.mediaCard}>
                <View style={styles.presetMedia}>
                    {preset.posterUrl ? (
                        <Image source={{ uri: preset.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" alt="" accessibilityIgnoresInvertColors />
                    ) : (
                        <View style={styles.posterEmpty} />
                    )}
                    {preset.isNew ? (
                        <View style={styles.newBadge}>
                            <Text variant="micro" style={styles.newBadgeText}>
                                {t('explore.new')}
                            </Text>
                        </View>
                    ) : null}
                </View>
                <View style={styles.presetCopy}>
                    <Text variant="bodyStrong" style={styles.presetTitle} numberOfLines={2}>
                        {preset.title}
                    </Text>
                    <Text variant="caption" style={styles.presetModel} numberOfLines={1}>
                        {preset.modelName}
                    </Text>
                    {preset.sourceModel ? <Text variant="micro" style={styles.presetSource} numberOfLines={1}>{preset.sourcePlatform} · {preset.sourceModel}</Text> : null}
                    <Text variant="caption" style={styles.presetPrice}>
                        {price}
                    </Text>
                </View>
            </Card>
        </Pressable>
    );
}

const sheets = themedStyles((p) => ({
    mediaCard: { padding: 0, overflow: 'hidden' },
    pressed: { opacity: 0.86, transform: [{ scale: 0.992 }] },
    presetCard: { width: '48.4%' },
    presetMedia: {
        width: '100%',
        aspectRatio: 0.92,
        backgroundColor: p.borderSubtle,
    },
    posterEmpty: { flex: 1, backgroundColor: p.borderSubtle },
    newBadge: {
        position: 'absolute',
        start: 8,
        top: 8,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 4,
        backgroundColor: p.accent,
    },
    newBadgeText: { color: p.onAccent },
    presetCopy: { minHeight: 96, padding: 11, gap: 3 },
    presetTitle: { color: p.textPrimary },
    presetModel: { color: p.textTertiary },
    presetSource: { color: p.textTertiary },
    presetPrice: { color: p.warning, marginTop: 'auto' },
}));
