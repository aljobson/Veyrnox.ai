import * as WebBrowser from 'expo-web-browser';
import { Link, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { ACCOUNT_DELETION_ENABLED } from '../../lib/accountDeletion';
import { LEGAL_LINKS, PRIVACY_EMAIL, SUPPORT_EMAIL } from '../../lib/account';
import { usePush } from '../../push/pushContext';
import { colors } from '../../theme';

export default function Account() {
    const { signOut } = useAuth();
    const push = usePush();
    const [pushNote, setPushNote] = useState<string | null>(null);
    const router = useRouter();
    const { status: billing, canPurchase, restore } = useBilling();
    const [restoreNote, setRestoreNote] = useState<string | null>(null);

    async function onRestore() {
        setRestoreNote('Checking with the store…');
        try {
            await restore();
            setRestoreNote('Done. A Publish Plan bought with this store account is active again.');
        } catch {
            setRestoreNote('Could not reach the store. Try again.');
        }
    }

    async function onPush(on: boolean) {
        setPushNote(null);
        const out = await push.setEnabled(on);
        if (out === 'denied') setPushNote('Notifications are off for this app. Turn them on in your phone settings first.');
        else if (out === 'unavailable') setPushNote('Notifications are not available right now. Try again later.');
    }

    // Remove this device's push token while the session is still valid, then sign out.
    async function onSignOut() {
        await push.unregister();
        await signOut();
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: 'Account' }} />

            {billing !== 'off' ? (
                <Section title="Purchases">
                    <Row label="Restore purchases" onPress={onRestore} disabled={!canPurchase} />
                    {restoreNote ? <Text style={styles.note}>{restoreNote}</Text> : null}
                    <Text style={styles.note}>Credit packs are added to your balance when you buy them and are not restored.</Text>
                </Section>
            ) : null}

            {push.supported ? (
                <Section title="Notifications">
                    <View style={styles.switchRow}>
                        <Text style={styles.rowText}>Tell me when a creation is ready</Text>
                        <Switch
                            accessibilityLabel="Tell me when a creation is ready"
                            value={push.enabled}
                            onValueChange={(on) => void onPush(on)}
                            trackColor={{ true: colors.accent, false: colors.border }}
                        />
                    </View>
                    {pushNote ? <Text style={styles.note}>{pushNote}</Text> : null}
                    <Text style={styles.note}>One notification when a creation finishes or fails. It never contains your prompt.</Text>
                </Section>
            ) : null}

            <Section title="Safety">
                <Link href="/report" asChild>
                    <Row label="Report a problem or content" />
                </Link>
                <Text style={styles.note}>To report one of your creations, open it from your library and use Report.</Text>
            </Section>

            <Section title="About and contact">
                {LEGAL_LINKS.map((l) => (
                    <Row key={l.url} label={l.label} onPress={() => WebBrowser.openBrowserAsync(l.url)} />
                ))}
                <Row label={`Contact support: ${SUPPORT_EMAIL}`} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
            </Section>

            <Section title="Your data">
                <Row label="Delete my account" danger disabled={!ACCOUNT_DELETION_ENABLED} onPress={() => router.push('/delete-account')} />
                {ACCOUNT_DELETION_ENABLED ? null : (
                    <Text style={styles.note}>
                        Deleting your account from the app is coming. Until then, email {PRIVACY_EMAIL} from your account address and we will delete it.
                    </Text>
                )}
            </Section>

            <Pressable accessibilityRole="button" style={styles.signOut} onPress={() => void onSignOut()}>
                <Text style={styles.signOutText}>Sign out</Text>
            </Pressable>
        </ScrollView>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <Text style={styles.sectionTitle}>{title}</Text>
            {children}
        </View>
    );
}

interface RowProps {
    readonly label: string;
    readonly onPress?: () => void;
    readonly disabled?: boolean;
    readonly danger?: boolean;
}

// Forwards the ref and any props a parent Link adds, so it also works as a Link child.
const Row = ({ label, onPress, disabled, danger, ...rest }: RowProps) => (
    <Pressable
        {...rest}
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled) }}
        disabled={disabled}
        style={[styles.row, disabled && styles.off]}
        onPress={onPress}
    >
        <Text style={[styles.rowText, danger && styles.danger]}>{label}</Text>
    </Pressable>
);

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 24 },
    section: { gap: 8 },
    sectionTitle: { color: colors.muted, fontSize: 14, textTransform: 'uppercase' },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    rowText: { color: colors.text, fontSize: 16, flexShrink: 1 },
    switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16 },
    danger: { color: colors.danger },
    off: { opacity: 0.5 },
    note: { color: colors.muted, fontSize: 13 },
    signOut: { paddingVertical: 14, alignItems: 'center' },
    signOutText: { color: colors.muted },
});
