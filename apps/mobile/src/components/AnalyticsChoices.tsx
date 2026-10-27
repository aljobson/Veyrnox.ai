import { useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Chip, Icon, Text, themedStyles, useThemedStyles } from './ui';
import { chooseAnalytics, getAnalyticsChoice, isAnalyticsEnabled, readConsent, subscribeConsent } from '../lib/analytics';
import { t } from '../lib/i18n';
import { ds } from '../theme';
export function AnalyticsChoices({ onChosen }: { onChosen?: () => void }) {
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    const choice = useSyncExternalStore(subscribeConsent, getAnalyticsChoice);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    useEffect(() => { if (isAnalyticsEnabled()) void readConsent(); }, []);
    async function choose(value: 'granted' | 'denied') {
        if (busy) return;
        setBusy(true); setError(false);
        try { await chooseAnalytics(value); onChosen?.(); }
        catch { setError(true); }
        finally { setBusy(false); }
    }
    if (!isAnalyticsEnabled()) return null;
    return <ScrollView contentContainerStyle={styles.body}>
        <Card style={styles.card}>
            <Icon name="shieldCheck" />
            <Text variant="title1" accessibilityRole="header">{t(onChosen ? 'analyticsConsent.title' : 'analyticsConsent.choices')}</Text>
            <Text>{t('analyticsConsent.body')}</Text>
            <Text tone="secondary">{t('analyticsConsent.change')}</Text>
            <Button variant="tertiary" label={t('analyticsConsent.policy')} onPress={() => router.push('/legal/privacy')} />
            {onChosen ? <>
                <Button variant="secondary" label={t('analyticsConsent.allow')} disabled={busy} onPress={() => void choose('granted')} />
                <Button variant="secondary" label={t('analyticsConsent.decline')} disabled={busy} onPress={() => void choose('denied')} />
            </> : <>
                <Chip label={t('analyticsConsent.allow')} selected={choice === 'granted'} disabled={busy} onPress={() => void choose('granted')} />
                <Chip label={t('analyticsConsent.decline')} selected={choice === 'denied'} disabled={busy} onPress={() => void choose('denied')} />
            </>}
            {error ? <Text tone="danger">{t('analyticsConsent.saveError')}</Text> : null}
        </Card>
    </ScrollView>;
}
const sheets = themedStyles(p => ({
    body: { flexGrow: 1, justifyContent: 'center', backgroundColor: p.bg, padding: ds.space.gutter },
    card: { gap: ds.space.lg },
}));
