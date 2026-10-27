import { t } from '../lib/i18n';
import { Text, Card, themedStyles, useThemedStyles } from './ui';

import { freeLines, type FreeLeft } from '../lib/freeAllowance';
import { ds } from '../theme';

// Renders nothing when the server says the allowance is off, nothing is left, or the read failed (`left` is empty).
export function FreeAllowanceCard({ models, left }: { readonly models: readonly { readonly id: string; readonly name: string }[]; readonly left: FreeLeft }) {
    const styles = useThemedStyles(sheets);
    const lines = freeLines(left, models);
    if (lines.length === 0) return null;
    return (
        <Card style={styles.card} accessible accessibilityLabel={t('freeAllowanceCard.freetoday', { value1: lines.join('. ') })}>
            <Text variant="footnote" tone="secondary" accessibilityRole="header">{t('freeAllowanceCard.freetoday2')}</Text>
            {lines.map((l) => (
                <Text variant="callout" tone="secondary" key={l} style={styles.count}>
                    {l}
                </Text>
            ))}
        </Card>
    );
}

const sheets = themedStyles((p) => ({

    count: { fontVariant: ['tabular-nums'] },
    card: { backgroundColor: p.bgElevated1, borderColor: p.accent, borderWidth: 1, borderRadius: ds.radius.md, padding: ds.space.md, gap: ds.space.xs },
}));
