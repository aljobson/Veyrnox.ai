import { useI18n } from '../../../components/I18nProvider';
import { shapeLabelParts } from '../../../lib/videoShape.mjs';
export function videoShapeLabel(item, t, exactFallback = false) {
  const parts = shapeLabelParts(item);
  const w = item.video_width ?? item.width, h = item.video_height ?? item.height;
  const detail = parts?.ratio || (exactFallback && w && h ? `${w}x${h}` : '');
  return parts ? `${t(`app.library.shape.${parts.orientation}`)}${detail ? ` ${detail}` : ''}` : null;
}
export function VideoShapeBadge({ item, mismatch = false }) {
  const { t } = useI18n();
  const label = videoShapeLabel(item, t);
  if (!label) return null;
  const w = item.video_width ?? item.width, h = item.video_height ?? item.height;
  return <span className={`text-xs ${mismatch ? 'text-vx-danger' : 'text-vx-fg-muted'}`}>
    {label}{mismatch ? ` · ${t('app.library.shape.different')}${w && h ? ` · ${w}x${h}` : ''}` : ''}
  </span>;
}
