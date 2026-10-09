import Link from 'next/link';
import { FilmPlayer } from '../_components/FilmPlayer';
import { BREAKTHROUGH_FILM, LANDING_FILM } from '../_lib/film';

export function BreakthroughVideo() {
  return (
    <section id="breakthrough" aria-labelledby="breakthrough-title" className="scroll-mt-20 px-4 sm:px-6 max-w-[1300px] mx-auto pb-16 lg:pb-24">
      <div className="grid gap-8 lg:grid-cols-[1fr_420px] lg:gap-16 items-center rounded-3xl border border-vx-border bg-vx-panel p-6 sm:p-10">
        <div>
          <p className="text-xs font-bold tracking-wide text-vx-fg-muted">Viral inspiration · 5 seconds</p>
          <h2 id="breakthrough-title" className="vx-display mt-4 text-[36px] sm:text-[48px] lg:text-[64px] text-balance">Break through the scroll.</h2>
          <p className="mt-5 max-w-[38ch] text-lg text-vx-fg-body leading-relaxed">A hero leans out of the frame to offer you a coffee. Watch the breakout, then find inspiration for your next video.</p>
          <p className="sr-only">A silent five-second clip of a blond LEGO-style superhero leaning forward to offer a Veyrnox.ai coffee cup out of a social-media post, over its controls and into the foreground.</p>
          <Link href="/models" className="mt-7 inline-flex min-h-11 items-center text-[15px] font-bold text-vx-fg underline underline-offset-4 hover:text-vx-accent">Explore video models</Link>
        </div>
        <div className="w-full max-w-[420px] mx-auto">
          <FilmPlayer film={BREAKTHROUGH_FILM} label="the breakthrough video" aspectRatio="720 / 894" />
        </div>
      </div>
    </section>
  );
}

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
