import { Text } from './ui';
import { t } from '../lib/i18n';
import { shapeLabelParts, type ShapeItem } from '../lib/videoShape';
export function videoShapeLabel(item: ShapeItem, exactFallback = false): string | null {
    const parts = shapeLabelParts(item);
    const w = item.video_width ?? item.width, h = item.video_height ?? item.height;
    const detail = parts?.ratio || (exactFallback && w && h ? `${w}x${h}` : '');
    return parts ? `${t(`videoShape.${parts.orientation}`)}${detail ? ` ${detail}` : ''}` : null;
}
export function VideoShapeBadge({ item, mismatch = false }: { item: ShapeItem; mismatch?: boolean }) {
    const label = videoShapeLabel(item);
    if (!label) return null;
    const w = item.video_width ?? item.width, h = item.video_height ?? item.height;
    return <Text variant="caption" tone={mismatch ? 'danger' : 'secondary'}>{label}{mismatch ? ` · ${t('videoShape.different')}${w && h ? ` · ${w}x${h}` : ''}` : ''}</Text>;
}
