import { Text } from './ui/Text';
import { themedStyles, useThemedStyles } from './ui/AppearanceContext';
export function AddressText({ address, label }: { address: string; label?: string }) {
    const styles = useThemedStyles(sheets);
    return <Text variant="footnote" tone="secondary" selectable style={styles.address}>{label ? `${label}: ` : ''}{address}</Text>;
}
const sheets = themedStyles(() => ({ address: { flexShrink: 1 } }));
