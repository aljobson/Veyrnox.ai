import Link from 'next/link';
import { getT } from '../../../../../lib/i18n/server';

export async function generateMetadata() { const { t } = await getT(); return { title: t('music.meta.studio') }; }

export default function MusicStudioHubPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Local session workspace</p>
      <h1 className="mt-3 font-vx text-4xl font-black tracking-tight sm:text-5xl">Studio</h1>
      <p className="mt-4 max-w-2xl leading-7 text-vx-fg-body">Open an owned song from its More Actions menu to inspect versions and audition one audio track with local transport and project-grid guides.</p>
      <section className="mt-8 rounded-2xl border border-vx-border bg-vx-panel p-6">
        <h2 className="font-vx text-2xl font-black">No durable Studio projects yet</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-vx-fg-muted">This first slice does not save arrangements, record audio or MIDI, host effects, automate parameters, stretch clips, or export a new mix. Session controls disappear when the page closes.</p>
        <Link href="/app/music/library" className="mt-5 inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 font-bold text-vx-accent-ink">Choose an owned song</Link>
      </section>
    </div>
  );
}
