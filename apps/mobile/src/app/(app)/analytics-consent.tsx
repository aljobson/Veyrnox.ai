import { Stack, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AnalyticsChoices } from '../../components/AnalyticsChoices';
import { afterAnalyticsChoice } from '../../lib/firstRunPending';
export default function AnalyticsConsent() {
    const router = useRouter();
    // A required explicit choice: accessibility escape must not bypass analytics consent.
    // No VoiceOver escape on purpose: Allow or Decline must be chosen (ADR-0271).
    return <SafeAreaView style={{ flex: 1 }}>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <AnalyticsChoices onChosen={() => router.replace(afterAnalyticsChoice())} />
    </SafeAreaView>;
}
