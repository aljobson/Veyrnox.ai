import { Button, Card, Text } from '../ui';
import { t } from '../../lib/i18n';

export function TemplatePromptReady({ onEdit, status = 'idle' }: { readonly onEdit: () => void; readonly status?: 'idle' | 'loading' | 'error' }) {
    return <Card testID="template-prompt-ready">
        <Text variant="bodyStrong" accessibilityLiveRegion="polite">{t('app.create.templatePrompt.ready')}</Text>
        <Text variant="footnote" tone="secondary">{t('app.create.templatePrompt.help')}</Text>
        {status === 'error' ? <Text variant="footnote" tone="danger" accessibilityLiveRegion="polite">{t('app.create.templatePrompt.error')}</Text> : null}
        <Button variant="secondary" label={t('app.create.templatePrompt.edit')} accessibilityRole="button" disabled={status === 'loading'} onPress={onEdit} />
    </Card>;
}
