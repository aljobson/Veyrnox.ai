import * as WebBrowser from 'expo-web-browser';
import { Link, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { useBilling } from '../../billing/BillingProvider';
import { ACCOUNT_DELETION_ENABLED } from '../../lib/accountDeletion';
import { LEGAL_LINKS, PRIVACY_EMAIL, SUPPORT_EMAIL } from '../../lib/account';
import { colors } from '../../theme';

export default function Account() {
    const { signOut } = useAuth();
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

            <Pressable accessibilityRole="button" style={styles.signOut} onPress={() => void signOut()}>
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
    rowText: { color: colors.text, fontSize: 16 },
    danger: { color: colors.danger },
    off: { opacity: 0.5 },
    note: { color: colors.muted, fontSize: 13 },
    signOut: { paddingVertical: 14, alignItems: 'center' },
    signOutText: { color: colors.muted },
});
