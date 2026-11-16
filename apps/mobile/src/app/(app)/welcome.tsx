import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { captureEvent } from '../../lib/analytics/events';
import { themedStyles, useThemedStyles } from '../../components/ui';

// The welcome screen is the entry the first-run gate sends a new person to. It no longer shows cards of its own: Vey's
// hello now sits above the first question on the first-run screen, so this hands straight on. Seen is recorded there,
// when the questions end, so quitting part-way brings them back.
export default function Welcome() {
    const router = useRouter();
    const styles = useThemedStyles(sheets);
    useEffect(() => {
        captureEvent('onboarding_step', { step: 'welcome', action: 'view' });
        router.replace('/first-run');
    }, [router]);
    return <View style={styles.screen}><Stack.Screen options={{ headerShown: false, gestureEnabled: false }} /></View>;
}

const sheets = themedStyles((p) => ({
    screen: { flex: 1, backgroundColor: p.bg },
}));
