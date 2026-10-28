import { isAccountChanged } from '../../auth/sessionTask';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Action, Card, Status, styles as shared } from '../../components/account/shared';
import { t } from '../../lib/i18n';
import { english } from '../../lib/i18n/binding';
import { consentErrorKey, decide, fetchRequest, validAuthorizationId, type Request } from '../../lib/oauthConsent';
import { colors, fonts, LIST_END_PADDING } from '../../theme';

// An assistant asks to connect to the account. The person reads who and what, then approves or denies; the answer
// sends them back to the assistant. Reached from a link of the form /oauth/consent?authorization_id=...
export default function OAuthConsent() {
    const { authorization_id: raw } = useLocalSearchParams<{ authorization_id?: string }>();
    const id = typeof raw === 'string' ? raw : '';
    const { getAccessToken, beginSessionTask } = useAuth();
    const router = useRouter();
    const [request, setRequest] = useState<Request | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);

    useEffect(() => {
        if (!validAuthorizationId(id)) return;
        let live = true;
        fetchRequest(getAccessToken, id).then(
            (r) => live && setRequest(r),
            (err) => live && setError(t(consentErrorKey(err))),
        );
        return () => {
            live = false;
        };
    }, [getAccessToken, id]);

    async function choose(action: 'approve' | 'deny') {
        const task = beginSessionTask();
        setBusy(action);
        setError(null);
        try {
            const target = await decide(task.tokens, id, action);
            if (!task.current()) return;
            await Linking.openURL(target);
            if (!task.current()) return;
            router.replace('/');
        } catch (err) {
            if (!task.current() || isAccountChanged(err)) return;
            setError(t(consentErrorKey(err)));
        } finally {
            setBusy(null);
        }
    }

    const name = request?.name ?? t('oauth.assistant');
    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('oauth.connection') }} />
            {!validAuthorizationId(id) ? (
                <Card title={t('oauth.invalid')}>
                    <Text style={shared.help}>{t('oauth.needsRequest')}</Text>
                </Card>
            ) : !request && !error ? (
                <ActivityIndicator color={colors.accent} accessibilityLabel={t('oauth.loading')} />
            ) : null}
            {error && !request ? <Card title={t('oauth.errorTitle')}><Status text={error} error /></Card> : null}
            {request ? (
                <>
                    <Text style={styles.title} accessibilityRole="header">{t('oauth.connectName', { name })}</Text>
                    <Text accessibilityLanguage="en" style={shared.help}>{english(request.publish ? 'oauth.summaryPublish' : 'oauth.summary')}</Text>
                    <Card title={t('oauth.access')}>
                        {[english('oauth.models'), english('oauth.estimate'), english('oauth.limit'), english('oauth.video'), english('oauth.assets'), ...(request.publish ? [english('oauth.publishAccess')] : [])].map((line) => (
                            <Text key={line} accessibilityLanguage="en" style={shared.help}>{`• ${line}`}</Text>
                        ))}
                        {request.scopes.length ? <Text style={shared.label}>{`${t('oauth.scopes')} ${request.scopes.join(' · ')}`}</Text> : null}
                    </Card>
                    <Text accessibilityLanguage="en" style={shared.help}>{`${english('oauth.password')} ${english(request.publish ? 'oauth.restrictionsPublish' : 'oauth.restrictions')} ${english('oauth.revoke')}`}</Text>
                    <Status text={error} error />
                    <View style={{ gap: 12 }}>
                        <Action label={busy === 'approve' ? t('oauth.connecting') : t('oauth.approve')} disabled={busy !== null} onPress={() => void choose('approve')} />
                        <Action label={busy === 'deny' ? t('oauth.declining') : t('oauth.deny')} disabled={busy !== null} onPress={() => void choose('deny')} />
                    </View>
                    {request.website || request.redirect ? (
                        <Text selectable style={shared.label}>
                            {[request.website ? `${t('oauth.client')} ${request.website}` : '', request.redirect ? `${t('oauth.returnUrl')} ${request.redirect}` : ''].filter(Boolean).join('\n')}
                        </Text>
                    ) : null}
                </>
            ) : null}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 16, paddingBottom: 16 + LIST_END_PADDING },
    title: { color: colors.text, fontFamily: fonts.display, fontSize: 24 },
});
