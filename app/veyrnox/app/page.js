'use client';
import { useI18n } from '../../../components/I18nProvider';
import Link from 'next/link';
import Image from 'next/image';
import { AppNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { PresetGallery } from '../_components/PresetGallery';
import { VibeOffer } from '../_components/VibeOffer';
import { useVibe } from '../_lib/creatorProfile';

function StarterIcon({ name }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {name === 'create' && <><rect x="3" y="4" width="18" height="16" rx="3" /><circle cx="9" cy="10" r="1.5" /><path d="m4 18 5-5 4 4 3-3 4 4" /></>}
      {name === 'chat' && <><path d="M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" /><path d="M8 9h8M8 13h5" /></>}
      {name === 'film' && <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 4v16M16 4v16M4 9h4m8 0h4M4 15h4m8 0h4" /></>}
    </svg>
  );
}

function StarterCard({ href, label, description, icon }) {
  return (
    <Link
      href={href}
      data-testid={`explore-starter-${icon}`}
      className="group flex min-h-48 flex-col rounded-[20px] border border-vx-border bg-vx-panel p-5 transition-[border-color,background-color,scale] duration-150 ease-(--vx-ease-out) hover:border-vx-accent hover:bg-vx-base active:scale-[0.96]"
    >
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-vx-accent/10 text-vx-accent">
        <StarterIcon name={icon} />
      </span>
      <span className="mt-5 text-xl font-bold tracking-[-0.02em]">{label}</span>
      <span className="mt-2 text-pretty text-sm leading-6 text-vx-fg-body">{description}</span>
      <span aria-hidden="true" className="mt-auto pt-5 text-lg leading-none text-vx-accent transition-transform duration-150 ease-(--vx-ease-out) group-hover:translate-x-1 rtl:group-hover:-translate-x-1">→</span>
    </Link>
  );
}

export default function Explore() {
  const { t } = useI18n();
  // The vibe check (ADR-0251): an invitation while no choice is on record, and the order of templates once there is one.
  const vibe = useVibe();
  return (
    <div className="min-h-dvh">
      {/* No balance prop: AppNav reads the signed-in balance itself. This
          used to pass a hardcoded 823, so the pill showed a number that
          belonged to nobody. */}
      <AppNav active="explore" />
      <Main className="mx-auto max-w-[1400px] px-4 pb-16 pt-8 sm:px-8 sm:pt-10">
        <header className="max-w-[760px]">
          <h1 className="vx-display text-balance text-[40px] sm:text-[56px]">{t('app.explore.start')}</h1>
          <p className="mt-3 max-w-[62ch] text-pretty leading-[1.6] text-vx-fg-body">{t('app.explore.startIntro')}</p>
        </header>

        <section aria-label={t('app.explore.start')} className="my-8 grid gap-3 md:grid-cols-3">
          <StarterCard href="/app/create" label={t('label.Create')} description={t('app.explore.createStart')} icon="create" />
          <StarterCard href="/app/chat" label={t('label.LLM Chat')} description={t('app.explore.chat')} icon="chat" />
          <StarterCard href="/app/film-studio" label={t('label.Film Studio')} description={t('app.explore.filmStart')} icon="film" />
        </section>

        <VibeOffer status={vibe.status} onSkipped={vibe.reload} />
        <Link href="/app/oddlings" className="group mb-12 grid overflow-hidden rounded-[20px] border border-vx-border bg-vx-panel transition-[border-color,scale] duration-150 ease-(--vx-ease-out) hover:border-vx-accent active:scale-[0.96] lg:grid-cols-[.9fr_1.1fr]">
          <div className="relative min-h-52 overflow-hidden bg-vx-base lg:min-h-64">
            <Image
              src="/oddlings/oddling-body-chaos.webp"
              width={1600}
              height={800}
              alt={t("app.explore.castAlt")}
              loading="eager"
              sizes="(max-width: 1023px) 100vw, 55vw"
              className="absolute inset-0 h-full w-full object-cover outline -outline-offset-1 outline-white/10 transition-transform duration-300 ease-(--vx-ease-out) motion-safe:group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-linear-to-t from-black/65 via-transparent to-transparent" />
            <span className="absolute bottom-4 start-4 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 font-vx-mono text-[9px] font-bold tracking-[0.14em] text-white backdrop-blur-sm">{t("app.explore.cast")}</span>
          </div>
          <span className="flex flex-col justify-center p-6 sm:p-8 lg:p-10">
            <span className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">{t("app.explore.new")}</span>
            <span className="vx-display mt-3 text-[34px] sm:text-[42px]">{t("app.explore.silhouette")}</span>
            <span className="mt-4 max-w-[38ch] leading-relaxed text-vx-fg-body">{t("app.explore.oddlings")}</span>
            <span className="mt-5 font-bold text-vx-accent">{t("app.explore.openOddlings")}</span>
          </span>
        </Link>
        <section aria-labelledby="explore-presets-title">
          <h2 id="explore-presets-title" className="vx-display text-balance text-[30px] sm:text-[38px]">{t('app.explore.presets')}</h2>
          <p className="mb-7 mt-2 max-w-[60ch] text-pretty leading-[1.6] text-vx-fg-body">{t('app.explore.intro')}</p>
          <PresetGallery size="md" columns="lg:columns-4" taste={vibe.answers} />
        </section>
      </Main>
    </div>
  );
}
