import { router } from 'expo-router';
import { CINEMA_DEVICE_UPLOAD_ENABLED } from '../../lib/cinemaUpload';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TARGET } from '../../lib/a11y';
import { CREATOR_WORKSPACE_URL } from '../../lib/cinemaCreator';
import { t } from '../../lib/i18n';
import { colors } from '../../theme';

// Device upload stays behind its build flag until spike S3 passes (ADR-0249).
// This opens the web creator workspace and carries nothing about the account.
export function CreatorUploadShell() {
    return (
        <View style={styles.card}>
            <Text style={styles.heading} accessibilityRole="header">{t('cinemaCreator.upload.title')}</Text>
            <Text style={styles.body}>{t('cinemaCreator.upload.body')}</Text>
            {CINEMA_DEVICE_UPLOAD_ENABLED && <Pressable accessibilityRole="button" accessibilityLabel={t('cinemaUpload.titles')} style={styles.button} onPress={() => router.push('/cinema/creator')}>
                <Text style={styles.buttonText}>{t('cinemaUpload.titles')}</Text>
            </Pressable>}
            <Pressable accessibilityRole="link" style={styles.button} onPress={() => void WebBrowser.openBrowserAsync(CREATOR_WORKSPACE_URL)}>
                <Text style={styles.buttonText}>{t('cinemaCreator.upload.web')}</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 8 },
    heading: { color: colors.text, fontSize: 18, fontWeight: '700' },
    body: { color: colors.body, fontSize: 16 },
    button: { minHeight: MIN_TARGET, alignItems: 'center', justifyContent: 'center', borderColor: colors.accent, borderWidth: 1, borderRadius: 12 },
    buttonText: { color: colors.accent, fontWeight: '700', fontSize: 16 },
});
