import { Button, Card, Text } from '../ui';
import { t } from '../../lib/i18n';

export function TemplatePromptReady({ onEdit }: { readonly onEdit: () => void }) {
    return <Card testID="template-prompt-ready">
        <Text variant="bodyStrong" accessibilityLiveRegion="polite">{t('app.create.templatePrompt.ready')}</Text>
        <Text variant="footnote" tone="secondary">{t('app.create.templatePrompt.help')}</Text>
        <Button variant="secondary" label={t('app.create.templatePrompt.edit')} accessibilityRole="button" onPress={onEdit} />
    </Card>;
}
