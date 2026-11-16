import { Stack } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform, ScrollView, Text } from 'react-native';
import { Text as StatusText } from '../../components/ui/Text';
import { Action, styles } from '../../components/account/shared';
import { PRIVACY_EMAIL } from '../../lib/account';
import { copyText } from '../../lib/clipboard';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// Getting a copy of your data is by email for now: a file the person has to open and read is no help to most people.
// The subject is fixed text; no account detail goes in the address or the body.
const MAIL_SUBJECT = 'Copy of my data';

export default function PrivacyExportScreen() {
    const [copied, setCopied] = useState(false);
    async function email() {
        try { await Linking.openURL(`mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent(MAIL_SUBJECT)}`); }
        catch { setCopied(await copyText(PRIVACY_EMAIL)); }
    }
    return <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} style={{ backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: t('privacyExport.title') }} />
        <Text accessibilityRole="header" style={styles.title}>{t('privacyExport.title')}</Text>
        <Text style={styles.help}>{t('privacyExport.closed', { email: PRIVACY_EMAIL })}</Text>
        <Action label={t('privacyExport.email', { email: PRIVACY_EMAIL })} onPress={() => void email()} />
        {copied && <StatusText variant="inherit" style={styles.status} accessibilityLiveRegion={Platform.OS === 'android' ? 'polite' : undefined}>{t('privacyExport.copied')}</StatusText>}
    </ScrollView>;
}
