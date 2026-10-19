import Link from 'next/link';
import { FilmPlayer } from '../_components/FilmPlayer';
import { Logo } from '../_components/Logo';
import { BREAKTHROUGH_FILM, LANDING_FILM } from '../_lib/film';
import { getT } from '../../../lib/i18n/server';
import { localizedHref } from '../../../lib/i18n/locales.mjs';

export async function BreakthroughVideo() {
  const { locale, t } = await getT();
  const create = localizedHref(locale, '/app/create?model=nano-banana-kie');
  return (
    <section id="breakthrough" aria-labelledby="breakthrough-title" className="scroll-mt-20 pb-16 lg:pb-24">
      <h2 id="breakthrough-title" className="sr-only">{t('home.breakthrough.title')}</h2>
      <p className="sr-only">{t('home.breakthrough.film')}</p>
      <FilmPlayer film={BREAKTHROUGH_FILM} label={t('public.film.robot')} frameless mobileFullscreen>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:hidden">
          <Link href={create} className="pointer-events-auto vx-press inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 py-3 text-[15px] font-extrabold text-[#0a0a0b] hover:bg-white/85">{t('home.hero.start')}</Link>
        </div>
      </FilmPlayer>
      <div className="mx-auto max-w-[1300px] px-4 sm:px-6 pt-6 hidden sm:flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <Logo size={44} wordmark className="[&>span]:text-[34px]" />
        <Link href={create} className="vx-press inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-vx-fg px-6 py-3 text-[15px] font-extrabold text-vx-base hover:bg-vx-fg/85">{t('home.hero.start')}</Link>
      </div>
    </section>
  );
}

/* ─── The film: the hero's promise, played out in fifteen seconds ─── */

// The film has no sound and no figures a reader needs: home.film.summary says
// what it shows, for anyone who cannot watch it. No prices there, so a catalog
// change never makes it wrong.
export async function LandingFilm() {
  const { t } = await getT();
  return (
    <section aria-labelledby="film-title" className="px-4 sm:px-6 max-w-[1300px] mx-auto pb-16 lg:pb-24">
      <h2 id="film-title" className="sr-only">{t('home.film.title')}</h2>
      <p className="sr-only">{t('home.film.summary')}</p>
      <FilmPlayer film={LANDING_FILM} />
    </section>
  );
}
