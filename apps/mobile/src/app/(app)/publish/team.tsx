import { rawText } from '../../../lib/i18n/translate';
import { usePublishScope } from '../../../lib/usePublishScope';
import { Text as StatusText } from '../../../components/ui/Text';
import { Stack } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { touchTarget } from '../../../lib/a11y';
import { formatLocale, t } from '../../../lib/i18n';
import { roleLabel } from '../../../lib/publishBrand';
import { canManage, canRevoke, changeRole, fetchTeam, inviteErrorKey, inviteMember, removeMember, revokeInvite, rolesFor, teamActionErrorKey, teamErrorKey, validEmail, type ChangeableRole, type Invitation_, type Member, type Team } from '../../../lib/publishTeam';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors, LIST_END_PADDING } from '../../../theme';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(formatLocale()) : '');

export default function TeamScreen() {
    const api = usePublishApi();
    const [team, setTeam] = useState<Team | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [inviteEmail, setInviteEmail] = useState('');
    const [inviteRole, setInviteRole] = useState<ChangeableRole>('editor');
    const [invited, setInvited] = useState<Invitation_ | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const teamRef = useRef(team), running = useRef(false);
    teamRef.current = team;
    const { guard, nextRead, scopeTick } = usePublishScope(api, () => {
        teamRef.current = null; running.current = false;
        setTeam(null); setInvited(null); setInviteEmail(''); setInviteRole('editor');
        setNotice(null); setError(null); setOpen(null); setBusy(false); setRefreshing(false);
    });

    const load = useCallback(async () => {
        const valid = nextRead('team');
        try {
            const next = await fetchTeam(api);
            if (!valid()) return;
            teamRef.current = next; setTeam(next);
            setInviteRole(role => rolesFor(next.actorRole).includes(role) ? role : 'editor');
            setError(null);
        } catch (err) {
            if (!valid()) return;
            teamRef.current = null; setTeam(null);
            setError(t(teamErrorKey(err)));
        } finally { if (valid()) setRefreshing(false); }
    }, [api, nextRead, scopeTick]);

    useEffect(() => { void load(); }, [load]);
    useEffect(() => () => setInvited(null), []);

    // The confirmation owns its scope guard, including a round trip A → B → A.
    async function run(action: () => Promise<unknown>, done: string, valid: () => boolean, allowed: () => boolean) {
        if (!valid() || !allowed() || running.current) return;
        running.current = true; setBusy(true); setNotice(null);
        try { await action(); if (valid()) setNotice(done); }
        catch (err) { if (valid()) setNotice(t(teamActionErrorKey(err))); }
        finally {
            if (valid()) { running.current = false; setBusy(false); setOpen(null); void load(); }
        }
    }

    function pickRole(m: Member, role: ChangeableRole) {
        const allowed = () => !!teamRef.current && canManage(teamRef.current.actorRole, m.role) && rolesFor(teamRef.current.actorRole).includes(role);
        if (!team || role === m.role || !allowed()) return;
        const valid = guard(); let used = false;
        Alert.alert(t('team.roleTitle', { email: m.email }), t('team.roleBody', { role: roleLabel(role) }), [
            { text: t('team.cancel'), style: 'cancel' },
            { text: t('team.roleAction'), onPress: () => { if (used) return; used = true; void run(() => changeRole(api, team.brandId, m.userId, role), t('team.roleDone', { email: m.email, role: roleLabel(role) }), valid, allowed); } },
        ]);
    }

    function remove(m: Member) {
        const allowed = () => !!teamRef.current && canManage(teamRef.current.actorRole, m.role);
        if (!team || !allowed()) return;
        const valid = guard(); let used = false;
        Alert.alert(t('team.removeTitle', { email: m.email }), t('team.removeBody'), [
            { text: t('team.cancel'), style: 'cancel' },
            { text: t('team.removeAction'), style: 'destructive', onPress: () => { if (used) return; used = true; void run(() => removeMember(api, team.brandId, m.userId), t('team.removed', { email: m.email }), valid, allowed); } },
        ]);
    }

    function revoke(id: string, email: string) {
        const allowed = () => {
            const current = teamRef.current, invitation = current?.invitations.find(i => i.id === id);
            return !!current && !!invitation && invitation.status === 'pending' && canRevoke(current.actorRole, invitation.role);
        };
        if (!team || !allowed()) return;
        const valid = guard(); let used = false;
        Alert.alert(t('team.revokeTitle', { email }), t('team.revokeBody'), [
            { text: t('team.cancel'), style: 'cancel' },
            { text: t('team.revokeAction'), style: 'destructive', onPress: () => { if (used) return; used = true; void run(() => revokeInvite(api, team.brandId, id), t('team.revoked', { email }), valid, allowed); } },
        ]);
    }

    function invite() {
        const allowed = () => !!teamRef.current && ['owner', 'manager'].includes(teamRef.current.actorRole) && rolesFor(teamRef.current.actorRole).includes(inviteRole);
        if (!team || running.current) return;
        if (!allowed()) { setInviteRole('editor'); return; }
        const email = inviteEmail.trim().toLowerCase();
        if (!validEmail(email)) { setNotice(t('team.err.inviteEmail')); return; }
        const valid = guard(); let used = false;
        Alert.alert(t('team.inviteTitle', { email }), t('team.inviteBody', { role: roleLabel(inviteRole) }), [
            { text: t('team.cancel'), style: 'cancel' },
            {
                text: t('team.inviteAction'),
                onPress: async () => {
                    if (used || !valid() || running.current) return;
                    if (!allowed()) { setInviteRole('editor'); return; }
                    used = true; running.current = true; setBusy(true); setNotice(null); setInvited(null);
                    try {
                        const r = await inviteMember(api, team.brandId, email, inviteRole);
                        if (!valid()) return;
                        setInvited(r.invitation); setInviteEmail(''); setNotice(t('team.invitedDone', { email })); void load();
                    } catch (err) { if (valid()) setNotice(t(inviteErrorKey(err))); }
                    finally { if (valid()) { running.current = false; setBusy(false); } }
                },
            },
        ]);
    }

    // The link goes only to the share sheet, on a tap.
    async function shareInvite(url: string) {
        const valid = guard();
        try {
            await Share.share({ message: url });
        } catch {
            if (valid()) setNotice(t('team.err.share'));
        }
    }

    const mayChange = team ? team.actorRole === 'owner' || team.actorRole === 'manager' : false;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); }} />}>
            <Stack.Screen options={{ title: t('team.title') }} />
            {error ? (
                <StatusText variant="inherit" style={styles.error} accessibilityRole="alert">{error}</StatusText>
            ) : !team ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <>
                    {team.brandName ? <Text style={styles.intro}>{t('team.intro', { brand: team.brandName })}</Text> : null}
                    {notice ? <StatusText variant="inherit" style={styles.notice} accessibilityLiveRegion="polite">{notice}</StatusText> : null}
                    <Text style={styles.heading} accessibilityRole="header">{t('team.members')}</Text>
                    {team.members.map((m) => {
                        const editable = mayChange && canManage(team.actorRole, m.role);
                        return (
                            <View key={m.userId} style={styles.row}>
                                <View accessible accessibilityLabel={rawText(`${m.email}, ${roleLabel(m.role)}`)}>
                                    <Text style={styles.name}>{m.email}</Text>
                                    <Text style={styles.muted}>{roleLabel(m.role)}{m.joinedAt ? ` · ${t('team.joined', { date: day(m.joinedAt) })}` : ''}</Text>
                                </View>
                                {editable ? (
                                    <>
                                        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open === m.userId }} style={[styles.link, touchTarget]} onPress={() => setOpen(open === m.userId ? null : m.userId)}>
                                            <Text style={styles.linkText}>{t('team.change')}</Text>
                                        </Pressable>
                                        {open === m.userId ? (
                                            <View style={styles.chips}>
                                                {rolesFor(team.actorRole).map((r) => (
                                                    <Pressable key={r} disabled={busy} accessibilityRole="button" accessibilityState={{ selected: r === m.role, disabled: busy }} style={[styles.chip, touchTarget, r === m.role && styles.chipOn]} onPress={() => pickRole(m, r)}>
                                                        <Text style={[styles.chipText, r === m.role && styles.chipTextOn]}>{roleLabel(r)}</Text>
                                                    </Pressable>
                                                ))}
                                                <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={rawText(t('team.removeLabel', { email: m.email }))} style={[styles.chip, touchTarget]} onPress={() => remove(m)}>
                                                    <Text style={styles.danger}>{t('team.removeAction')}</Text>
                                                </Pressable>
                                            </View>
                                        ) : null}
                                    </>
                                ) : null}
                            </View>
                        );
                    })}
                    {team.invitations.length > 0 ? <Text style={styles.heading} accessibilityRole="header">{t('team.invited')}</Text> : null}
                    {team.invitations.map((i) => (
                        <View key={i.id} style={styles.row}>
                            <View accessible accessibilityLabel={rawText(`${i.email}, ${roleLabel(i.role)}, ${i.status}`)}>
                                <Text style={styles.name}>{i.email}</Text>
                                <Text style={styles.muted}>{roleLabel(i.role)} · {i.status}{i.expiresAt ? ` · ${t('team.expires', { date: day(i.expiresAt) })}` : ''}</Text>
                            </View>
                            {canRevoke(team.actorRole, i.role) && i.status === 'pending' ? (
                                <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={t('team.revokeLabel', { email: i.email })} style={[styles.link, touchTarget]} onPress={() => revoke(i.id, i.email)}>
                                    <Text style={styles.danger}>{t('team.revokeAction')}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ))}
                    {mayChange ? (
                        <View style={styles.row}>
                            <Text style={styles.heading} accessibilityRole="header">{t('team.inviteHeading')}</Text>
                            <TextInput style={styles.input} value={inviteEmail} onChangeText={setInviteEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" placeholder={t('team.inviteEmail')} accessibilityLabel={t('team.inviteEmail')} placeholderTextColor={colors.muted} />
                            <View style={styles.chips}>
                                {rolesFor(team.actorRole).map((r) => (
                                    <Pressable key={r} accessibilityRole="button" accessibilityState={{ selected: r === inviteRole }} style={[styles.chip, touchTarget, r === inviteRole && styles.chipOn]} onPress={() => setInviteRole(r)}>
                                        <Text style={[styles.chipText, r === inviteRole && styles.chipTextOn]}>{roleLabel(r)}</Text>
                                    </Pressable>
                                ))}
                            </View>
                            <Pressable disabled={busy} accessibilityRole="button" accessibilityState={{ disabled: busy }} style={[styles.send, touchTarget, busy && styles.off]} onPress={invite}>
                                <Text style={styles.sendText}>{t('team.inviteAction')}</Text>
                            </Pressable>
                            {invited?.url ? (
                                <View>
                                    <Text style={styles.muted}>{t('team.inviteLinkNote', { email: invited.email })}</Text>
                                    <Pressable accessibilityRole="button" accessibilityLabel={rawText(t('team.shareInviteFor', { email: invited.email }))} style={[styles.link, touchTarget]} onPress={() => shareInvite(invited.url as string)}>
                                        <Text style={styles.linkText}>{t('team.shareInvite')}</Text>
                                    </Pressable>
                                </View>
                            ) : null}
                        </View>
                    ) : <Text style={styles.muted}>{t('team.manageNote')}</Text>}
                </>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, paddingBottom: LIST_END_PADDING, gap: 8 },
    intro: { color: colors.body },
    notice: { color: colors.accent },
    heading: { color: colors.muted, fontSize: 13, textTransform: 'uppercase', marginTop: 12 },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
    name: { color: colors.text, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    link: { alignSelf: 'flex-start' },
    linkText: { color: colors.accent, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
    chip: { paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.body },
    chipTextOn: { color: colors.accentInk, fontWeight: '600' },
    danger: { color: colors.danger, fontWeight: '600' },
    input: { backgroundColor: colors.background, borderColor: colors.borderStrong, borderWidth: 1, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16, minHeight: 48 },
    send: { backgroundColor: colors.accent, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, marginTop: 6 },
    sendText: { color: colors.accentInk, fontWeight: '700' },
    off: { opacity: 0.4 },
    error: { color: colors.danger },
});
