import { useAnnouncement } from '../../lib/useAnnouncement';
import { useEffect, useRef, useSyncExternalStore, type ComponentRef, type RefObject } from 'react';
import { Linking, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Text } from '../ui';
import { GenerationProgress } from '../GenerationProgress';
import { SUPPORT_EMAIL } from '../../lib/account';
import { t } from '../../lib/i18n';
import { useSwapRuntime } from '../../lib/templateSwap/runtime';
import { unsettled, swapErrorKey, type Attempt } from '../../../../../app/veyrnox/_lib/templateSwapClient.mjs';
import { isOffline, subscribe } from '../../lib/networkState';
type Reveal = { revealAttempt?: RefObject<string | null>; onReveal?: (node: ComponentRef<typeof View> | null) => void };
function Status({ attempt: a, revealAttempt, onReveal }: { attempt: Attempt } & Reveal) {
    const box = useRef<ComponentRef<typeof View>>(null);
    useEffect(() => {
        if (!revealAttempt || revealAttempt.current !== a.key) return;
        revealAttempt.current = null;
        requestAnimationFrame(() => onReveal?.(box.current));
    }, [revealAttempt, onReveal, a.key, a.state]);
    const { actions } = useSwapRuntime(a.templateId), router = useRouter(), offline = useSyncExternalStore(subscribe, isOffline);
    const poll = unsettled(a) && !['submitting', 'unresolved'].includes(a.state);
    useEffect(() => { if (poll && !offline) void actions.reconcile(a.templateId, a.key).catch(() => {}); }, [poll, offline, actions, a.templateId, a.key]);
    useAnnouncement(t(`presets.swap.${a.state}`, { credits: a.spent ?? a.body?.max_charge_credits ?? 0 }), { onMount: true });
    return <View ref={box} collapsable={false} style={{ gap: 12 }}>
        <Text accessibilityLiveRegion="polite">{t(`presets.swap.${a.state}`, { credits: a.spent ?? a.body?.max_charge_credits ?? 0 })}</Text>
        {['queued', 'running'].includes(a.state) && a.job_id ? <GenerationProgress key={a.job_id} jobId={a.job_id} modelId={a.body?.model_id} kind="video" compact /> : null}
        {a.state === 'refunded' && <Text tone="danger">{t('presets.swap.refundedReason')}</Text>}
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
export function SwapAttemptStatus({ templateId, revealAttempt, onReveal }: { templateId: string } & Reveal) {
    const { attempts } = useSwapRuntime(templateId);
    return <>{attempts.filter(a => a.body).reverse().map(a => <Status key={`${a.accountId}:${a.key}`} attempt={a} revealAttempt={revealAttempt} onReveal={onReveal} />)}</>;
}
