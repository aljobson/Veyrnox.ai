import { Button, Text } from '../ui';
import { BeatModal } from './BeatModal';
import { t } from '../../lib/i18n';
import type { BeatCloudSync, SyncView } from '../../lib/beatNative/cloudSync';
export function BeatCloudConflictModal({ sync, view }: { sync: BeatCloudSync; view: SyncView }) {
    if (!view.conflict) return null;
    return <BeatModal title={t('beat.conflict.title')} onClose={() => sync.later()}>
        <Text>{t('beat.conflict.body')}</Text>
        {view.busy ? <Text accessibilityLiveRegion="polite">{t('beat.conflict.busy')}</Text> : null}
        {view.detail ? <Text accessibilityRole="alert" tone="danger">{t('beat.conflict.error')}</Text> : null}
        <Button label={t('beat.conflict.mine')} disabled={view.busy} onPress={() => void sync.resolve('mine')} />
        <Button label={t('beat.conflict.theirs')} disabled={view.busy} onPress={() => void sync.resolve('theirs')} />
        <Button label={t('beat.conflict.later')} variant="tertiary" disabled={view.busy} onPress={() => sync.later()} />
    </BeatModal>;
}
