import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { VEY_CLEARANCE } from '../../../components/VeyMascot';
import { touchTarget } from '../../../lib/a11y';
import { t } from '../../../lib/i18n';
import { roleLabel } from '../../../lib/publishBrand';
import { canManage, changeRole, fetchTeam, removeMember, revokeInvite, rolesFor, teamActionErrorKey, teamErrorKey, type ChangeableRole, type Member, type Team } from '../../../lib/publishTeam';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

export default function TeamScreen() {
    const api = usePublishApi();
    const [team, setTeam] = useState<Team | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [open, setOpen] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            setTeam(await fetchTeam(api));
            setError(null);
        } catch (err) {
            setTeam(null);
            setError(t(teamErrorKey(err)));
        }
    }, [api]);

    useEffect(() => {
        setTeam(null);
        load();
    }, [load]);

    // Each change is one request; the list is read again afterwards so it shows what the server now holds.
    function run(action: () => Promise<unknown>, done: string) {
        if (busy) return;
        setBusy(true);
        setNotice(null);
        action()
            .then(() => setNotice(done))
            .catch((err) => setNotice(t(teamActionErrorKey(err))))
            .finally(() => {
                setBusy(false);
                setOpen(null);
                void load();
            });
    }

    function pickRole(m: Member, role: ChangeableRole) {
        if (!team || role === m.role) return;
        Alert.alert(t('team.roleTitle', { email: m.email }), t('team.roleBody', { role: roleLabel(role) }), [
            { text: t('team.cancel'), style: 'cancel' },
            { text: t('team.roleAction'), onPress: () => run(() => changeRole(api, team.brandId, m.userId, role), t('team.roleDone', { email: m.email, role: roleLabel(role) })) },
        ]);
    }

    function remove(m: Member) {
        if (!team) return;
        Alert.alert(t('team.removeTitle', { email: m.email }), t('team.removeBody'), [
            { text: t('team.cancel'), style: 'cancel' },
            { text: t('team.removeAction'), style: 'destructive', onPress: () => run(() => removeMember(api, team.brandId, m.userId), t('team.removed', { email: m.email })) },
        ]);
    }

    function revoke(id: string, email: string) {
        if (!team) return;
        Alert.alert(t('team.revokeTitle', { email }), t('team.revokeBody'), [
            { text: t('team.cancel'), style: 'cancel' },
            { text: t('team.revokeAction'), style: 'destructive', onPress: () => run(() => revokeInvite(api, team.brandId, id), t('team.revoked', { email })) },
        ]);
    }

    const mayChange = team ? team.actorRole === 'owner' || team.actorRole === 'manager' : false;

    return (
        <ScrollView style={styles.screen} contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.accent} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}>
            <Stack.Screen options={{ title: t('team.title') }} />
            {error ? (
                <Text style={styles.error} accessibilityRole="alert">{error}</Text>
            ) : !team ? (
                <ActivityIndicator color={colors.accent} />
            ) : (
                <>
                    {team.brandName ? <Text style={styles.intro}>{t('team.intro', { brand: team.brandName })}</Text> : null}
                    {notice ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text> : null}
                    <Text style={styles.heading} accessibilityRole="header">{t('team.members')}</Text>
                    {team.members.map((m) => {
                        const editable = mayChange && canManage(team.actorRole, m.role);
                        return (
                            <View key={m.userId} style={styles.row}>
                                <View accessible accessibilityLabel={`${m.email}, ${roleLabel(m.role)}`}>
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
                                                <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={t('team.removeLabel', { email: m.email })} style={[styles.chip, touchTarget]} onPress={() => remove(m)}>
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
                            <View accessible accessibilityLabel={`${i.email}, ${roleLabel(i.role)}, ${i.status}`}>
                                <Text style={styles.name}>{i.email}</Text>
                                <Text style={styles.muted}>{roleLabel(i.role)} · {i.status}{i.expiresAt ? ` · ${t('team.expires', { date: day(i.expiresAt) })}` : ''}</Text>
                            </View>
                            {mayChange && i.status === 'pending' ? (
                                <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel={t('team.revokeLabel', { email: i.email })} style={[styles.link, touchTarget]} onPress={() => revoke(i.id, i.email)}>
                                    <Text style={styles.danger}>{t('team.revokeAction')}</Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ))}
                    <Text style={styles.muted}>{t('team.manageNote')}</Text>
                </>
            )}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    body: { padding: 16, paddingBottom: VEY_CLEARANCE, gap: 8 },
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
    error: { color: colors.danger },
});
