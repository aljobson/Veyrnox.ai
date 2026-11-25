import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, Icon, Text, themedStyles, useThemedStyles } from '../../components/ui';
import { usePush } from '../../push/pushContext';
import { t } from '../../lib/i18n';
import type { EnableResult } from '../../push/pushContext';
import { ds } from '../../theme';
import { captureEvent } from '../../lib/analytics/events';
import { completeNotificationPrimer } from '../../lib/notificationPrimer';

// The explanatory screen always comes first. The one-shot iOS/Android permission dialog is requested only from the
// explicit primary button below, never on mount, launch or one of the early personalisation questions.
export default function NotificationPrimer() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const push = usePush();
    const styles = useThemedStyles(sheets);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<EnableResult | null>(null);

    useEffect(() => {
        captureEvent('notification_primer_viewed', { trigger: 'generation' });
        void completeNotificationPrimer();
    }, []);

    const returnToCreation = () => {
        if (router.canGoBack()) router.back();
        else router.replace('/');
    };
    const continueToApp = () => {
        captureEvent('notification_primer_finished', { action: 'later' });
        returnToCreation();
    };
    const enable = async () => {
        if (busy) return;
        setBusy(true);
        const next = await push.setEnabled(true);
        setResult(next);
        setBusy(false);
        captureEvent('notification_primer_finished', {
            action: next === 'on' ? 'allow' : next === 'denied' ? 'denied' : 'unavailable',
        });
        if (next === 'on') returnToCreation();
    };

    return (
        <ScrollView style={styles.screen} contentContainerStyle={[styles.body, { paddingTop: insets.top + ds.space.xxxl, paddingBottom: insets.bottom + ds.space.xxl }]} showsVerticalScrollIndicator={false}>
            <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
            <View style={styles.bell} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <Icon name="envelope" size={28} />
                <View style={styles.badge}><Text variant="caption" style={styles.badgeText}>1</Text></View>
            </View>
            <Text variant="caption" tone="accent">{t('onboarding.notifications.kicker')}</Text>
            <Text variant="display" accessibilityRole="header">{t('onboarding.notifications.title')}</Text>
            <Text tone="secondary">{t('onboarding.notifications.body')}</Text>
            <Card style={styles.preview} accessible accessibilityLabel={t('onboarding.notifications.privacy')}>
                <View style={styles.previewTop}>
                    <View style={styles.appIcon}><Icon name="sparkle" size={20} /></View>
                    <View style={styles.previewCopy}><Text variant="bodyStrong">{t('onboarding.notifications.app')}</Text><Text variant="footnote" tone="secondary">{t('onboarding.notifications.now')}</Text></View>
                </View>
                <Text variant="bodyStrong">{t('onboarding.notifications.previewTitle')}</Text>
                <Text variant="footnote" tone="secondary">{t('onboarding.notifications.previewBody')}</Text>
            </Card>
            <View style={styles.privacyRow}><Icon name="shieldCheck" size={20} /><Text variant="footnote" tone="secondary" style={styles.privacyText}>{t('onboarding.notifications.privacy')}</Text></View>
            {result === 'denied' ? (
                <Card style={styles.note}>
                    <Text tone="secondary">{t('onboarding.notifications.denied')}</Text>
                    <Button variant="secondary" label={t('onboarding.notifications.settings')} onPress={() => void Linking.openSettings()} />
                </Card>
            ) : result === 'unavailable' ? <Text tone="secondary" accessibilityRole="alert">{t('onboarding.notifications.unavailable')}</Text> : null}
            <View style={styles.actions}>
                <Button label={t('onboarding.notifications.allow')} loading={busy} onPress={() => void enable()} />
                <Button variant="tertiary" label={t('onboarding.notifications.later')} disabled={busy} onPress={continueToApp} />
            </View>
        </ScrollView>
    );
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
    body: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: ds.space.gutter, gap: ds.space.lg },
    bell: { width: 76, height: 76, borderRadius: ds.radius.xl, backgroundColor: p.accentSubtle, alignItems: 'center', justifyContent: 'center' },
    badge: { position: 'absolute', right: -3, top: -3, width: 26, height: 26, borderRadius: 13, backgroundColor: p.rose, borderWidth: 3, borderColor: p.bg, alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: p.onAccent },
    preview: { gap: ds.space.sm },
    previewTop: { flexDirection: 'row', alignItems: 'center', gap: ds.space.sm },
    appIcon: { width: 36, height: 36, borderRadius: ds.radius.sm, backgroundColor: p.accentSubtle, alignItems: 'center', justifyContent: 'center' },
    previewCopy: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', gap: ds.space.sm },
    privacyRow: { flexDirection: 'row', gap: ds.space.sm, alignItems: 'center' },
    privacyText: { flex: 1 },
    note: { gap: ds.space.md, borderColor: p.notice },
    actions: { gap: ds.space.sm, marginTop: ds.space.sm },
}));
