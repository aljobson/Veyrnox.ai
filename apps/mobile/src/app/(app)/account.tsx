import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { Link, Stack, usePathname, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { fetchProfile, type Profile } from '../../lib/auth/accountCalls';
import { signInMethodKey } from '../../lib/accountSecurity';
import { LEGAL_LINKS, SUPPORT_EMAIL } from '../../lib/account';
import { usePush } from '../../push/pushContext';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { applyThemePreference, colors, themePreference, THEME_PREFERENCES, type ThemePreference } from '../../theme';
import { CREATOR_PROFILE_ENABLED, resetVibe } from '../../lib/creatorProfile';
import { clearVibe } from '../../lib/creatorProfileStore';
import { t } from '../../lib/i18n';
import { MENU_ICONS, type MenuIcon } from '../../lib/menuIcons';

export default function Account() {
    const { api, signOut, getAccessToken } = useAuth();
    const [profile, setProfile] = useState<Profile | null>(null);
    const push = usePush();
    const [pushNote, setPushNote] = useState<string | null>(null);
    const router = useRouter();
    const pathname = usePathname();
    const { status: billing, canPurchase, restore } = useBilling();
    const [restoreNote, setRestoreNote] = useState<string | null>(null);
    const [appearance, setAppearance] = useState<ThemePreference>(themePreference);

    // Best effort: when it fails the section simply shows no details.
    useEffect(() => {
        let live = true;
        fetchProfile(getAccessToken, 'account').then((p) => live && setProfile(p), () => undefined);
        return () => {
            live = false;
        };
    }, [getAccessToken]);

    const [vibeNote, setVibeNote] = useState<string | null>(null);
    async function onResetVibe() {
        setVibeNote(null);
        const r = await resetVibe(api);
        // Cleared on the phone even if the server flag is off; only a real failure keeps it, so the person can try again.
        if (r.kind === 'failed') {
            setVibeNote(t('vibe.error'));
            return;
        }
        await clearVibe();
        setVibeNote(t('vibe.account.resetDone'));
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

    async function onPush(on: boolean) {
        setPushNote(null);
        const out = await push.setEnabled(on);
        if (out === 'denied') setPushNote(t('account.pushDenied'));
        else if (out === 'unavailable') setPushNote(t('account.pushUnavailable'));
    }

    // Remove this device's push token while the session is still valid, then sign out.
    async function onSignOut() {
        await push.unregister();
        await signOut();
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('account.title') }} />

            <Section title={t('acct.profile')}>
                <View style={styles.row} accessible accessibilityLabel={`${t('acct.email')}: ${profile?.email ?? t('acct.profileLoading')}`}>
                    <Text style={styles.note}>{t('acct.email')}</Text>
                    <Text style={styles.rowText}>{profile?.email ?? t('acct.profileLoading')}</Text>
                    {profile ? <Text style={styles.note}>{t('acct.signedInWith', { method: t(signInMethodKey(profile.provider)) })}</Text> : null}
                </View>
                <Pressable accessibilityRole="button" style={styles.signOut} onPress={() => void onSignOut()}>
                    <Text style={styles.signOutText}>{t('public.account.signOut')}</Text>
                </Pressable>
                <Link href="/security" asChild>
                    <Row icon="user" label={t('acct.securityRow')} />
                </Link>
            </Section>

            <Section title={t('acct.appearance')}>
                <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={t('acct.appearance')}>
                    {THEME_PREFERENCES.map((p) => (
                        <Pressable
                            key={p}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: appearance === p }}
                            style={[styles.chip, appearance === p && styles.chipOn]}
                            onPress={() => {
                                if (p === appearance) return;
                                setAppearance(p);
                                void applyThemePreference(p, pathname);
                            }}
                        >
                            <Text style={[styles.chipText, appearance === p && styles.chipTextOn]}>{t(`acct.appearance.${p}`)}</Text>
                        </Pressable>
                    ))}
                </View>
                <Text style={styles.note}>{t('acct.appearance.help')}</Text>
            </Section>

            {billing !== 'off' ? (
                <Section title={t('account.purchases')}>
                    <Row icon="coins" label={t('account.restore')} onPress={onRestore} disabled={!canPurchase} />
                    {restoreNote ? <Text style={styles.note}>{restoreNote}</Text> : null}
                    <Text style={styles.note}>{t('account.packsNote')}</Text>
                </Section>
            ) : null}

            {push.supported ? (
                <Section title={t('account.notifications')}>
                    <View style={styles.switchRow}>
                        <Text style={styles.rowText}>{t('account.notifyMe')}</Text>
                        <Switch
                            accessibilityLabel={t('account.notifyMe')}
                            value={push.enabled}
                            onValueChange={(on) => void onPush(on)}
                            trackColor={{ true: colors.accent, false: colors.border }}
                        />
                    </View>
                    {pushNote ? <Text style={styles.note}>{pushNote}</Text> : null}
                    <Text style={styles.note}>{t('account.notifyNote')}</Text>
                </Section>
            ) : null}

            {CREATOR_PROFILE_ENABLED ? (
                <Section title={t('vibe.account.title')}>
                    <Row label={t('vibe.account.retake')} onPress={() => router.push('/vibe?retake=1')} />
                    <Row label={t('vibe.account.reset')} onPress={() => void onResetVibe()} />
                    {vibeNote ? <Text style={styles.note} accessibilityRole="alert">{vibeNote}</Text> : null}
                </Section>
            ) : null}

            <Section title={t('label.Credits')}>
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
                <Text style={styles.note}>{t('account.reportNote')}</Text>
            </Section>

            <Section title={t('account.aboutSection')}>
                <Link href="/about" asChild>
                    <Row icon="squares" label={t('acct.about')} />
                </Link>
                {LEGAL_LINKS.map((l) => (
                    <Row icon="bookmark" key={l.url} label={t(l.labelKey)} onPress={() => WebBrowser.openBrowserAsync(l.url)} />
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
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
            {children}
        </View>
    );
}

interface RowProps {
    readonly label: string;
    readonly icon?: MenuIcon;
    readonly onPress?: () => void;
    readonly disabled?: boolean;
    readonly danger?: boolean;
}

// Forwards the ref and any props a parent Link adds, so it also works as a Link child.
const Row = ({ label, icon, onPress, disabled, danger, ...rest }: RowProps) => (
    <Pressable
        {...rest}
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        style={[styles.row, styles.rowLine, disabled && styles.off]}
        onPress={onPress}
    >
        {icon ? <Image source={MENU_ICONS[icon]} style={styles.rowIcon} tintColor={danger ? colors.danger : colors.accent} contentFit="contain" accessibilityElementsHidden /> : null}
        <Text style={[styles.rowText, styles.rowLabel, danger && styles.danger]}>{label}</Text>
        <Image source={MENU_ICONS.caretRight} style={styles.rowCaret} tintColor={colors.muted} contentFit="contain" accessibilityElementsHidden />
    </Pressable>
);

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, paddingBottom: 16 + VEY_CLEARANCE, gap: 24 },
    section: { gap: 8 },
    sectionTitle: { color: colors.muted, fontSize: 14, textTransform: 'uppercase' },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    rowLine: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12 },
    rowIcon: { width: 22, height: 22 },
    rowLabel: { flex: 1 },
    rowCaret: { width: 16, height: 16 },
    rowText: { color: colors.text, fontSize: 16, flexShrink: 1 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    danger: { color: colors.danger },
    off: { opacity: 0.5 },
    note: { color: colors.muted, fontSize: 13 },
    signOut: { paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
    signOutText: { color: colors.accent, fontSize: 16 },
    chips: { flexDirection: 'row', gap: 8 },
    chip: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body, fontWeight: '600' },
    chipTextOn: { color: colors.accentInk },
});
