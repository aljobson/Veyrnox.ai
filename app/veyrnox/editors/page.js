import Link from 'next/link';
import { getT } from '../../../lib/i18n/server';
import { MarketingNav } from '../_components/NavBar';
import { FooterForest } from '../_sections/footer';

const DESCRIPTION = 'Trim and assemble video, shape non-destructive audio versions, and turn selected takes into a reviewable Smart Cut in Veyrnox.';

export const metadata = {
  title: 'Video Editor, Audio Editor & Smart Cut',
  description: DESCRIPTION,
  alternates: { canonical: '/editors' },
  openGraph: {
    title: 'Video Editor, Audio Editor & Smart Cut — Veyrnox.ai',
    description: DESCRIPTION,
    url: '/editors',
  },
};

const editorCards = [
  {
    number: '01',
    eyebrow: 'CLIP EDITOR · LIBRARY PREVIEW',
    title: 'Video Editor',
    intro: 'Build a short finished video from media you already own, with the important decisions still visible before the render starts.',
    features: [
      'Trim each clip with exact in and out points.',
      'Reorder or remove clips, then undo and redo your changes.',
      'Add a Library audio track and choose when it begins.',
      'Review the output length and exact credit price before rendering.',
    ],
    note: 'Current Clip Editor boundary: up to 10 clips and 60 seconds of finished video. Caption and slow-motion controls appear only when their previews are enabled.',
    href: '/app/library',
    action: 'Open your Library',
  },
  {
    number: '02',
    eyebrow: 'MUSIC STUDIO · PRIVATE BETA',
    title: 'Audio Editor',
    intro: 'Try a change, keep the source, and save intentional versions instead of flattening every decision into one file.',
    features: [
      'Crop a playable range while keeping the original recoverable.',
      'Render fades, linked speed and pitch, reordered sections, or a bounded remaster as a new WAV version.',
      'Trim, reverse, tune and fade a local clip preview up to 60 seconds.',
      'See source history and preview the result before choosing what to keep.',
    ],
    note: 'Some Music actions depend on the source format and account availability. Local clip previews stay in the current browser tab until you download them.',
    href: '/app/music',
    action: 'Open Veyrnox Music',
  },
  {
    number: '03',
    eyebrow: 'SMART CUT · REVIEW FIRST',
    title: 'Smart Cut',
    intro: 'Turn selected takes into a proposed first cut, inspect every section, and only then apply it to the Clip Editor.',
    features: [
      'Select up to 10 videos directly from your Library.',
      'Choose a pacing direction and add an optional script or private reminder.',
      'Compare the source footage with the proposed cut section by section.',
      'Apply, undo, replace, or fine-tune the plan without losing the original selection.',
    ],
    note: 'The default Smart Cut is a deterministic local preview: it does not claim to detect mistakes, repeated lines, picture quality, or the best performance. Speech-aware pause removal is used only when timed analysis already exists.',
    href: '/app/library#smart-cut',
    action: 'Start a Smart Cut',
  },
];

const workflow = [
  ['01', 'Choose your source', 'Bring selected Library clips into the Video Editor, or open an owned song in Music.'],
  ['02', 'Let the first pass help', 'Use Smart Cut for a reviewable clip plan or make a bounded audio edit without replacing the source.'],
  ['03', 'Review the decisions', 'Compare sections, adjust timing and order, and inspect the exact result boundary.'],
  ['04', 'Confirm the output', 'A paid render starts only after the price is shown and you explicitly confirm it.'],
];

