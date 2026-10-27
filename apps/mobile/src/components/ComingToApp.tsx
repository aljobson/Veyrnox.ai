import { Text } from './ui/Text';
import { t } from '../lib/i18n';
export function ComingToApp() {
    return <Text variant="footnote" tone="secondary">{t('common.comingToApp')}</Text>;
}
