import { StyleSheet, Text } from 'react-native';
import { formatAge, type CacheMeta } from '../lib/cache';
import { t } from '../lib/i18n';
import { colors } from '../theme';

// Says that what is on screen is a saved copy, not live. Renders nothing for live data.
export function StaleNote({ meta }: { meta: CacheMeta | null }) {
    if (!meta?.fromCache) return null;
    const age = formatAge(meta.ageMs);
    return <Text style={styles.note}>{age ? t('cache.stale', { age }) : t('cache.staleNow')}</Text>;
}

const styles = StyleSheet.create({ note: { color: colors.muted, fontSize: 12 } });
