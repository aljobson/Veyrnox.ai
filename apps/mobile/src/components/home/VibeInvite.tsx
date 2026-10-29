import { View } from 'react-native';
import { Button, Card, Text, themedStyles, useThemedStyles } from '../ui';
import { t } from '../../lib/i18n';

export function VibeInvite({ busy, onStart, onLater }: { busy: boolean; onStart(): void; onLater(): void }) {
    const styles = useThemedStyles(sheets);
    return <Card style={styles.card}>
        <Text variant="title3" accessibilityRole="header">{t('vibeInvite.title')}</Text>
        <Text tone="secondary">{t('vibeInvite.body')}</Text>
        <View style={styles.actions}>
            <Button label={t('vibeInvite.start')} onPress={onStart} />
            <Button variant="secondary" label={t('vibeInvite.later')} disabled={busy} onPress={onLater} />
        </View>
    </Card>;
}
const sheets = themedStyles(() => ({ card: { gap: 12 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 } }));
