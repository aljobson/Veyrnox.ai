import { rawText } from '../../lib/i18n/translate';
import { Image } from 'expo-image';
import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../../lib/i18n';
import { ds } from '../../theme';
import { Card, Text, themedStyles, usePressStyle, useThemedStyles } from '../ui';

type Props = { href: Href; accessibilityLabel: string; accessibilityHint: string; imageUrl: string; title: string; body: string; action: string };
export function OddlingsBanner({ href, accessibilityLabel, accessibilityHint, imageUrl, title, body, action }: Props) {
    const styles = useThemedStyles(sheets);
    const pressStyle = usePressStyle('card');
    // Link asChild takes one flat style object, so the pressed look is tracked here, not in a style function.
    const [pressed, setPressed] = useState(false);
    return (
        <Link href={href} asChild>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={rawText(accessibilityLabel)}
                accessibilityHint={rawText(accessibilityHint)}
                onPressIn={() => setPressed(true)}
                onPressOut={() => setPressed(false)}
                style={pressed ? pressStyle : undefined}
            >
                <Card style={styles.mediaCard}>
                    <View style={styles.heroMedia}>
                        <Image
                            source={{
                                uri: imageUrl,
                            }}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                            alt=""
                            accessibilityIgnoresInvertColors
                        />
                        <View style={styles.heroShade} />
                        <View style={styles.heroLabel}>
                            <Text variant="micro" style={styles.heroLabelText}>
                                {t('appearance.fictionalCast')}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.heroCopy}>
                        <Text variant="title1" style={styles.heroTitle}>
                            {title}
                        </Text>
                        <Text variant="callout" style={styles.heroBody}>
                            {body}
                        </Text>
                        <Text variant="bodyStrong" style={styles.heroAction}>
                            {action}
                        </Text>
                    </View>
                </Card>
            </Pressable>
        </Link>
    );
}
const sheets = themedStyles((p) => ({
    mediaCard: { padding: 0, overflow: 'hidden' },
    heroMedia: { height: 205, backgroundColor: p.borderSubtle },
    heroShade: { position: 'absolute', inset: 0, backgroundColor: p.mediaShade },
    heroLabel: {
        position: 'absolute',
        start: ds.space.md,
        bottom: ds.space.md,
        borderRadius: ds.radius.pill,
        borderWidth: 1,
        borderColor: p.borderStrong,
        backgroundColor: p.mediaShade,
        paddingHorizontal: ds.space.md,
        paddingVertical: ds.space.xs,
    },
    heroLabelText: { color: p.onMedia },
    heroCopy: { padding: ds.space.xl, gap: ds.space.sm },
    heroTitle: { color: p.textPrimary },
    heroBody: { color: p.textSecondary },
    heroAction: { color: p.accent, marginTop: ds.space.xxs },
}));
