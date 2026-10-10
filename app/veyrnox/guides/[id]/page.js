import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MarketingNav } from '../../_components/NavBar';
import { Main } from '../../_components/Main';
import { GUIDES, guideById } from '../../_lib/guides';

export function generateStaticParams() {
  return GUIDES.map((g) => ({ id: g.id }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }) {
  const { id } = await params;
  const g = guideById(id);
  if (!g) return { title: 'Guide not found', robots: { index: false } };
  return {
    title: g.title,
    description: g.summary,
    alternates: { canonical: `/guides/${g.id}` },
    openGraph: { title: `${g.title} — Veyrnox.ai`, description: g.summary, url: `/guides/${g.id}` },
  };
}

export default async function GuidePage({ params }) {
  const { id } = await params;
  const g = guideById(id);
  if (!g) notFound();
  return (
    <div className="min-h-dvh">
      <MarketingNav />
      <Main>
      <article className="max-w-[760px] mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-28">
        <Link href="/guides" className="text-[14px] text-vx-fg-muted hover:text-vx-fg underline-offset-4 hover:underline">All guides</Link>
        <h1 className="mt-4 vx-display text-[40px] sm:text-[56px] leading-[0.95]">{g.title}</h1>
        <p className="mt-4 text-lg text-vx-fg-body">{g.summary}</p>
        <ol className="mt-10 space-y-6">
          {g.steps.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span aria-hidden className="shrink-0 font-vx-mono text-[14px] font-bold text-vx-accent pt-1 w-6">{i + 1}</span>
              <div>
                <h2 className="text-lg font-black">{s.title}</h2>
                <p className="mt-1 text-vx-fg-body leading-[1.55]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-3">
          {g.links.map((l, i) => (
            <Link key={l.href} href={l.href}
              className={i === 0 ? 'inline-flex items-center rounded-full bg-vx-accent px-6 py-3 font-bold text-vx-accent-ink hover:bg-vx-accent-hover' : 'self-center font-bold text-vx-fg-body underline underline-offset-4 hover:text-vx-fg'}>
              {l.label}
            </Link>
          ))}
        </div>
      </article>
      </Main>
    </div>
  );
}
