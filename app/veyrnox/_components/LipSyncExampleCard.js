'use client';

import { useI18n } from '../../../components/I18nProvider';

export default function LipSyncExampleCard() {
  const { t } = useI18n();
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-vx-border bg-vx-panel">
      <div className="px-5 py-4 sm:px-6">
        <p className="font-vx-mono text-[10px] font-bold uppercase tracking-[0.14em] text-vx-accent">{t('app.features.example')}</p>
        <h2 className="mt-1 text-xl font-black">{t('app.features.exampleTitle')}</h2>
      </div>
      <video
        controls
        playsInline
        preload="metadata"
        poster="/examples/lip-sync.jpg"
        src="/examples/lip-sync.mp4"
        className="aspect-video max-h-[520px] w-full bg-black object-contain"
        aria-label={t('app.features.exampleAria', { title: 'AI Lip Sync' })}
      />
    </section>
  );
}
