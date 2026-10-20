import { Link, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import { colors } from '../theme';

// A list with nothing in it: say so, and give the one next step. Never a blank screen.
export function EmptyState({ title, body, actionLabel, href }: { title: string; body?: string; actionLabel?: string; href?: Href }) {
    return (
        <View style={styles.box}>
            <Text style={styles.title} accessibilityRole="header">{title}</Text>
            {body ? <Text style={styles.body}>{body}</Text> : null}
            {actionLabel && href ? (
                <Link href={href} asChild>
                    <Pressable accessibilityRole="button" style={[touchTarget, styles.action]}>
                        <Text style={styles.actionText}>{actionLabel}</Text>
                    </Pressable>
                </Link>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { alignItems: 'center', gap: 10, paddingVertical: 32, paddingHorizontal: 16 },
    title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
    body: { color: colors.body, fontSize: 15, lineHeight: 22, textAlign: 'center' },
    action: { backgroundColor: colors.accent, borderRadius: 12, paddingHorizontal: 20, alignItems: 'center', marginTop: 4 },
    actionText: { color: colors.accentInk, fontSize: 16, fontWeight: '700' },
});
