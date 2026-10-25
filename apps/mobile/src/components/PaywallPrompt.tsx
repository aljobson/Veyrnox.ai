import * as SecureStore from 'expo-secure-store';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { useBilling } from '../billing/BillingProvider';
import { getCacheUser, subscribeCacheUser } from '../lib/appCache';
import { t } from '../lib/i18n';
import { paywallReason, type PaywallReason } from '../lib/paywallPrompt';
import { useBalance } from '../lib/useBalance';
import { colors, fonts } from '../theme';

const seenKey = (owner: string) => `veyrnox.paywall.seen.${owner}`;
const depletedKey = (owner: string) => `veyrnox.paywall.depleted.${owner}`;

const copyFor = (reason: PaywallReason) => ({
    first: { title: t('credits.paywall.firstTitle'), body: t('credits.paywall.firstBody') },
    low: { title: t('credits.paywall.lowTitle'), body: t('credits.paywall.lowBody') },
    depleted: { title: t('credits.paywall.emptyTitle'), body: t('credits.paywall.emptyBody') },
})[reason];

// Matches the website's soft prompt: it suggests store billing at useful moments but never
// prevents a signed-in person from using free credits or the rest of the app.
export function PaywallPrompt() {
    const [owner, setOwner] = useState(getCacheUser());
    useEffect(() => subscribeCacheUser(() => setOwner(getCacheUser())), []);
    return owner ? <AccountPaywall key={owner} owner={owner} /> : null;
}

function AccountPaywall({ owner }: { owner: string }) {
    const { api } = useAuth();
    const billing = useBilling();
    const balance = useBalance();
    const pathname = usePathname();
    const router = useRouter();
    const [accountReady, setAccountReady] = useState(false);
    const [createdAt, setCreatedAt] = useState<string | null>(null);
    const [seenFirst, setSeenFirst] = useState(false);
    const [seenDepleted, setSeenDepleted] = useState(false);
    const [openReason, setOpenReason] = useState<PaywallReason | null>(null);
    const shownThisSession = useRef(false);

    useEffect(() => {
        let live = true;
        void Promise.all([
            SecureStore.getItemAsync(seenKey(owner)).catch(() => null),
            SecureStore.getItemAsync(depletedKey(owner)).catch(() => null),
            api.request<{ created_at?: unknown }>('/api/v1/account').catch(() => null),
        ]).then(([seen, depleted, account]) => {
            if (!live || owner !== getCacheUser()) return;
            setSeenFirst(seen === '1');
            setSeenDepleted(depleted === '1');
            setCreatedAt(typeof account?.created_at === 'string' ? account.created_at : null);
            setAccountReady(true);
        });
        return () => { live = false; };
    }, [api, owner]);

    const promptRoute = pathname === '/welcome' || pathname?.startsWith('/credits');
    useEffect(() => {
        if (!accountReady || promptRoute || !Number.isFinite(balance) || openReason) return;
        if ((balance as number) > 0 && seenDepleted) {
            let live = true;
            void SecureStore.deleteItemAsync(depletedKey(owner))
                .catch(() => undefined)
                .then(() => { if (live) setSeenDepleted(false); });
            return () => { live = false; };
        }
        const reason = paywallReason({
            credits: balance,
            createdAt,
            seenFirst,
            shownThisSession: shownThisSession.current,
            shownDepletedBalance: seenDepleted,
        });
        if (!reason) return;
        if (reason === 'depleted') {
            setSeenDepleted(true);
            void SecureStore.setItemAsync(depletedKey(owner), '1').catch(() => undefined);
        } else shownThisSession.current = true;
        if (reason === 'first') {
            setSeenFirst(true);
            void SecureStore.setItemAsync(seenKey(owner), '1').catch(() => undefined);
        }
        setOpenReason(reason);
    }, [accountReady, balance, createdAt, openReason, owner, promptRoute, seenDepleted, seenFirst]);

    if (!openReason || promptRoute) return null;
    const copy = copyFor(openReason);
    const subscriptionsOpen = billing.status === 'ready'
        && (billing.offerings?.all.generation?.availablePackages.length ?? 0) > 0;
    const goToCredits = () => {
        setOpenReason(null);
        router.push('/credits');
    };

    return (
        <Modal transparent animationType="fade" visible onRequestClose={() => setOpenReason(null)}>
            <View style={styles.backdrop}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.card}>
                        <Text style={styles.eyebrow}>VEY RNOX</Text>
                        <Text accessibilityRole="header" style={styles.title}>{copy.title}</Text>
                        <Text style={styles.body}>{copy.body}</Text>
                        <Text style={styles.repeat}>{t('credits.paywall.repeat')}</Text>
                        {subscriptionsOpen && !billing.paidAccess ? (
                            <Pressable accessibilityRole="button" style={styles.secondary} onPress={goToCredits}>
                                <Text style={styles.secondaryText}>{t('credits.paywall.subscriptions')}</Text>
                            </Pressable>
                        ) : null}
                        <Pressable accessibilityRole="button" style={styles.primary} onPress={goToCredits}>
                            <Text style={styles.primaryText}>{t('credits.paywall.packs')}</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" style={styles.later} onPress={() => setOpenReason(null)}>
                            <Text style={styles.laterText}>{t('credits.paywall.later')}</Text>
                        </Pressable>
                    </View>
                </ScrollView>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)' },
    scroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
    card: { borderRadius: 20, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, padding: 22, gap: 12 },
    eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 3 },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 29, lineHeight: 34 },
    body: { color: colors.body, fontSize: 16, lineHeight: 23 },
    repeat: { color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 4 },
    primary: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.accent, paddingHorizontal: 16 },
    primaryText: { color: colors.accentInk, fontSize: 16, fontWeight: '800' },
    secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 16 },
    secondaryText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    later: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    laterText: { color: colors.body, fontSize: 15 },
});
