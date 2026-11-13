import Link from 'next/link';

// Image, video and audio templates are different things (a still, a clip, a sound), so the three galleries
// open on a clear switch instead of a text link. All live on /presets: ?kind=image is image, audio opens Music Discover (/app/music/discover),
// anything else is video. Server component: plain links, so it works before hydration.
const KINDS = [
  { id: 'image', href: '/presets?kind=image' },
  { id: 'video', href: '/presets' },
  { id: 'audio', href: '/app/music/discover' },
];

export function TemplateKindSwitch({ t, kind }) {
  return (
    <nav aria-label={t('templates.kind.label')} className="mb-8 inline-flex rounded-full border border-vx-border p-1">
      {KINDS.map((k) => (
        <Link key={k.id} href={k.href} aria-current={k.id === kind ? 'page' : undefined}
          className="vx-press inline-flex min-h-11 items-center rounded-full px-6 text-[15px] font-bold text-vx-fg-body hover:text-vx-fg aria-[current=page]:bg-vx-accent aria-[current=page]:text-vx-accent-ink">
          {t(`templates.kind.${k.id}`)}
        </Link>
      ))}
    </nav>
  );
}