function TimelinePreview() {
  return (
    <div className="rounded-[1.75rem] border border-vx-border bg-vx-panel p-4 shadow-2xl sm:p-6" aria-label="Example editing workflow">
      <div className="flex items-center justify-between gap-3 border-b border-vx-border pb-4">
        <div>
          <p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">FIRST CUT · REVIEW</p>
          <p className="mt-1 text-sm font-extrabold text-vx-fg">Talking-head launch update</p>
        </div>
        <span className="rounded-full border border-vx-border px-3 py-1.5 font-vx-mono text-[10px] font-bold text-vx-fg-muted">00:38</span>
      </div>

      <div className="mt-5 rounded-2xl border border-vx-border bg-vx-base p-3">
        <div className="flex items-center justify-between text-[10px] font-bold text-vx-fg-muted">
          <span>SOURCE TAKES</span><span className="font-vx-mono">01:12</span>
        </div>
        <div className="mt-3 grid grid-cols-[1.2fr_.5fr_1fr_.35fr_.8fr] gap-1" aria-hidden="true">
          <span className="h-12 rounded-lg bg-vx-panel-raised" />
          <span className="h-12 rounded-lg border border-vx-danger/50 bg-vx-danger/10" />
          <span className="h-12 rounded-lg bg-vx-panel-raised" />
          <span className="h-12 rounded-lg border border-vx-danger/50 bg-vx-danger/10" />
          <span className="h-12 rounded-lg bg-vx-panel-raised" />
        </div>
        <div className="mt-2 flex gap-3 font-vx-mono text-[9px] font-bold tracking-wide text-vx-fg-faint">
          <span>TAKE</span><span className="text-vx-danger">PAUSE</span><span>TAKE</span><span className="text-vx-danger">REVIEW</span>
        </div>
      </div>

      <div className="my-3 flex items-center justify-center gap-2 font-vx-mono text-[10px] font-bold text-vx-accent">
        <span aria-hidden="true">↓</span> SMART CUT PLAN <span aria-hidden="true">↓</span>
      </div>

      <div className="rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-3">
        <div className="flex items-center justify-between text-[10px] font-bold text-vx-fg-muted">
          <span>PROPOSED CUT</span><span className="font-vx-mono text-vx-accent">3 SECTIONS</span>
        </div>
        <div className="mt-3 grid grid-cols-[1.2fr_1fr_.8fr] gap-1" aria-hidden="true">
          <span className="h-12 rounded-lg bg-vx-accent/30" />
          <span className="h-12 rounded-lg bg-vx-accent/20" />
          <span className="h-12 rounded-lg bg-vx-accent/35" />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-bold text-vx-fg">You approve every boundary.</span>
          <span className="rounded-full bg-vx-accent px-3 py-1.5 text-[10px] font-extrabold text-vx-accent-ink">APPLY TO EDITOR</span>
        </div>
      </div>
    </div>
  );
}

