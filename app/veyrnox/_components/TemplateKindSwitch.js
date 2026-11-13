import Link from 'next/link';

// Video and audio templates are different things (a clip vs a sound), so the two galleries
// open on a clear switch instead of a text link. Both live on /presets: ?kind=audio is audio,
// anything else is video. Server component: plain links, so it works before hydration.
const KINDS = [
  { id: 'video', href: '/presets' },
  { id: 'audio', href: '/presets?kind=audio' },
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
