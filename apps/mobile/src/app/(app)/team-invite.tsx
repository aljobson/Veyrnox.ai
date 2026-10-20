import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Action, Card, Status, styles as shared } from '../../components/account/shared';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { t } from '../../lib/i18n';
import { brandStore } from '../../lib/publishBrand';
import { acceptInvite, fetchInvite, inviteErrorKey, inviteOpen, validToken, type Invite } from '../../lib/shareLinks';
import { colors } from '../../theme';

// Join a Publish brand from an invitation link. The invitation is for one email address: the server refuses anyone
// signed in under another, and the screen says which address it was sent to.
export default function TeamInvite() {
    const { token: raw } = useLocalSearchParams<{ token?: string }>();
    const token = typeof raw === 'string' ? raw : '';
    const { api } = useAuth();
    const router = useRouter();
    const [invite, setInvite] = useState<Invite | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [joined, setJoined] = useState(false);

    useEffect(() => {
        if (!validToken(token)) return;
        let live = true;
        fetchInvite(token).then(
            (i) => live && setInvite(i),
            (err) => live && setError(t(inviteErrorKey(err))),
        );
        return () => {
            live = false;
        };
    }, [token]);

    async function accept() {
        setBusy(true);
        setError(null);
        try {
            const out = await acceptInvite(api, token);
            if (out.brandId) brandStore.set(out.brandId);
            setJoined(true);
        } catch (err) {
            const key = inviteErrorKey(err);
            setError(key === 'share.invite.err.email' && invite ? t(key, { email: invite.email }) : t(key));
        } finally {
            setBusy(false);
        }
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('share.invite.title') }} />
            {!validToken(token) ? (
                <Card title={t('share.invite.title')}><Text style={shared.help}>{t('share.invite.err.gone')}</Text></Card>
            ) : joined && invite ? (
                <Card title={t('share.invite.joined', { brand: invite.brandName })} help={t('share.invite.joinedHelp')}>
                    <Action label={t('share.invite.open')} onPress={() => router.replace('/publish')} />
                </Card>
            ) : invite ? (
                <Card title={t('share.invite.title')}>
                    <Text style={shared.label}>{t('share.invite.brand')}</Text>
                    <Text style={shared.name}>{invite.brandName}</Text>
                    <Text style={shared.label}>{t('share.invite.role')}</Text>
                    <Text style={shared.name}>{invite.role}</Text>
                    <Text style={shared.help}>{t('share.invite.for', { email: invite.email })}</Text>
                    {inviteOpen(invite) ? <Action label={busy ? t('share.invite.joining') : t('share.invite.accept')} disabled={busy} onPress={() => void accept()} /> : <Text style={shared.help}>{t('share.invite.closed')}</Text>}
                    <Status text={error} error />
                </Card>
            ) : error ? (
                <Card title={t('share.invite.title')}><Status text={error} error /></Card>
            ) : (
                <ActivityIndicator color={colors.accent} accessibilityLabel={t('share.loading')} />
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: 16, gap: 16, paddingBottom: 16 + VEY_CLEARANCE },
});
