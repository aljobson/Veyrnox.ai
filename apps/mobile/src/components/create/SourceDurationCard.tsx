import { Card, Text } from '../ui';
import { SectionLabel } from './SectionLabel';
import { t } from '../../lib/i18n';
import { kindOf, type CatalogModel } from '../../lib/media';
import { sourceDurationLimit } from '../../lib/modelFacts';

export function SourceDurationCard({ model }: { model: CatalogModel }) {
    const kind = kindOf(model.modality);
    const max = sourceDurationLimit(model);
    if ((kind !== 'video' && kind !== 'audio') || max === null) return null;
    return (
        <Card style={{ gap: 8 }}>
            <SectionLabel accessibilityRole="header">{t('sourceDuration.title')}</SectionLabel>
            <Text>{t('sourceDuration.follows')}</Text>
            <Text tone="secondary">{t('sourceDuration.limit', { max })}</Text>
            {model.id === 'latentsync' ? <Text variant="footnote" tone="secondary">{t('sourceDuration.speech')}</Text> : null}
        </Card>
    );
}
