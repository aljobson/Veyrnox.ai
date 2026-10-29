import { Text, Button, themedStyles, useThemedStyles } from './ui';
import { Link, type Href } from 'expo-router';
import { View } from 'react-native';

import { ds } from '../theme';
import { VeyCharacter } from './VeyCharacter';

// A list with nothing in it: Vey waves, the title says so, and there is one next step. Never a blank screen.
export function EmptyState({ title, body, actionLabel, href }: { title: string; body?: string; actionLabel?: string; href?: Href }) {
    const styles = useThemedStyles(sheets);
    return (
        <View style={styles.box}>
            <VeyCharacter width={64} mood="wave" interactive />
            <Text variant="title3" tone="primary" style={styles.title} accessibilityRole="header">{title}</Text>
            {body ? <Text variant="callout" tone="secondary" style={styles.body}>{body}</Text> : null}
            {actionLabel && href ? (
                <Link href={href} asChild>
                    <Button variant="secondary" accessibilityRole="button" label={actionLabel} />
                </Link>
            ) : null}
        </View>
    );
}

const sheets = themedStyles((p) => ({

    box: { alignItems: 'center', gap: ds.space.sm, paddingVertical: ds.space.xxl, paddingHorizontal: ds.space.lg },
    title: { color: p.textPrimary, textAlign: 'center' },
    body: { color: p.textSecondary, textAlign: 'center' },
}));
