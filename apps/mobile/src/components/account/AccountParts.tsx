import type { ReactNode } from 'react';
import { Card as Surface, Text, VividCard, themedStyles, useThemedStyles } from '../ui';
import type { MenuIcon } from '../../lib/menuIcons';
import type { VividHue } from '../../theme';

export function Card({ title, help, icon, hue, children }: { title: string; help?: string; icon?: MenuIcon; hue?: VividHue; children: ReactNode }) {
    const s = useThemedStyles(sheets);
    return <Surface style={s.card}>
        {icon && hue
            ? <VividCard hue={hue} icon={icon} title={title} detail={help} layout="row" accessibilityRole="header" />
            : <><Text variant="footnote" tone="secondary" accessibilityRole="header">{title}</Text>
                {help ? <Text variant="footnote" tone="secondary">{help}</Text> : null}</>}
        {children}
    </Surface>;
}

export function Status({ text, error }: { text: string | null; error?: boolean }) {
    if (!text) return null;
    return <Text variant="footnote" tone={error ? 'danger' : 'accent'} accessibilityRole={error ? 'alert' : undefined} accessibilityLiveRegion="polite">{text}</Text>;
}
const sheets = themedStyles(() => ({ card: { gap: 12 } }));
