import { Button, Text } from '../ui';
import { t } from '../../lib/i18n';
import type { createPublicFlow, PublicFlowState } from '../../lib/music/publicFlow';
export function PublicAttemptNotice({ flow, state }: { flow: ReturnType<typeof createPublicFlow>; state: PublicFlowState }) {
    const pending = flow.attempts.snapshot();
    return <>
        {state.notice ? <Text accessibilityLiveRegion="polite">{t(state.notice === 'pending' ? 'musicPublic.pending' : state.notice === 'replyRemoved' ? 'musicPublic.replyRemoved' : 'musicPublic.saved')}</Text> : null}
        {pending ? <><Text>{t('musicPlaylists.pending')}</Text><Button label={t('music.retry')} disabled={state.busy}
            onPress={() => void flow.write(pending.write)} /></> : null}
    </>;
}
