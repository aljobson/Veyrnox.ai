import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '../../../lib/i18n';
import { roleLabel } from '../../../lib/publishBrand';
import { fetchTeam, teamErrorKey, type Team } from '../../../lib/publishTeam';
import { usePublishApi } from '../../../lib/usePublishApi';
import { colors } from '../../../theme';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '');

export default function TeamScreen() {
    const api = usePublishApi();
    const [team, setTeam] = useState<Team | null>(null);
    const [error, setError] = useState<string | null>(null);
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
                    <Text style={styles.heading} accessibilityRole="header">{t('team.members')}</Text>
                    {team.members.map((m) => (
                        <View key={m.userId} style={styles.row} accessible accessibilityLabel={`${m.email}, ${roleLabel(m.role)}`}>
                            <Text style={styles.name}>{m.email}</Text>
                            <Text style={styles.muted}>{roleLabel(m.role)}{m.joinedAt ? ` · ${t('team.joined', { date: day(m.joinedAt) })}` : ''}</Text>
                        </View>
                    ))}
                    {team.invitations.length > 0 ? <Text style={styles.heading} accessibilityRole="header">{t('team.invited')}</Text> : null}
                    {team.invitations.map((i) => (
                        <View key={i.id} style={styles.row} accessible accessibilityLabel={`${i.email}, ${roleLabel(i.role)}, ${i.status}`}>
                            <Text style={styles.name}>{i.email}</Text>
                            <Text style={styles.muted}>{roleLabel(i.role)} · {i.status}{i.expiresAt ? ` · ${t('team.expires', { date: day(i.expiresAt) })}` : ''}</Text>
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
    body: { padding: 16, gap: 8 },
    intro: { color: colors.body },
    heading: { color: colors.muted, fontSize: 13, textTransform: 'uppercase', marginTop: 12 },
    row: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
    name: { color: colors.text, fontSize: 15 },
    muted: { color: colors.muted, fontSize: 13 },
    error: { color: colors.danger },
});
