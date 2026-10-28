import { Link } from 'expo-router';
import { View } from 'react-native';
import { t } from '../../lib/i18n';
import { useBalance } from '../../lib/useBalance';
import { Text } from '../ui';
export function CreditBanner({ cost, animation = false }: { cost: number | null; animation?: boolean }) {
    const balance = useBalance();
    if (balance === null || cost === null || !Number.isFinite(balance) || !Number.isFinite(cost) || cost <= 0 || balance > cost * 2) return null;
    return <View style={{ gap: 6 }}>
        <Text accessibilityLiveRegion="polite">{t(balance < cost ? 'oddlingsStudio.insufficient' : 'oddlingsStudio.low')} {t(animation ? 'oddlingsStudio.balanceAnimation' : 'oddlingsStudio.balancePortrait', { balance, cost })}</Text>
        <Link href="/credits" style={{ minHeight: 44, paddingVertical: 12 }}>{t('oddlingsStudio.getCredits')}</Link>
    </View>;
}
