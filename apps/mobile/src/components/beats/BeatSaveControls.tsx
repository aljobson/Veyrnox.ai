import { useState } from 'react';
import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { BeatCloudSync } from '../../lib/beatNative/cloudSync';
import { useBeatSession } from '../../lib/beatNative/useBeatSession';
import { beatStore } from '../../lib/beatNative/store';
import type { Edit } from '../../lib/beatNative/doc';
import { BeatCloudConflictModal } from './BeatCloudConflictModal';
import { BeatVersionsSheet } from './BeatVersionsSheet';
export function BeatSaveControls({ id, apply }: { id: string; apply(edit: Edit, label?: string): boolean }) {
    const { sync, view } = useBeatSession(id);
    const [versions, setVersions] = useState<BeatCloudSync | null>(null);
    const saveState = beatStore.saveState(id);
    return <>
        <Text variant="footnote" accessibilityLiveRegion="polite">{t(`beat.local.${saveState}`)}</Text>
        {saveState === 'error' ? <Button label={t('beat.retry')} onPress={() => void beatStore.flushBeat(id).catch(() => undefined)} /> : null}
        <Text variant="footnote" accessibilityLiveRegion="polite">{t(`beat.cloud.${view.state}`)}</Text>
        {view.state === 'unlinked' || view.state === 'removed' ? <Button label={t(view.state === 'removed' ? 'beat.cloud.linkAgain' : 'beat.cloud.link')} onPress={() => void sync.link()} /> : null}
        {['offline', 'error', 'rate_limited', 'limit', 'takes'].includes(view.state) ? <Button label={t('beat.retry')} disabled={view.busy} onPress={() => void sync.retry()} /> : null}
        {!['off', 'checking', 'signed_out', 'other'].includes(view.state) ? <Button label={t('beat.versions.title')} onPress={() => setVersions(sync)} /> : null}
        {view.state === 'paused_conflict' ? <Button label={t('beat.conflict.choose')} onPress={() => sync.chooseVersion()} /> : null}
        <BeatCloudConflictModal sync={sync} view={view} />
        {versions === sync ? <BeatVersionsSheet key={sync.id} sync={sync} view={view} apply={apply} onClose={() => setVersions(null)} /> : null}
    </>;
}