export default async function EditorsPage() {
  const { locale, t } = await getT();
  return (
    <div className="min-h-dvh">
      <MarketingNav />

      <section className="mx-auto grid max-w-[1300px] gap-10 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)] lg:items-center lg:gap-16">
        <div>
          <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] text-vx-accent">VIDEO · AUDIO · SMART CUT</p>
          <h1 className="vx-display vx-title-index mt-4 max-w-[11ch]">Rough media in. A finish you control.</h1>
          <p className="mt-6 max-w-[54ch] text-lg leading-8 text-vx-fg-body sm:text-xl">
            Start with clips or sound you already own. Veyrnox helps with the repetitive first pass, keeps the edit reviewable, and shows the price before a paid render begins.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/app/library#smart-cut" className="vx-press inline-flex min-h-11 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
              Start with Smart Cut <span aria-hidden="true" className="ml-2">→</span>
            </Link>
            <a href="#editor-suite" className="vx-press inline-flex min-h-11 items-center rounded-full border border-vx-border px-5 text-sm font-bold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
              Compare the editors
            </a>
          </div>
          <dl className="mt-9 grid max-w-[42rem] grid-cols-3 gap-px overflow-hidden rounded-2xl border border-vx-border bg-vx-border">
            <div className="bg-vx-panel p-4"><dt className="font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-faint">VIDEO</dt><dd className="mt-1 text-sm font-black">10 clips</dd></div>
            <div className="bg-vx-panel p-4"><dt className="font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-faint">AUDIO</dt><dd className="mt-1 text-sm font-black">New versions</dd></div>
            <div className="bg-vx-panel p-4"><dt className="font-vx-mono text-[9px] font-bold tracking-[0.1em] text-vx-fg-faint">SPEND</dt><dd className="mt-1 text-sm font-black">Confirm first</dd></div>
          </dl>
        </div>
        <TimelinePreview />
      </section>

      <section id="editor-suite" aria-labelledby="editor-suite-heading" className="scroll-mt-24 border-y border-vx-border bg-vx-panel/45">
        <div className="mx-auto max-w-[1300px] px-4 py-16 sm:px-6 sm:py-20">
          <div className="max-w-3xl">
            <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] text-vx-accent">THE EDITING SUITE</p>
            <h2 id="editor-suite-heading" className="vx-display mt-3 text-[42px] leading-none sm:text-[60px]">Three ways to lose the busywork.</h2>
            <p className="mt-5 max-w-[60ch] text-base leading-7 text-vx-fg-body">Each editor has a deliberately different job: assemble the picture, shape the sound, or prepare the first cut for a human decision.</p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {editorCards.map((editor) => (
              <article key={editor.title} className="flex min-h-full flex-col rounded-2xl border border-vx-border bg-vx-panel p-6 sm:p-7">
                <div className="flex items-start justify-between gap-4">
                  <p className="font-vx-mono text-[10px] font-bold tracking-[0.12em] text-vx-accent">{editor.eyebrow}</p>
                  <span className="font-vx-mono text-xl font-black text-vx-border-boost">{editor.number}</span>
                </div>
                <h3 className="mt-5 text-3xl font-black tracking-[-0.03em]">{editor.title}</h3>
                <p className="mt-3 text-sm leading-6 text-vx-fg-body">{editor.intro}</p>
                <ul className="mt-6 grid gap-3 border-t border-vx-border pt-5 text-sm leading-6 text-vx-fg-muted">
                  {editor.features.map((feature) => <li key={feature} className="flex gap-3"><span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vx-accent" /><span>{feature}</span></li>)}
                </ul>
                <p className="mt-6 rounded-2xl bg-vx-base p-4 text-xs leading-5 text-vx-fg-muted"><strong className="text-vx-fg-body">Current boundary. </strong>{editor.note}</p>
                <Link href={editor.href} className="vx-press mt-6 inline-flex min-h-11 items-center justify-between rounded-full border border-vx-border px-4 text-sm font-extrabold text-vx-fg hover:border-vx-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">
                  {editor.action} <span aria-hidden="true">→</span>
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="workflow-heading" className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid gap-10 lg:grid-cols-[.75fr_1.25fr] lg:gap-16">
          <div>
            <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] text-vx-accent">ONE REVIEWABLE FLOW</p>
            <h2 id="workflow-heading" className="vx-display mt-3 text-[42px] leading-none sm:text-[56px]">Fast first pass. Deliberate finish.</h2>
            <p className="mt-5 text-base leading-7 text-vx-fg-body">Automation is most useful when it removes repetitive setup without hiding what changed. That is the contract across all three editors.</p>
          </div>
          <ol className="divide-y divide-vx-border border-y border-vx-border">
            {workflow.map(([number, title, body]) => (
              <li key={number} className="grid gap-2 py-5 sm:grid-cols-[3rem_12rem_1fr] sm:items-start sm:gap-4">
                <span className="font-vx-mono text-sm font-black text-vx-accent">{number}</span>
                <strong className="text-base text-vx-fg">{title}</strong>
                <span className="text-sm leading-6 text-vx-fg-muted">{body}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section aria-labelledby="editor-principles-heading" className="border-t border-vx-border bg-vx-panel">
        <div className="mx-auto max-w-[1100px] px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr] lg:gap-16">
            <div>
              <p className="font-vx-mono text-[11px] font-bold tracking-[0.16em] text-vx-accent">WHAT STAYS TRUE</p>
              <h2 id="editor-principles-heading" className="mt-3 text-3xl font-black tracking-[-0.03em]">The editor should explain itself.</h2>
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-vx-border bg-vx-base p-5"><dt className="font-bold text-vx-fg">Your source stays recoverable</dt><dd className="mt-2 text-sm leading-6 text-vx-fg-muted">Smart Cut keeps an undo point, and Music creates linked versions instead of silently replacing the original.</dd></div>
              <div className="rounded-2xl border border-vx-border bg-vx-base p-5"><dt className="font-bold text-vx-fg">A preview is labelled as a preview</dt><dd className="mt-2 text-sm leading-6 text-vx-fg-muted">Local and feature-gated tools say what they do not analyse, save, upload, or promise.</dd></div>
              <div className="rounded-2xl border border-vx-border bg-vx-base p-5"><dt className="font-bold text-vx-fg">You can inspect the cut</dt><dd className="mt-2 text-sm leading-6 text-vx-fg-muted">Source windows, section timing, order, output duration, and review warnings stay visible before applying or rendering.</dd></div>
              <div className="rounded-2xl border border-vx-border bg-vx-base p-5"><dt className="font-bold text-vx-fg">You confirm paid work</dt><dd className="mt-2 text-sm leading-6 text-vx-fg-muted">Veyrnox shows the exact credit price and asks for confirmation before a paid render or provider request begins.</dd></div>
            </dl>
          </div>

          <div className="mt-12 flex flex-col items-start justify-between gap-5 rounded-2xl border border-vx-accent/40 bg-vx-accent/[0.06] p-6 sm:flex-row sm:items-center sm:p-8">
            <div><p className="font-vx-mono text-[10px] font-bold tracking-[0.14em] text-vx-accent">READY WHEN THE FOOTAGE IS</p><p className="mt-2 text-xl font-black">Select the clips. Review the plan. Keep the final say.</p></div>
            <Link href="/app/library#smart-cut" className="vx-press inline-flex min-h-11 shrink-0 items-center rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vx-accent">Open Smart Cut <span aria-hidden="true" className="ml-2">→</span></Link>
          </div>
        </div>
      </section>
      <FooterForest locale={locale} t={t} flush />
    </div>
  );
}
