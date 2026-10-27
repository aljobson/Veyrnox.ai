import { useSyncExternalStore } from 'react';
import { getCacheUser } from '../../lib/appCache';
import { peekCheckin, requestCheckinOpen, subscribeCheckin } from '../../lib/checkinEntry';
import { t } from '../../lib/i18n';
import { Button } from '../ui';
export function CheckInEntry({ unclaimedOnly = false }: { unclaimedOnly?: boolean }) {
    const status = useSyncExternalStore(subscribeCheckin, () => peekCheckin(getCacheUser()));
    if (!status || (unclaimedOnly && status.claimed_today)) return null;
    return <Button variant="secondary" size="md" label={t('checkin.entry')} onPress={requestCheckinOpen} />;
}
