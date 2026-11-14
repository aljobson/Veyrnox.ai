import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { plural, t } from '../lib/i18n';
import { ds } from '../theme';
import { Button, Card, PriceText, themedStyles, useThemedStyles } from './ui';
import { VeyCharacter } from './VeyCharacter';

// Shown when the balance is too low to start anything: what is left, and Buy credits one tap away.
export function LowBalanceNote({ balance }: { balance: number }) {
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const credits = plural('home.credits', balance);
    return (
        <Card style={styles.box}>
            <View style={styles.content}>
                <PriceText variant="callout" tone="secondary" accessibilityLiveRegion="polite" text={t('lowBalance.body', { credits })} price={credits} />
                <Button variant="secondary" size="md" label={t('lowBalance.buy')} containerStyle={styles.action} onPress={() => router.push('/credits')} />
            </View>
            <VeyCharacter width={40} mood="worried" />
        </Card>
    );
}

const sheets = themedStyles(() => ({
    box: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    content: { flex: 1, gap: ds.space.sm },
    action: { alignSelf: 'flex-start' },
}));
