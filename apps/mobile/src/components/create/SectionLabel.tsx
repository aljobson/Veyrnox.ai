import { Text, type TextProps } from '../ui';

// Preserve the casing chosen by each translation.
export function SectionLabel({ children, ...props }: Omit<TextProps, 'children'> & { children: string }) {
    return <Text {...props} variant="footnote" tone="secondary">{children}</Text>;
}
