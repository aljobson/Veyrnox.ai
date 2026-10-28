import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { usePathname, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Text, Button, themedStyles, useThemedStyles } from './ui';
import { captureIssue } from '../lib/crash';
import { t } from '../lib/i18n';
import { useAnnouncement } from '../lib/useAnnouncement';
import { ds } from '../theme';

export function ErrorFallback({ error, retry, onHome }: ErrorBoundaryProps & { onHome?: () => void }) {
    // AppearanceContext defaults to the saved/system appearance; no provider is required.
    const styles = useThemedStyles(sheets);
    const reported = useRef<Error | null>(null);
    useEffect(() => {
        if (reported.current === error) return;
        reported.current = error;
        // The error's class name groups crashes; its message can hold user text and is never sent.
        captureIssue('render_error', { boundary: onHome ? 'signed_in' : 'root', error: /^[A-Za-z_$][\w$]{0,63}$/.test(error.name) ? error.name : 'Error' });
    }, [error, onHome]);
    useAnnouncement(t('recovery.title'), { onMount: true });
    return <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView style={styles.screen}>
            <View style={styles.content}>
                <Text variant="title1" accessibilityRole="header">{t('recovery.title')}</Text>
                <Text>{t('recovery.body')}</Text>
                <Button label={t('recovery.retry')} onPress={() => void retry()} />
                {onHome ? <Button variant="secondary" label={t('recovery.home')} onPress={onHome} /> : null}
            </View>
        </SafeAreaView>
    </SafeAreaProvider>;
}

export function SignedInErrorBoundary(props: ErrorBoundaryProps) {
    const router = useRouter();
    const pathname = usePathname();
    const [goingHome, setGoingHome] = useState(false);
    useEffect(() => {
        // Try retains its error across route changes. Wait for the queued replace
        // to reach home before retry mounts the failed navigator's children again.
        if (goingHome && pathname === '/') void props.retry();
    }, [goingHome, pathname, props.retry]);
    function goHome() {
        setGoingHome(true);
        router.replace('/(app)/(tabs)');
    }
    return <ErrorFallback {...props} onHome={goHome} />;
}
const sheets = themedStyles(p => ({
    screen: { flex: 1, backgroundColor: p.bg },
    content: { flex: 1, justifyContent: 'center', padding: ds.space.gutter, gap: ds.space.md },
}));
