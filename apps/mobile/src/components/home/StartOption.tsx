import { rawText } from '../../lib/i18n/translate';
import { Link, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { MenuIcon } from '../../lib/menuIcons';
import { ds, type FeatureHue } from '../../theme';
import { Icon, IconBadge, Text, themedStyles, usePressStyle, useThemedStyles } from '../ui';

export function StartOption({ href, icon, hue, title, body, hint, divided = false, badge, style, onPress }: { href: Href; onPress?: () => void; icon: MenuIcon; hue: FeatureHue; title: string; body: string; hint: string; divided?: boolean; badge?: string; style: { minHeight: number } }) {
    const styles = useThemedStyles(sheets);
    const pressStyle = usePressStyle('row');
    // Link asChild takes one flat style object, so the pressed look is tracked here, not in a style function.
    const [pressed, setPressed] = useState(false);
    return (
        <Link href={href} asChild onPress={onPress}>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={rawText(title)}
                accessibilityHint={rawText(hint)}
                onPressIn={() => setPressed(true)}
                onPressOut={() => setPressed(false)}
                style={StyleSheet.flatten([styles.startOption, divided && styles.startOptionDivided, style, pressed && pressStyle])}
            >
                <IconBadge icon={icon} hue={hue} size="md" />
                <View style={styles.startText}>
                    {badge ? <Text variant="caption" style={styles.startBadge}>{badge}</Text> : null}
                    <Text variant="title3" style={styles.startTitle}>
                        {title}
                    </Text>
                    <Text variant="footnote" style={styles.startBody}>
                        {body}
                    </Text>
                </View>
                <Icon name="caretRight" size={20} />
            </Pressable>
        </Link>
    );
}

const sheets = themedStyles((p) => ({
    startOption: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: ds.space.md,
        paddingHorizontal: ds.space.lg,
        paddingVertical: ds.space.md,
    },
    startOptionDivided: {
        borderTopColor: p.borderSubtle,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    startText: { flex: 1, gap: ds.space.xs },
    startBadge: { color: p.textSecondary },
    startTitle: { color: p.textPrimary },
    startBody: { color: p.textSecondary },
}));
