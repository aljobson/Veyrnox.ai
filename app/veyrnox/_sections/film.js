import { FilmPlayer } from '../_components/FilmPlayer';
import { LANDING_FILM } from '../_lib/film';
import { getT } from '../../../lib/i18n/server';

/* ─── The film: the hero's promise, played out in fifteen seconds ─── */

// The film has no sound and no figures a reader needs: home.film.summary says
// what it shows, for anyone who cannot watch it. No prices there, so a catalog
// change never makes it wrong.
export async function LandingFilm() {
  const { t } = await getT();
  return (
    <section data-vey-perch aria-labelledby="film-title" className="px-4 sm:px-6 max-w-[1300px] mx-auto pb-16 lg:pb-24">
      <h2 id="film-title" className="sr-only">{t('home.film.title')}</h2>
      <p className="sr-only">{t('home.film.summary')}</p>
      <FilmPlayer film={LANDING_FILM} />
    </section>
  );
}
