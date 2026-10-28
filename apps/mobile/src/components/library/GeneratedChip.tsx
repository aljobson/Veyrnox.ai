import { View } from 'react-native';
import { Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';
export function GeneratedChip() {
    const styles = useThemedStyles(sheets);
    return <View style={styles.chip} accessibilityLabel={t('libraryCreate.generated')}><Text variant="caption" tone="primary">{t('libraryCreate.generated')}</Text></View>;
}
const sheets = themedStyles(p => ({ chip: { position: 'absolute', top: 4, end: 4, borderRadius: 8, padding: 4, backgroundColor: p.bgElevated1 } }));
