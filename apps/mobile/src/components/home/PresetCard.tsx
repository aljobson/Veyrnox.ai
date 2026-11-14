import { rawText } from '../../lib/i18n/translate';
import { Image } from 'expo-image';
import { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { FeatureIcon } from '../../lib/featureIcons';
import { t } from '../../lib/i18n';
import { kindOf, type Kind } from '../../lib/media';
import type { Preset } from '../../lib/presets';
import { ds, featureHue } from '../../theme';
import { Card, IconBadge, Text, themedStyles, useAppearance, usePressStyle, useThemedStyles } from '../ui';

// What stands in for a missing poster: the icon and colour of what the template makes.
const FALLBACK: Readonly<Record<Kind, FeatureIcon>> = {
    image: { icon: 'image', hue: 'sky' },
    video: { icon: 'video', hue: 'iris' },
    audio: { icon: 'audio', hue: 'rose' },
};
const OTHER: FeatureIcon = { icon: 'squares', hue: 'mint' };

export function PresetCard({ preset, price, onOpen }: { preset: Preset; price: string; onOpen: (preset: Preset) => void }) {
    const styles = useThemedStyles(sheets);
    const pressStyle = usePressStyle();
    const { scheme } = useAppearance();
    const label = `${preset.title}, ${preset.modelName}, ${price}${preset.available ? '' : `, ${t('presets.unavailable')}`}`;
    const kind = kindOf(preset.modality);
    const fallback = kind ? FALLBACK[kind] : OTHER;
    const wash = featureHue(fallback.hue, scheme).wash;
    const washStyle = useMemo(() => ({ backgroundColor: wash }), [wash]);
    return (
        <Pressable accessibilityRole="button" accessibilityLabel={rawText(label)} style={({ pressed }) => [styles.presetCard, pressed && pressStyle]} onPress={() => onOpen(preset)}>
            <Card style={styles.mediaCard}>
                <View style={styles.presetMedia}>
                    {preset.posterUrl ? (
                        <Image source={{ uri: preset.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" alt="" accessibilityIgnoresInvertColors />
                    ) : (
                        <View style={styles.posterEmpty}>
                            <View style={[styles.posterWash, washStyle]}>
                                <IconBadge {...fallback} size="lg" />
                            </View>
                        </View>
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
    presetCard: { width: '48.4%' },
    presetMedia: {
        width: '100%',
        aspectRatio: 0.92,
        backgroundColor: p.borderSubtle,
    },
    // An opaque base under the wash, so the tint reads the same on every theme.
    posterEmpty: { flex: 1, backgroundColor: p.bgElevated1 },
    posterWash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    newBadge: {
        position: 'absolute',
        start: ds.space.sm,
        top: ds.space.sm,
        borderRadius: ds.radius.pill,
        paddingHorizontal: ds.space.sm,
        paddingVertical: ds.space.xs,
        backgroundColor: p.accent,
    },
    newBadgeText: { color: p.onAccent },
    presetCopy: { minHeight: 96, padding: ds.space.md, gap: ds.space.xs },
    presetTitle: { color: p.textPrimary },
    presetModel: { color: p.textTertiary },
    presetPrice: { color: p.warning, marginTop: 'auto' },
}));
