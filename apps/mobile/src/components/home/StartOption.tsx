import { rawText } from '../../lib/i18n/translate';
import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { MenuIcon } from '../../lib/menuIcons';
import { ds } from '../../theme';
import { Icon, Text, themedStyles, useThemedStyles } from '../ui';

export function StartOption({ href, icon, title, body, hint, divided = false, style }: { href: Href; icon: MenuIcon; title: string; body: string; hint: string; divided?: boolean; style: { minHeight: number } }) {
    const styles = useThemedStyles(sheets);
    return (
        <Link href={href} asChild>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={rawText(title)}
                accessibilityHint={rawText(hint)}
                style={StyleSheet.flatten([styles.startOption, divided && styles.startOptionDivided, style])}
            >
                <View style={styles.startIcon}>
                    <Icon name={icon} />
                </View>
                <View style={styles.startText}>
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
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
    },
    startOptionDivided: {
        borderTopColor: p.borderSubtle,
        borderTopWidth: StyleSheet.hairlineWidth,
    },
    startIcon: {
        width: 44,
        height: 44,
        borderRadius: ds.radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: p.surface,
    },
    startText: { flex: 1, gap: 3 },
    startTitle: { color: p.textPrimary },
    startBody: { color: p.textSecondary },
}));
