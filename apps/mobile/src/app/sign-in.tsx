import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '../auth/AuthProvider';
import { colors } from '../theme';

export default function SignIn() {
    const { appleNativeAvailable, signInWithApple, signInWithOAuth, status } = useAuth();
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

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
            <Text style={styles.title}>Veyrnox.ai</Text>
            <Text style={styles.subtitle}>Sign in to create with your credits.</Text>
            <Pressable
                accessibilityRole="button"
                disabled={busy}
                style={styles.button}
                onPress={() => run(appleNativeAvailable ? signInWithApple : () => signInWithOAuth('apple'))}
            >
                <Text style={styles.buttonText}>Continue with Apple</Text>
            </Pressable>
            <Pressable
                accessibilityRole="button"
                disabled={busy}
                style={styles.button}
                onPress={() => run(() => signInWithOAuth('google'))}
            >
                <Text style={styles.buttonText}>Continue with Google</Text>
            </Pressable>
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
    spinner: { marginTop: 8 },
    error: { color: colors.danger, marginTop: 8 },
});
