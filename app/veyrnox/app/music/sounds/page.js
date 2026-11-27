import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getT } from '../../../../../lib/i18n/server';
import { musicUiEnabled } from '../../../../../lib/musicBackend.js';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.sounds') }; }

export default function MusicSoundsPage() {
  if (!musicUiEnabled()) redirect('/app/music/create');
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Verified reusable audio tools</p>
        <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">Create a sound or seamless loop.</h1>
        <p className="mt-3 max-w-2xl leading-7 text-vx-fg-body">Open an existing Veyrnox.ai text-to-sound model. The destination shows its exact credit price before you confirm and returns failed generations through the normal refund path.</p>
      </header>
      <section aria-label="Text to sound models" className="mt-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-lg">
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Sound effect · about 8 seconds</p>
          <h2 className="mt-3 font-vx text-2xl font-black">Suno Sound Effects</h2>
          <p className="mt-3 leading-6 text-vx-fg-muted">Describe a concrete effect, ambience, transition or interface sound. Enable looping when the result needs to repeat cleanly.</p>
          <Link href="/app/create?model=suno-sounds" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Open sound and loop generator</Link>
        </article>
      </section>
      <section aria-labelledby="sound-loop-status" className="mt-6 rounded-2xl border border-vx-border bg-vx-base p-6">
        <h2 id="sound-loop-status" className="font-vx text-xl font-black">Looping is available on Suno Sound Effects.</h2>
        <p className="mt-2 text-sm leading-6 text-vx-fg-muted">Enable Seamless loop in Settings when the sound needs to repeat. BPM and musical key are prompt directions, not guaranteed structured controls.</p>
      </section>
    </div>
  );
}
