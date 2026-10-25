import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useBilling } from '../billing/BillingProvider';
import { touchTarget } from '../lib/a11y';
import { renewalTerms, toDisplayPackages } from '../lib/billing';
import { t } from '../lib/i18n';
import { VeyCardPeek } from './VeyCardPeek';
import { colors } from '../theme';

export type LockedFeature = 'calendar' | 'analytics' | 'inbox' | 'ads' | 'commerce';
const store = Platform.OS === 'ios' ? 'ios' : 'android';

// ADR-0162: what a free account sees where the web shows an "Unlock ..." card. The price is the store's own, weekly,
// monthly and annual, read from RevenueCat; there is no link to a web checkout (ADR-0109). `onUnlocked` runs after a
// completed purchase so the screen can load again; the server stays the authority on whether the plan is on.
export function UnlockCard({ feature, onUnlocked }: { feature: LockedFeature; onUnlocked: () => void }) {
    const { status, offerings, canPurchase, publishActive, purchase, restore } = useBilling();
    const [selected, setSelected] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const plans = toDisplayPackages(offerings?.all.publish?.availablePackages ?? []).filter((p) => p.interval !== null);
    const chosen = plans.find((p) => p.id === (selected ?? plans.find((x) => x.interval === 'year')?.id)) ?? null;
    const canBuy = status === 'ready' && plans.length > 0;

    async function subscribe() {
        const pkg = offerings?.all.publish?.availablePackages.find((p) => p.identifier === chosen?.id);
        if (!pkg || busy) return;
        setBusy(true);
        setMessage(null);
        try {
            if ((await purchase(pkg)) === 'purchased') {
                setMessage(t('unlock.purchased'));
                onUnlocked();
            }
        } catch {
            setMessage(t('unlock.failed'));
        } finally {
            setBusy(false);
        }
    }

    async function onRestore() {
        if (busy) return;
        setBusy(true);
        try {
            await restore();
            setMessage(t('unlock.restored'));
            onUnlocked();
        } catch {
            setMessage(t('unlock.restoreFailed'));
        } finally {
            setBusy(false);
        }
    }

    return (
        <View style={styles.card}>
            <Text style={styles.title} accessibilityRole="header">{t(`unlock.${feature}.title`)}</Text>
            <Text style={styles.body}>{t(`unlock.${feature}.body`)}</Text>
            {status === 'loading' ? (
                <ActivityIndicator color={colors.accent} />
            ) : publishActive ? (
                <Text style={styles.body}>{t('unlock.active')}</Text>
            ) : !canBuy ? (
                <Text style={styles.muted}>{t('unlock.unavailable')}</Text>
            ) : (
                <>
                    <View style={styles.plans}>
                        {plans.map((p) => (
                            <Pressable key={p.id} accessibilityRole="button" accessibilityState={{ selected: chosen?.id === p.id }} style={[styles.plan, touchTarget, chosen?.id === p.id && styles.planOn]} onPress={() => setSelected(p.id)}>
                                {selected === p.id ? <VeyCardPeek width={72} /> : null}
                                <Text style={[styles.planName, chosen?.id === p.id && styles.planOnText]}>{p.interval ? t(`unlock.plan.${p.interval}`) : p.title}</Text>
                                <Text style={[styles.planPrice, chosen?.id === p.id && styles.planOnText]}>{p.priceString}</Text>
                            </Pressable>
                        ))}
                    </View>
                    {chosen?.interval ? <Text style={styles.muted}>{renewalTerms(chosen.interval, chosen.priceString, store)}</Text> : null}
                    {!canPurchase ? <Text style={styles.muted}>{t('unlock.notOpen')}</Text> : null}
                    <Pressable accessibilityRole="button" disabled={!canPurchase || busy || !chosen} accessibilityState={{ disabled: !canPurchase || busy || !chosen }} style={[styles.button, touchTarget, (!canPurchase || busy || !chosen) && styles.off]} onPress={subscribe}>
                        {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={styles.buttonText}>{t('unlock.subscribe')}</Text>}
                    </Pressable>
                </>
            )}
            {message ? <Text style={styles.muted} accessibilityLiveRegion="polite">{message}</Text> : null}
            {status === 'ready' ? (
                <Pressable accessibilityRole="button" disabled={busy} style={[styles.restore, touchTarget]} onPress={onRestore}>
                    <Text style={styles.restoreText}>{t('unlock.restore')}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 18, gap: 10 },
    title: { color: colors.text, fontSize: 20, fontWeight: '700' },
    body: { color: colors.body, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    plans: { gap: 8 },
    plan: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
    planOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    planName: { color: colors.text, fontSize: 16, fontWeight: '600' },
    planPrice: { color: colors.money, fontSize: 16, fontWeight: '700' },
    planOnText: { color: colors.accentInk },
    button: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', paddingVertical: 14 },
    off: { opacity: 0.4 },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    restore: { alignItems: 'center' },
    restoreText: { color: colors.muted, textDecorationLine: 'underline' },
});
