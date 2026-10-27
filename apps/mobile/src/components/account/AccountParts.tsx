import type { ReactNode } from 'react';
import { Card as Surface, Text, themedStyles, useThemedStyles } from '../ui';

export function Card({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
    const s = useThemedStyles(sheets);
    return <Surface style={s.card}>
        <Text variant="footnote" tone="secondary" accessibilityRole="header">{title}</Text>
        {help ? <Text variant="footnote" tone="secondary">{help}</Text> : null}
        {children}
    </Surface>;
}

export function Status({ text, error }: { text: string | null; error?: boolean }) {
    if (!text) return null;
    return <Text variant="footnote" tone={error ? 'danger' : 'accent'} accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite">{text}</Text>;
}
const sheets = themedStyles(() => ({ card: { gap: 12 } }));
