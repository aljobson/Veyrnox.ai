'use client';
import { useI18n } from '../../../components/I18nProvider';
// The disclosure on every showcase clip: whether the footage was generated
// here or is the source that inspired the template. One definition, so the
// tiles and the template page cannot word it differently. The parent must be
// positioned and share its top-left corner with the clip.
export function ClipBadge({ clip }) {
  const { t } = useI18n();
  return (
    <span
      title={clip.title}
      className="absolute start-3 top-3 max-w-[calc(100%-1.5rem)] rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur-sm"
    >
      {t(clip.generatedOnVeyrnox ? 'chrome.clipGenerated' : 'chrome.clipInspiration')}
    </span>
  );
}
