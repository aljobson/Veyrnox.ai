import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { useAuth } from '../../auth/AuthProvider';
import { Action, Card, Status, styles as shared } from '../../components/account/shared';
import { VEY_CLEARANCE } from '../../components/VeyMascot';
import { t } from '../../lib/i18n';
import { roleLabel } from '../../lib/publishBrand';
import { inviteState, inviteTokenFromLink, validToken } from '../../lib/shareLinks';
import { useTeamInvite } from '../../lib/useTeamInvite';
import { colors } from '../../theme';

// Join a Publish brand from an invitation link. The invitation is for one email address: the server refuses anyone
// signed in under another, and the screen says which address it was sent to.
export default function TeamInvite() {
    const { token: raw } = useLocalSearchParams<{ token?: string }>();
    const token = typeof raw === 'string' ? raw : '';
    const { api } = useAuth();
    const router = useRouter();
    const { invite, error, phase, idempotent, accept } = useTeamInvite(api, token);
    const [link, setLink] = useState('');
    const [pasteError, setPasteError] = useState<string | null>(null);
    const state = invite ? inviteState(invite, new Date()) : null;

    function continueWithLink() {
        const next = inviteTokenFromLink(link);
        if (!next) {
            setPasteError(t('publishLinks.teamJoin.err.badLink'));
            return;
        }
        router.setParams({ token: next });
        setLink('');
        setPasteError(null);
    }

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
            <Stack.Screen options={{ title: t('share.invite.title') }} />
            {!validToken(token) ? (
                <Card title={t('publishLinks.teamJoin.pasteTitle')}>
                    <Text style={shared.label}>{t('publishLinks.teamJoin.link')}</Text>
                    <TextInput style={shared.input} accessibilityLabel={t('publishLinks.teamJoin.link')} autoCapitalize="none" autoCorrect={false} value={link} onChangeText={setLink} />
                    <Action label={t('publishLinks.teamJoin.continue')} onPress={continueWithLink} />
                    <Status text={pasteError} error />
                </Card>
            ) : phase === 'joined' && invite ? (
                <Card title={t(idempotent ? 'publishLinks.teamJoin.alreadyMember' : 'share.invite.joined', { brand: invite.brandName })} help={t('share.invite.joinedHelp')}>
                    <Action label={t('share.invite.open')} onPress={() => router.replace('/publish')} />
                </Card>
            ) : invite ? (
                <Card title={t('share.invite.title')}>
                    <Text style={shared.label}>{t('share.invite.brand')}</Text>
                    <Text style={shared.name}>{invite.brandName}</Text>
                    <Text style={shared.label}>{t('share.invite.role')}</Text>
                    <Text style={shared.name}>{roleLabel(invite.role)}</Text>
                    <Text style={shared.help}>{t('share.invite.for', { email: invite.email })}</Text>
                    {invite.expiresAt ? <Text style={shared.help}>{t('publishLinks.teamJoin.expires', { date: new Date(invite.expiresAt).toLocaleString() })}</Text> : null}
                    {state === 'open' ? <Action label={phase === 'accepting' ? t('share.invite.joining') : t('share.invite.accept')} disabled={phase !== 'ready'} onPress={() => void accept()} /> : state === 'accepted' ? (
                        <>
                            <Text style={shared.help}>{t('publishLinks.teamJoin.already')}</Text>
                            <Action label={t('share.invite.open')} onPress={() => router.replace('/publish')} />
                        </>
                    ) : <Text style={shared.help}>{state === 'revoked' ? t('publishLinks.teamJoin.revoked') : state === 'expired' ? t('publishLinks.teamJoin.expired') : t('share.invite.closed')}</Text>}
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
