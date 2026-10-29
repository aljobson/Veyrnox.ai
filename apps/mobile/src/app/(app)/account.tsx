import { rawText } from '../../lib/i18n/translate';
import { isAccountChanged } from '../../auth/sessionTask';
import { isAnalyticsEnabled } from '../../lib/analytics/consent';
import { confirmSignOut } from '../../lib/confirmSignOut';
import { Button, Card, ListRow, Text, PriceText, themedStyles, useThemedStyles } from '../../components/ui';

import { Link, Stack, useRouter, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Linking, ScrollView, Switch, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { fetchProfile, type Profile } from '../../lib/auth/accountCalls';
import { signInMethodKey } from '../../lib/accountSecurity';
import { LEGAL_LINKS, SUPPORT_EMAIL } from '../../lib/account';
import { usePush } from '../../push/pushContext';
import { LIST_END_PADDING } from '../../theme';
import { CREATOR_PROFILE_ENABLED, fetchVibeStatus, withVibeDeadline } from '../../lib/creatorProfile';
import { runVibeIntent } from '../../lib/creatorProfileStore';
import { getCacheUser, subscribeCacheUser } from '../../lib/appCache';
import { ACTIVE_LOCALES, t } from '../../lib/i18n';
import { stayDiscountFor } from '../../lib/billing';
import { type MenuIcon } from '../../lib/menuIcons';

// The disabled feature needs no navigation subscription.
const useVibeFocusEffect = CREATOR_PROFILE_ENABLED ? useFocusEffect : useEffect;

export default function Account() {
    const styles = useThemedStyles(sheets);
    const { api, signOut, getAccessToken, beginSessionTask, generation } = useAuth();
    const [profile, setProfile] = useState<Profile | null>(null);
    const push = usePush();
    const [pushNote, setPushNote] = useState<string | null>(null);
    const router = useRouter();
    const { status: billing, offerings, canPurchase, canRestore, paidAccess, activeProductIds, managementURL, purchaseStayOffer, restore, refreshSales } = useBilling();
    useFocusEffect(useCallback(() => { void refreshSales(); }, [refreshSales]));
    const [restoreNote, setRestoreNote] = useState<string | null>(null);
    const [stayBusy, setStayBusy] = useState(false);
    const [stayNote, setStayNote] = useState<string | null>(null);

    // Best effort: when it fails the section simply shows no details.
    useEffect(() => {
        let live = true;
        fetchProfile(getAccessToken, 'account').then((p) => live && setProfile(p), () => undefined);
        return () => {
            live = false;
        };
    }, [getAccessToken]);

    const owner = useSyncExternalStore(subscribeCacheUser, getCacheUser, getCacheUser);
    const [vibeStatus, setVibeStatus] = useState<{ owner: string; generation: number; available: boolean } | null>(null);
    const vibeAvailable = vibeStatus?.owner === owner && vibeStatus?.generation === generation && vibeStatus?.available;
    const [vibeNote, setVibeNote] = useState<string | null>(null);
    const vibeOp = useRef(0);
    useEffect(() => { setVibeNote(null); vibeOp.current++; }, [owner, generation]);
    useVibeFocusEffect(useCallback(() => {
        if (!CREATOR_PROFILE_ENABLED || !owner) return;
        const task = beginSessionTask();
        let live = true;
        void fetchVibeStatus(withVibeDeadline(api)).then(r => {
            if (live && task.current() && owner === getCacheUser()) {
                setVibeStatus({ owner, generation, available: r.kind === 'none' || r.kind === 'chosen' });
            }
        });
        return () => { live = false; };
    }, [owner, generation, api, beginSessionTask]));
    async function onResetVibe() {
        const task = beginSessionTask();
        const op = ++vibeOp.current;
        setVibeNote(null);
        const r = await runVibeIntent(api, task, { kind: 'reset' });
        if (!task.current() || op !== vibeOp.current || r.kind !== 'applied') return;
        setVibeNote(t(r.result === 'failed' ? 'vibe.error' : 'vibe.account.resetDone'));
    }

    async function onRestore() {
        setRestoreNote(t('account.restoreChecking'));
        try {
            await restore();
            setRestoreNote(t('account.restoreDone'));
        } catch {
            setRestoreNote(t('account.restoreFailed'));
        }
    }

    const activePackage = Object.values(offerings?.all ?? {})
        .flatMap((offering) => offering.availablePackages)
        .find((pkg) => activeProductIds.includes(pkg.product.identifier) && stayDiscountFor(pkg)) ?? null;
    const stayDiscount = activePackage ? stayDiscountFor(activePackage) : null;

    async function onStay() {
        if (!activePackage || stayBusy) return;
        setStayBusy(true);
        setStayNote(null);
        try {
            const result = await purchaseStayOffer(activePackage);
            setStayNote(result === 'purchased' ? t('account.stayDone') : t('account.stayCancelled'));
        } catch {
            setStayNote(t('account.stayUnavailable'));
        } finally {
            setStayBusy(false);
        }
    }

    async function onPush(on: boolean) {
        setPushNote(null);
        const out = await push.setEnabled(on);
        if (out === 'denied') setPushNote(t('account.pushDenied'));
        else if (out === 'unavailable') setPushNote(t('account.pushUnavailable'));
    }

    // Remove this device's push token while the session is still valid, then sign out.
    async function onSignOut() {
        const task = beginSessionTask();
        try {
            await push.unregister();
            if (!task.current()) return;
            await signOut(task.gen);
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            throw err;
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('account.title') }} />

            <Section title={t('acct.profile')}>
                <Card style={styles.row} accessible accessibilityLabel={rawText(`${t('acct.email')}: ${profile?.email ?? t('acct.profileLoading')}`)}>
                    <Text variant="footnote" style={styles.note}>{t('acct.email')}</Text>
                    <Text variant="body" style={styles.rowText}>{profile?.email ?? t('acct.profileLoading')}</Text>
                    {profile ? <Text variant="footnote" style={styles.note}>{t('acct.signedInWith', { method: t(signInMethodKey(profile.provider)) })}</Text> : null}
                </Card>
                <Row label={t('public.account.signOut')} danger onPress={() => confirmSignOut(onSignOut)} />
                <Link href="/security" asChild>
                    <Row icon="user" label={t('acct.securityRow')} />
                </Link>
            </Section>

            <Section title={t('acct.appearance')}>
                {ACTIVE_LOCALES.length > 1 ? <ListRow icon="globe" title={t('language.title')} onPress={() => router.push('/language' as never)} /> : null}
                {isAnalyticsEnabled() ? <ListRow icon="shieldCheck" title={t('analyticsConsent.choices')} onPress={() => router.push('/privacy-choices')} /> : null}
                <ListRow icon="swatches" title={t('acct.appearance')} onPress={() => router.push('/appearance')} />
            </Section>

            {billing !== 'off' ? (
                <Section title={t('account.purchases')}>
                    <Row icon="coins" label={t('account.restore')} onPress={onRestore} disabled={!canRestore} />
                    {paidAccess && stayDiscount ? <Row icon="heart" price={stayDiscount.priceString} label={t('account.stay', { price: stayDiscount.priceString, cycles: stayDiscount.cycles })} onPress={() => void onStay()} disabled={stayBusy || !canPurchase} /> : null}
                    {paidAccess && managementURL ? <Row icon="wrench" label={t('account.manageSubscription')} onPress={() => void Linking.openURL(managementURL)} /> : null}
                    {restoreNote ? <Text variant="footnote" style={styles.note}>{restoreNote}</Text> : null}
                    {stayNote ? <Text variant="footnote" style={styles.note} accessibilityLiveRegion="polite">{stayNote}</Text> : null}
                    <Text variant="footnote" style={styles.note}>{t('account.packsNote')}</Text>
                </Section>
            ) : null}

            {push.supported ? (
                <Section title={t('account.notifications')}>
                    <View style={styles.switchRow}>
                        <Text variant="body" style={styles.rowText}>{t('account.notifyMe')}</Text>
                        <Switch
                            accessibilityLabel={t('account.notifyMe')}
                            value={push.enabled}
                            onValueChange={(on) => void onPush(on)}
                            trackColor={{ true: styles.accentInk.color, false: styles.borderInk.color }}
                        />
                    </View>
                    {pushNote ? <Text variant="footnote" style={styles.note}>{pushNote}</Text> : null}
                    <Text variant="footnote" style={styles.note}>{t('account.notifyNote')}</Text>
                </Section>
            ) : null}

            {CREATOR_PROFILE_ENABLED && vibeAvailable ? (
                <Section title={t('vibe.account.title')}>
                    <Row label={t('vibe.account.retake')} onPress={() => router.push('/vibe?retake=1')} />
                    <Row label={t('vibe.account.reset')} onPress={() => void onResetVibe()} />
                    {vibeNote ? <Text variant="footnote" style={styles.note} accessibilityRole="alert">{vibeNote}</Text> : null}
                </Section>
            ) : null}

            <Section title={t('account.creditsSection')}>
                <Link href="/history" asChild>
                    <Row icon="bookmark" label={t('account.history')} />
                </Link>
                <Link href="/topups" asChild>
                    <Row icon="coins" label={t('topup.row')} />
                </Link>
            </Section>

            <Section title={t('account.referSection')}>
                <Link href="/referrals" asChild>
                    <Row icon="heart" label={t('account.refer')} />
                </Link>
            </Section>

            <Section title={t('acct.exploreSection')}>
                <Link href="/search" asChild>
                    <Row icon="sparkle" label={t('acct.search')} />
                </Link>
                <Link href="/models" asChild>
                    <Row icon="cube" label={t('acct.models')} />
                </Link>
                <Link href="/pricing" asChild>
                    <Row icon="coins" label={t('acct.pricing')} />
                </Link>
                <Link href="/brand-kit" asChild>
                    <Row icon="palette" label={t('acct.brandKit')} />
                </Link>
                <Link href="/developers" asChild><Row icon="cpu" label={t('developers.row')} /></Link>
                <Link href="/publish/developer" asChild>
                    <Row icon="wrench" label={t('dev.row')} />
                </Link>
            </Section>

            <Section title={t('account.helpSection')}>
                <Link href="/help" asChild>
                    <Row icon="help" label={t('account.help')} />
                </Link>
            </Section>

            <Section title={t('account.safetySection')}>
                <Link href="/report" asChild>
                    <Row icon="flag" label={t('account.report')} />
                </Link>
                <Link href="/blocked" asChild>
                    <Row icon="close" label={t('blocks.title')} />
                </Link>
                <Text variant="footnote" style={styles.note}>{t('account.reportNote')}</Text>
            </Section>

            <Section title={t('account.aboutSection')}>
                <Link href="/about" asChild>
                    <Row icon="squares" label={t('acct.about')} />
                </Link>
                {LEGAL_LINKS.map((l) => (
                    <Row icon="bookmark" key={l.route} label={t(l.labelKey)} onPress={() => router.push(l.route)} />
                ))}
                <Row icon="chat" label={t('account.contact', { email: SUPPORT_EMAIL })} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
            </Section>

            <Section title={t('account.dataSection')}>
                <Row icon="folder" label={t('privacyExport.title')} onPress={() => router.push('/privacy-export')} />
                <Row icon="close" label={t('account.deleteAccount')} danger onPress={() => router.push('/delete-account')} />
            </Section>

        </ScrollView>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    const styles = useThemedStyles(sheets);
    return (
        <View style={styles.section}>
            <Text variant="footnote" style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
            {children}
        </View>
    );
}

interface RowProps {
    readonly label: string;
    readonly price?: string;
    readonly icon?: MenuIcon;
    readonly onPress?: () => void;
    readonly disabled?: boolean;
    readonly danger?: boolean;
}

// Forwards the ref and any props a parent Link adds, so it also works as a Link child.
const Row = ({ label, price, icon, onPress, disabled, danger, ...rest }: RowProps) => {
    const styles = useThemedStyles(sheets);
    if (danger) return <Button {...rest} variant="tertiary" tone="danger" label={label} icon={icon} style={[styles.row, { justifyContent: 'flex-start' }]} accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} onPress={onPress} />;
    return <ListRow {...rest} title={price ? <PriceText text={label} price={price} variant="bodyStrong" /> : label} icon={icon} accessibilityRole="button" accessibilityState={{ disabled: Boolean(disabled) }} disabled={disabled} style={[styles.row, disabled && styles.off]} onPress={onPress} />;
};

const sheets = themedStyles((p) => ({
    borderInk: { color: p.borderSubtle },
    accentInk: { color: p.accent },
    screen: { flex: 1, backgroundColor: p.bg },
    content: { padding: 16, paddingBottom: 16 + LIST_END_PADDING, gap: 24 },
    section: { gap: 8 },
    sectionTitle: { color: p.textSecondary },
    row: { backgroundColor: p.surface, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: 12, padding: 16 },
    rowText: { color: p.textPrimary, flexShrink: 1 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: p.surface, borderColor: p.borderSubtle, borderWidth: 1, borderRadius: 12, padding: 16 },
    off: { opacity: 0.5 },
    note: { color: p.textSecondary },
    signOutText: { color: p.accent },
}));
