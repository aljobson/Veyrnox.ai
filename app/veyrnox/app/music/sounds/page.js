import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getT } from '../../../../../lib/i18n/server';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.sounds') }; }

export default function MusicSoundsPage() {
  if (process.env.MUSIC_UI_ENABLED !== 'true') redirect('/app/music/create');
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Verified reusable audio tools</p>
        <h1 className="mt-2 font-vx text-4xl font-black tracking-tight sm:text-5xl">Create a sound or seamless loop.</h1>
        <p className="mt-3 max-w-2xl leading-7 text-vx-fg-body">Open an existing Veyrnox text-to-sound model. The destination shows its exact credit price before you confirm and returns failed generations through the normal refund path.</p>
      </header>
      <section aria-label="Text to sound models" className="mt-8 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-lg">
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Focused effect · 10 seconds</p>
          <h2 className="mt-3 font-vx text-2xl font-black">ElevenLabs Sound Effects</h2>
          <p className="mt-3 leading-6 text-vx-fg-muted">Describe one concrete sound event, texture or transition. The admitted capability pins a single 10-second output and can ask the provider to blend its end into its beginning.</p>
          <Link href="/app/create?model=elevenlabs-sfx-v2" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Open sound and loop generator</Link>
        </article>
        <article className="rounded-2xl border border-vx-border bg-vx-panel p-6 shadow-lg">
          <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Soundscape · 8 seconds</p>
          <h2 className="mt-3 font-vx text-2xl font-black">MMAudio</h2>
          <p className="mt-3 leading-6 text-vx-fg-muted">Create a short atmosphere or effect from a written brief. This route is text-only and does not require source video.</p>
          <Link href="/app/create?model=mmaudio-v2" className="mt-6 inline-flex min-h-11 items-center rounded-full border border-vx-border px-5 font-bold text-vx-fg-body">Open soundscape generator</Link>
        </article>
      </section>
      <section aria-labelledby="sound-loop-status" className="mt-6 rounded-2xl border border-vx-border bg-vx-base p-6">
        <h2 id="sound-loop-status" className="font-vx text-xl font-black">Looping is available on ElevenLabs Sound Effects.</h2>
        <p className="mt-2 text-sm leading-6 text-vx-fg-muted">Enable Seamless loop in that model&apos;s Settings to request an ending blended into the beginning. MMAudio remains one-shot. BPM and musical key are prompt directions, not guaranteed structured controls.</p>
      </section>
    </div>
  );
}
