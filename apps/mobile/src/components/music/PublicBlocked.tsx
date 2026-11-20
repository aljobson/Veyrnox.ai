import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { Blocked } from '../../lib/music/publicTypes';
export function PublicBlocked({ blocked, busy, unblock }: Blocked & { busy: boolean; unblock(): void }) {
    return <><Text accessibilityLiveRegion="polite">{t('musicPublic.blockedState', { name: blocked.display_name })}</Text>
        <Button label={t('musicPublic.unblock')} disabled={busy} onPress={unblock} /></>;
}
