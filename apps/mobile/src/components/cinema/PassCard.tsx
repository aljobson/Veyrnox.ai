import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { fetchPass, passIsLive, type Pass } from '../../lib/cinemaPass';
import { readOf } from '../../lib/cinemaSocial';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

const day = (iso: string) => new Date(iso).toLocaleDateString();

// Shows a Cinema Pass the account already has. No price and nothing to buy (ADR-0207); with no Pass, or while the Pass
// routes are closed, it shows nothing at all.
export function PassCard() {
    const { api } = useAuth();
    const [pass, setPass] = useState<Pass | null>(null);
    useEffect(() => {
        let live = true;
        readOf(() => fetchPass(api)).then((r) => { if (live && r.kind === 'ok') setPass(r.value); });
        return () => { live = false; };
    }, [api]);
    if (!pass || (pass.status === 'ended' && !pass.periodEnd)) return null;
    const live = passIsLive(pass);
    const line = pass.status === 'pending' ? t('cinemaPass.pending')
        : !live ? t('cinemaPass.ended')
            : pass.periodEnd ? t(pass.cancelsAtPeriodEnd ? 'cinemaPass.endsOn' : 'cinemaPass.renewsOn', { date: day(pass.periodEnd) })
                : t('cinemaPass.active');
    return (
        <View style={styles.card} accessible accessibilityLabel={`${t('cinemaPass.title')}. ${line}`}>
            <Text style={styles.heading} accessibilityRole="header">{t('cinemaPass.title')}</Text>
            <Text style={styles.body}>{line}</Text>
            <Text style={styles.muted}>{t('cinemaPass.manage')}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 4 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
    body: { color: colors.body, fontSize: 16 },
    muted: { color: colors.muted, fontSize: 13 },
});
