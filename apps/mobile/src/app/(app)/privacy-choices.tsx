import { Stack } from 'expo-router';
import { AnalyticsChoices } from '../../components/AnalyticsChoices';
import { t } from '../../lib/i18n';
export default function PrivacyChoices() {
    return <><Stack.Screen options={{ title: t('analyticsConsent.choices') }} /><AnalyticsChoices /></>;
}
