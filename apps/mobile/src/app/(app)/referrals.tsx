import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { attachMessage, attachReferral, fetchReferrals, friendsLine, referralLink, type ReferralInfo } from '../../lib/referrals';
import { colors } from '../../theme';

export default function Referrals() {
    const { api } = useAuth();
    const [info, setInfo] = useState<ReferralInfo | null>(null);
    const [failed, setFailed] = useState(false);
    const [typed, setTyped] = useState('');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState<string | null>(null);

    useEffect(() => {
        let live = true;
        fetchReferrals(api)
            .then((r) => live && setInfo(r))
            .catch(() => live && setFailed(true));
        return () => {
            live = false;
        };
    }, [api]);

    async function share(link: string) {
        // The system share sheet also offers Copy.
        await Share.share({ message: `Make AI images, video and audio with me on Veyrnox.ai: ${link}` }).catch(() => undefined);
    }

    async function useCode() {
        if (!typed.trim() || busy) return;
        setBusy(true);
        setNote(null);
        try {
            await attachReferral(api, typed);
            setTyped('');
            setNote('Done. Your friend earns Credits when you buy your first Credit Pack.');
        } catch (err) {
            setNote(attachMessage(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
            <Stack.Screen options={{ title: 'Refer a friend' }} />
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
                {failed ? (
                    <Text style={styles.error}>Could not load this. Check your connection.</Text>
                ) : info === null ? (
                    <ActivityIndicator color={colors.accent} />
                ) : !info.enabled ? (
                    <Text style={styles.body1}>Referrals are not available right now.</Text>
                ) : (
                    <>
                        <Text style={styles.body1}>
                            When a friend you refer buys their first Credit Pack, you earn Credits worth 10% of that Pack, added to your balance 14 days later if the purchase has not been refunded or disputed.
                            Credits only; they never expire. Nothing is paid out as money.
                        </Text>
                        <View style={styles.codeBox}>
                            <Text style={styles.label}>Your code</Text>
                            <Text selectable style={styles.code} accessibilityLabel={`Your referral code ${info.code.split('').join(' ')}`}>
                                {info.code}
                            </Text>
                        </View>
                        <Pressable accessibilityRole="button" style={styles.button} onPress={() => share(referralLink(info.code))}>
                            <Text style={styles.buttonText}>Share your link</Text>
                        </Pressable>
                        <Text style={styles.muted}>{friendsLine(info.referred)}</Text>
                    </>
                )}

                {info?.enabled ? (
                    <View style={styles.attach}>
                        <Text style={styles.label}>Have a friend's code?</Text>
                        <TextInput
                            style={styles.input}
                            value={typed}
                            onChangeText={setTyped}
                            placeholder="10 letters and numbers"
                            accessibilityLabel="Friend's referral code, 10 letters and numbers"
                            placeholderTextColor={colors.muted}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            maxLength={32}
                        />
                        <Pressable accessibilityRole="button" disabled={!typed.trim() || busy} style={[styles.secondary, (!typed.trim() || busy) && styles.off]} onPress={useCode}>
                            {busy ? <ActivityIndicator color={colors.text} /> : <Text style={styles.secondaryText}>Use this code</Text>}
                        </Pressable>
                        {note ? <Text style={styles.muted}>{note}</Text> : null}
                    </View>
                ) : null}
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, gap: 16 },
    body1: { color: colors.body, fontSize: 15, lineHeight: 22 },
    codeBox: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 16, gap: 6 },
    label: { color: colors.muted, fontSize: 13, textTransform: 'uppercase' },
    code: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: 3 },
    button: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 16, alignItems: 'center' },
    buttonText: { color: colors.accentInk, fontWeight: '700', fontSize: 16 },
    muted: { color: colors.muted },
    attach: { gap: 10, paddingTop: 12 },
    input: { color: colors.text, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
    secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
    secondaryText: { color: colors.text, fontWeight: '600' },
    off: { opacity: 0.4 },
    error: { color: colors.danger },
});
