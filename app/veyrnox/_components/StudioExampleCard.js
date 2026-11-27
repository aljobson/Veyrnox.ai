'use client';

import { useI18n } from '../../../components/I18nProvider';
import { creativeFeatureExample } from '../_lib/creativeFeatures';

// One example card for guided studios. It renders only media we host
// ourselves (a path under /examples/); a studio with no owned example shows nothing rather than a borrowed clip.
export default function StudioExampleCard({ slug, title, poster }) {
  const { t } = useI18n();
  const example = creativeFeatureExample(slug);
  if (!example || !example.url.startsWith('/examples/')) return null;
  const aria = t('app.features.exampleAria', { title });
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <div className="px-5 py-4 sm:px-6">
        <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{t('app.features.example')}</p>
        <h2 className="mt-1 text-xl font-black">{t('app.features.exampleTitle')}</h2>
      </div>
      {example.kind === 'video'
        ? <video controls playsInline preload="metadata" poster={poster} src={example.url} className="aspect-video max-h-[520px] w-full bg-black object-contain" aria-label={aria} />
        : <img loading="lazy" src={example.url} alt={aria} className="max-h-[520px] w-full bg-black object-contain" />}
    </section>
  );
}
