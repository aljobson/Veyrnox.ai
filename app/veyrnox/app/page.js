'use client';
import { useI18n } from '../../../components/I18nProvider';
import Link from 'next/link';
import Image from 'next/image';
import { AppNav } from '../_components/NavBar';
import { Main } from '../_components/Main';
import { PresetGallery } from '../_components/PresetGallery';
import { VibeOffer } from '../_components/VibeOffer';
import { useVibe } from '../_lib/creatorProfile';

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
      <Main className="max-w-[1400px] mx-auto px-4 sm:px-8 pt-10 pb-16">
        <h1 className="vx-display text-[40px] sm:text-[56px]">{t("app.explore.presets")}</h1>
        <p className="mt-3 mb-8 text-vx-fg-body max-w-[52ch] leading-[1.6]">{t("app.explore.intro")}</p>
        <VibeOffer status={vibe.status} onSkipped={vibe.reload} />
        <Link href="/app/oddlings" className="group mb-4 grid overflow-hidden rounded-2xl border border-vx-border bg-vx-panel transition-colors hover:border-vx-accent lg:grid-cols-[1.15fr_.85fr]">
          <div className="relative min-h-56 overflow-hidden bg-vx-base">
            <Image
              src="/oddlings/oddling-body-chaos.webp"
              width={1600}
              height={800}
              alt={t("app.explore.castAlt")}
              loading="eager"
              sizes="(max-width: 1023px) 100vw, 55vw"
              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-linear-to-t from-black/65 via-transparent to-transparent" />
            <span className="absolute bottom-4 start-4 rounded-full border border-white/20 bg-black/45 px-3 py-1.5 font-vx-mono text-[9px] font-bold tracking-[0.14em] text-white backdrop-blur-sm">{t("app.explore.cast")}</span>
          </div>
          <span className="flex flex-col justify-center p-6 sm:p-8">
            <span className="font-vx-mono text-[10px] font-bold tracking-[0.16em] text-vx-accent">{t("app.explore.new")}</span>
            <span className="vx-display mt-3 text-[34px] sm:text-[42px]">{t("app.explore.silhouette")}</span>
            <span className="mt-4 max-w-[38ch] leading-relaxed text-vx-fg-body">{t("app.explore.oddlings")}</span>
            <span className="mt-5 font-bold text-vx-accent">{t("app.explore.openOddlings")}</span>
          </span>
        </Link>
        <Link href="/app/chat" className="mb-8 flex flex-col gap-1 rounded-2xl border border-vx-border bg-vx-panel p-5 transition-colors hover:border-vx-accent sm:flex-row sm:items-center sm:justify-between">
          <span>
            <span className="block text-lg font-semibold">{t("label.LLM Chat")}</span>
            <span className="block text-vx-fg-body">{t("app.explore.chat")}</span>
          </span>
          <span aria-hidden="true" className="font-semibold text-vx-accent">{t("app.explore.openChat")}</span>
        </Link>
        <PresetGallery size="md" columns="lg:columns-4" taste={vibe.answers} />
      </Main>
    </div>
  );
}
