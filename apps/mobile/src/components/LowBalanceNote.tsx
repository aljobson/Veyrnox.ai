import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { colors } from '../theme';

// Shown when the balance is too low to start anything: what is left, and Buy credits one tap away.
export function LowBalanceNote({ balance }: { balance: number }) {
    const router = useRouter();
    return (
        <View style={styles.box} accessibilityLiveRegion="polite">
            <Text style={styles.text}>{t('lowBalance.body', { credits: plural('home.credits', balance) })}</Text>
            <Pressable accessibilityRole="button" style={[touchTarget, styles.action]} onPress={() => router.push('/credits')}>
                <Text style={styles.actionText}>{t('lowBalance.buy')}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    box: { backgroundColor: colors.surface, borderColor: colors.money, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
    text: { color: colors.body, fontSize: 15, lineHeight: 22 },
    action: { alignSelf: 'flex-start', paddingHorizontal: 4 },
    actionText: { color: colors.money, fontSize: 16, fontWeight: '700' },
});
