import { FilmPlayer } from '../_components/FilmPlayer';
import { LANDING_FILM } from '../_lib/film';

/* ─── The film: the hero's promise, played out in fifteen seconds ─── */

// The film has no sound and no figures a reader needs: this says what it
// shows, for anyone who cannot watch it. No prices here, so a catalog change
// never makes it wrong.
const FILM_SUMMARY =
  'A fifteen-second animation with no sound. A Generate button shows its price in credits, and the price changes as a different model is picked. '
  + 'Pressing it starts a job and prints a line on a credit statement. A second job prints its own line. '
  + 'The statement then prints the price list: image, video and audio models on one credit balance.';

export function LandingFilm() {
  return (
    <section aria-labelledby="film-title" className="px-4 sm:px-6 max-w-[1300px] mx-auto pb-16 lg:pb-24">
      <h2 id="film-title" className="sr-only">Veyrnox in fifteen seconds</h2>
      <p className="sr-only">{FILM_SUMMARY}</p>
      <FilmPlayer film={LANDING_FILM} />
    </section>
  );
}
