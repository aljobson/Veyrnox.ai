import { Text as StatusText } from './ui/Text';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { touchTarget } from '../lib/a11y';
import { plural, t } from '../lib/i18n';
import { VeyCharacter } from './VeyCharacter';
import { colors } from '../theme';

// Shown when the balance is too low to start anything: what is left, and Buy credits one tap away.
export function LowBalanceNote({ balance }: { balance: number }) {
    const router = useRouter();
    return (
        <View style={styles.box}>
            <View style={styles.content}>
                <StatusText variant="inherit" accessibilityLiveRegion="polite" style={styles.text}>{t('lowBalance.body', { credits: plural('home.credits', balance) })}</StatusText>
                <Pressable accessibilityRole="button" style={[touchTarget, styles.action]} onPress={() => router.push('/credits')}>
                    <Text style={styles.actionText}>{t('lowBalance.buy')}</Text>
                </Pressable>
            </View>
            <VeyCharacter width={40} mood="worried" />
        </View>
    );
}

const styles = StyleSheet.create({
    content: { flex: 1, gap: 8 },
    box: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderColor: colors.money, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
    text: { color: colors.body, fontSize: 15, lineHeight: 22 },
    action: { alignSelf: 'flex-start', paddingHorizontal: 4 },
    actionText: { color: colors.money, fontSize: 16, fontWeight: '700' },
});
