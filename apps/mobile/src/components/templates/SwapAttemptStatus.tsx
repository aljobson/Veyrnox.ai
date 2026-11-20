import { useAnnouncement } from '../../lib/useAnnouncement';
import { useEffect, useSyncExternalStore } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Text } from '../ui';
import { SUPPORT_EMAIL } from '../../lib/account';
import { t } from '../../lib/i18n';
import { useSwapRuntime } from '../../lib/templateSwap/runtime';
import { unsettled, swapErrorKey, type Attempt } from '../../../../../app/veyrnox/_lib/templateSwapClient.mjs';
import { isOffline, subscribe } from '../../lib/networkState';
function Status({ attempt: a }: { attempt: Attempt }) {
    const { actions } = useSwapRuntime(a.templateId), router = useRouter(), offline = useSyncExternalStore(subscribe, isOffline);
    const poll = unsettled(a) && !['submitting', 'unresolved'].includes(a.state);
    useEffect(() => { if (poll && !offline) void actions.reconcile(a.templateId, a.key).catch(() => {}); }, [poll, offline, actions, a.templateId, a.key]);
    useAnnouncement(t(`presets.swap.${a.state}`, { credits: a.spent ?? a.body?.max_charge_credits ?? 0 }), { onMount: true });
    return <View style={{ gap: 12 }}>
        <Text accessibilityLiveRegion="polite">{t(`presets.swap.${a.state}`, { credits: a.spent ?? a.body?.max_charge_credits ?? 0 })}</Text>
        {a.state === 'not_charged' && <Text tone="danger">{t(swapErrorKey(a.errorCode))}</Text>}
        {a.balance !== undefined && <Text tone="warning">{t('presets.swap.balance', { credits: a.balance })}</Text>}
        {['unknown', 'unresolved', 'refund_pending'].includes(a.state) && <>
            <Button variant="secondary" label={t('presets.swap.check')} disabled={offline} onPress={() => void actions.reconcile(a.templateId, a.key).catch(() => {})} />
            <Button variant="tertiary" label={t('presets.swap.support')} onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
        </>}
        {['queued', 'running', 'succeeded'].includes(a.state) && <Button label={t('presets.swap.library')} onPress={() => router.push('/library')} />}
        {!unsettled(a) && <Button variant="tertiary" label={t('presets.swap.dismiss')} onPress={() => actions.cancel(a.key)} />}
    </View>;
}
// Always mounted, independent of the current catalog answer and runtime packaging flag.
export function SwapAttemptStatus({ templateId }: { templateId: string }) {
    const { attempts } = useSwapRuntime(templateId);
    return <>{attempts.filter(a => a.body).map(a => <Status key={`${a.accountId}:${a.key}`} attempt={a} />)}</>;
}
