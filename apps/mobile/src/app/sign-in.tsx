import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Link, Redirect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { Logo } from '../components/Logo';
import { LEGAL_LINKS, MIN_AGE } from '../lib/account';
import { DEV_MOCK } from '../lib/config';
import { colors } from '../theme';

export default function SignIn() {
    const { appleNativeAvailable, signInWithApple, signInWithOAuth, signInWithEmail, status } = useAuth();
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [agreed, setAgreed] = useState(false);
    const blocked = busy || !agreed;

    async function run(action: () => Promise<void>) {
        setBusy(true);
        setError(null);
        try {
            await action();
            router.replace('/(app)');
        } catch {
            setError('Sign-in did not complete. Try again.');
        } finally {
            setBusy(false);
        }
    }

    if (status === 'signedIn') return <Redirect href="/(app)" />;

    return (
        <View style={styles.screen}>
            <Logo size={44} />
            <Text style={styles.subtitle}>Sign in to create with your credits.</Text>
            <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
                style={styles.agree}
                onPress={() => setAgreed((v) => !v)}
            >
                <View style={[styles.box, agreed && styles.boxOn]}>{agreed ? <Text style={styles.tick}>✓</Text> : null}</View>
                <Text style={styles.agreeText}>
                    I am {MIN_AGE} or older and agree to the{' '}
                    <Text style={styles.link} onPress={() => WebBrowser.openBrowserAsync(LEGAL_LINKS[0].url)}>Terms</Text> and{' '}
                    <Text style={styles.link} onPress={() => WebBrowser.openBrowserAsync(LEGAL_LINKS[1].url)}>Privacy Policy</Text>.
                </Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                disabled={blocked}
                style={[styles.button, blocked && styles.off]}
                onPress={() => run(appleNativeAvailable ? signInWithApple : () => signInWithOAuth('apple'))}
            >
                <Text style={styles.buttonText}>Continue with Apple</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                disabled={blocked}
                style={[styles.button, blocked && styles.off]}
                onPress={() => run(() => signInWithOAuth('google'))}
            >
                <Text style={styles.buttonText}>Continue with Google</Text>
            </Pressable>
            <Link href="/email" asChild>
                <Pressable accessibilityRole="button" disabled={blocked} style={StyleSheet.flatten([styles.button, blocked && styles.off])}>
                    <Text style={styles.buttonText}>Continue with email</Text>
                </Pressable>
            </Link>
            {DEV_MOCK ? (
                <Pressable accessibilityRole="button" disabled={blocked} style={[styles.button, blocked && styles.off]} onPress={() => run(() => signInWithEmail('demo@veyrnox.ai', 'demo-password', 'mock'))}>
                    <Text style={styles.buttonText}>Preview with demo data</Text>
                </Pressable>
            ) : null}
            {busy ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center', gap: 12 },
    title: { color: colors.text, fontSize: 32, fontWeight: '700' },
    subtitle: { color: colors.muted, fontSize: 16, marginBottom: 16 },
    button: {
        backgroundColor: colors.surface,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 12,
        paddingVertical: 16,
        alignItems: 'center',
    },
    buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
    off: { opacity: 0.4 },
    agree: { flexDirection: 'row', gap: 12, alignItems: 'center', marginBottom: 8 },
    box: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
    boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tick: { color: colors.accentInk, fontWeight: '700' },
    agreeText: { flex: 1, color: colors.body, fontSize: 14 },
    link: { color: colors.accent, textDecorationLine: 'underline' },
    spinner: { marginTop: 8 },
    error: { color: colors.danger, marginTop: 8 },
});
