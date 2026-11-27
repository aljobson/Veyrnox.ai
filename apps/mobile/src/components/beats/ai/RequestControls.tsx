import { Alert } from 'react-native';
import { Button, Text } from '../../ui';
import { t } from '../../../lib/i18n';
import type { Receipt, ReceiptRequest, View } from '../../../lib/beatAi/request';
import { QuoteCard } from './QuoteCard';
export function confirmDiscard(action: () => void) {
    Alert.alert(t('beatAi.discard'), t('beatAi.discardBody'), [
        { text: t('beatAi.cancel'), style: 'cancel' }, { text: t('beatAi.discard'), style: 'destructive', onPress: action },
    ]);
}
export function RequestControls<R extends Receipt>({ request, view, elapsed, offline, disabled = false }: { request: ReceiptRequest<R>; view: View<R>; elapsed: number; offline: boolean; disabled?: boolean }) {
    return <>
        {view.quote ? <>
            <QuoteCard quote={view.quote} original={!!view.record && !view.record.requestId} />
            <Button label={t(view.record?.requestId ? 'beatAi.check' : view.record ? 'beatAi.retry' : 'beatAi.send')}
                disabled={disabled || view.busy || offline || !view.quote.affordable} onPress={() => void request.send()} />
            {!view.record ? <Button label={t('beatAi.change')} disabled={disabled || view.busy} onPress={request.reset} /> : null}
        </> : null}
        {view.record ? <Button label={t('beatAi.discard')} disabled={disabled || view.busy} onPress={() => confirmDiscard(() => void request.discard())} /> : null}
        {view.busy || view.record?.requestId ? <Text accessibilityLiveRegion="polite">{t('beatAi.elapsed', { seconds: elapsed })}</Text> : null}
        {view.noticeKey ? <Text accessibilityLiveRegion="polite">{t(view.noticeKey)}</Text> : null}
        {view.messages.map((key, index) => <Text key={`${key}.${index}`} accessibilityLiveRegion="polite">{t(key)}</Text>)}
        {view.error ? <Text accessibilityRole="alert">{t(view.error, view.errorParams)}</Text> : null}
        <Text variant="footnote">{t('beatAi.library')}</Text>
    </>;
}
