import { Text, themedStyles, useThemedStyles } from './ui';

import { formatAge, type CacheMeta } from '../lib/cache';
import { t } from '../lib/i18n';

// Says that what is on screen is a saved copy, not live. Renders nothing for live data.
export function StaleNote({ meta }: { meta: CacheMeta | null }) {
    const styles = useThemedStyles(sheets);
    if (!meta?.fromCache) return null;
    const age = formatAge(meta.ageMs);
    return <Text variant="caption" tone="tertiary" style={styles.note}>{age ? t('cache.stale', { age }) : t('cache.staleNow')}</Text>;
}

const sheets = themedStyles((p) => ({
 note: { color: p.textTertiary, } }));
