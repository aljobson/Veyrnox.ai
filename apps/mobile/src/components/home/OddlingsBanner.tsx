import { Image } from 'expo-image';
import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../../lib/i18n';
import { Card, Text, themedStyles, useThemedStyles } from '../ui';

type Props = { href: Href; accessibilityLabel: string; accessibilityHint: string; imageUrl: string; title: string; body: string; action: string };
export function OddlingsBanner({ href, accessibilityLabel, accessibilityHint, imageUrl, title, body, action }: Props) {
    const styles = useThemedStyles(sheets);
    return (
        <Link href={href} asChild>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={accessibilityLabel}
                accessibilityHint={accessibilityHint}
                style={styles.heroCard}
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
    heroCard: {},
    heroMedia: { height: 205, backgroundColor: p.borderSubtle },
    heroShade: { position: 'absolute', inset: 0, backgroundColor: p.mediaShade },
    heroLabel: {
        position: 'absolute',
        left: 14,
        bottom: 14,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: p.borderStrong,
        backgroundColor: p.mediaShade,
        paddingHorizontal: 11,
        paddingVertical: 6,
    },
    heroLabelText: { color: p.onMedia },
    heroCopy: { padding: 20, gap: 10 },
    heroTitle: { color: p.textPrimary },
    heroBody: { color: p.textSecondary },
    heroAction: { color: p.accent, marginTop: 2 },
}));
