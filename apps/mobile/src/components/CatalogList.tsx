import { Text as StatusText } from './ui/Text';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { groupModels, type Group } from '../lib/catalogPages';
import { t } from '../lib/i18n';
import { fetchCatalog, fetchAllCatalog } from '../lib/media';
import { colors } from '../theme';
import { Action } from './account/shared';

// Loads the public catalogue and hands each group of models to the screen to draw.
export function CatalogList({ render, includeGated = false }: { includeGated?: boolean; render: (g: Group) => React.ReactNode }) {
    const [groups, setGroups] = useState<Group[] | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        let live = true;
        setFailed(false);
        (includeGated ? fetchAllCatalog() : fetchCatalog()).then(
            (m) => live && setGroups(groupModels(m)),
            () => live && setFailed(true),
        );
        return () => {
            live = false;
        };
    }, [attempt, includeGated]);

    if (failed) {
        return (
            <View style={{ gap: 12 }}>
                <StatusText variant="inherit" style={styles.note} accessibilityRole="alert">{t('catalog.failed')}</StatusText>
                <Action label={t('acct.mfa.retry')} onPress={() => setAttempt((n) => n + 1)} />
            </View>
        );
    }
    if (!groups) return <ActivityIndicator color={colors.accent} accessibilityLabel={t('catalog.loading')} />;
    if (groups.length === 0) return <Text style={styles.note}>{t('catalog.empty')}</Text>;
    return <>{groups.map((g) => <View key={g.kind} style={{ gap: 8 }}>{render(g)}</View>)}</>;
}

export const kindTitleKey = (kind: Group['kind']) => `catalog.kind.${kind}` as const;

const styles = StyleSheet.create({ note: { color: colors.muted, fontSize: 14 } });
