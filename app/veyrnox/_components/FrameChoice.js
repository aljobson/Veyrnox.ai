'use client';
import { ChipSelect } from './ChipSelect';
import { useI18n } from '../../../components/I18nProvider';
import { FRAME_RATIOS, takesFrame } from '../../../lib/aspectFrame.mjs';
import { aspectLabel } from '../../../lib/platformFormats.js';

const ORIGINAL = '';
const OPTIONS = [ORIGINAL, ...FRAME_RATIOS];

// Ratio chip for image-to-video models with no ratio of their own: the start image is centre-cropped to it before
// upload. "Original" (the default) sends the photo untouched, so nothing changes for anyone who leaves it alone.
export function FrameChoice({ modelId, value, onChange }) {
  const { t } = useI18n();
  if (!takesFrame(modelId)) return null;
  const label = (option) => (option === ORIGINAL ? t('app.create.frameOriginal') : aspectLabel(option));
  return (
    <ChipSelect assistantTarget="create.frame" aria-label={t('app.create.aspectHeading')} options={OPTIONS} value={value}
      onChange={onChange} formatOption={label} formatValue={(option) => (option === ORIGINAL ? t('app.create.frameOriginal') : option)} />
  );
}
