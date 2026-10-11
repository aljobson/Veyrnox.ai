import Link from 'next/link';
import { FilmPlayer } from '../_components/FilmPlayer';
import { BREAKTHROUGH_FILM, LANDING_FILM } from '../_lib/film';

export function BreakthroughVideo() {
  return (
    <section id="breakthrough" aria-labelledby="breakthrough-title" className="scroll-mt-20 pb-16 lg:pb-24">
      <h1 id="breakthrough-title" className="sr-only">Do you feel creative?</h1>
      <p className="sr-only">A silent eight-second video of a realistic white android punching a glass screen twice. The first hit cracks the glass; the second breaks it outward. Its head and shoulders lean through the screen toward the viewer. The android has smooth, flat white chest armor. The question “Do you feel creative?” forms as a large foreground hologram above its glowing fingertip. The Veyrnox.ai logo remains visible.</p>
      <FilmPlayer film={BREAKTHROUGH_FILM} label="the robot video" frameless mobileFullscreen>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-start px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:hidden">
          <Link href="/app/create" className="pointer-events-auto vx-press inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 py-3 text-[15px] font-extrabold text-[#0a0a0b] hover:bg-white/85">Start creating</Link>
        </div>
      </FilmPlayer>
      <div className="mx-auto max-w-[1300px] px-4 sm:px-6 pt-6 hidden sm:flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-[48ch] text-base sm:text-lg text-vx-fg-body leading-relaxed">Turn your ideas into images, video and audio with Veyrnox.ai.</p>
        <Link href="/app/create" className="vx-press inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-vx-fg px-6 py-3 text-[15px] font-extrabold text-vx-base hover:bg-vx-fg/85">Start creating</Link>
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
