import Link from 'next/link';
import { MarketingNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { CinemaPoster } from '../../CinemaPoster';
import { editorialSeriesBySlug } from '../../editorialSeries';

const duration = (seconds) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
};

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const series = editorialSeriesBySlug(slug);
  return series ? {
    title: series.title,
    description: series.description,
    alternates: { canonical: `/social-cinema/series/${series.slug}` },
  } : { title: 'Series not found', robots: { index: false } };
}

export default async function Page({ params }) {
  const { slug } = await params;
  const series = editorialSeriesBySlug(slug);
  if (!series) return <><MarketingNav /><Main><div className="mx-auto max-w-[1300px] px-4 py-16 sm:px-6"><p>This series is not available.</p><Link href="/social-cinema" className="mt-6 inline-block underline">Back to Social Cinema</Link></div></Main></>;

  return <><MarketingNav /><Main><div className="mx-auto max-w-[1300px] px-4 py-10 pb-40 sm:px-6 sm:py-16 sm:pb-32"><div className="max-w-[1052px]">
    <p className="mb-4 font-vx-mono text-xs tracking-widest text-vx-accent">SOCIAL CINEMA · SERIES</p>
    <CinemaPoster id={series.posterId || series.slug} src={series.posterUrl} title={series.title} eager sizes="(min-width: 1024px) 1052px, 100vw" className="mb-8" />
    <h1 className="vx-display vx-title-detail wrap-break-word">{series.title}</h1>
    <p className="mt-3 font-vx-mono text-xs tracking-widest text-vx-accent uppercase">Season {series.season}: {series.seasonTitle} · {series.episodes.length} episodes</p>
    <p className="mt-6 max-w-2xl leading-relaxed text-vx-fg-body">{series.description}</p>
    {series.creator && <p className="mt-3 text-sm text-vx-fg-muted">By <a href={series.creator.url} target="_blank" rel="noreferrer" className="underline">{series.creator.name}</a> · Streamed free with the official {series.source.name} player</p>}
    <Link href={`/social-cinema/watch/${series.episodes[0].id}?series=${series.slug}`} className="mt-7 inline-flex rounded-full bg-vx-accent px-5 py-3 text-sm font-bold text-vx-accent-ink">Play episode 1</Link>

    <section className="mt-12" aria-labelledby="episodes-title">
      <h2 id="episodes-title" className="text-2xl font-extrabold">Episodes</h2>
      <ol className="mt-5 grid gap-5 sm:grid-cols-2">
        {series.episodes.map((episode) => <li key={episode.id} className="flex flex-col overflow-hidden rounded-2xl border border-vx-border bg-vx-base/60">
          <CinemaPoster id={episode.id} src={episode.posterUrl || series.posterUrl} title={episode.title} href={`/social-cinema/watch/${episode.id}?series=${series.slug}`} />
          <div className="flex flex-1 flex-col p-5">
            <p className="font-vx-mono text-xs tracking-widest text-vx-accent uppercase">Episode {episode.position} · {duration(episode.durationSeconds)} · Free</p>
            <h3 className="mt-2 text-xl font-bold wrap-break-word">{episode.title}</h3>
            {episode.description && <p className="mt-3 text-sm text-vx-fg-body">{episode.description}</p>}
            <Link href={`/social-cinema/watch/${episode.id}?series=${series.slug}`} className="mt-5 inline-flex self-start rounded-full bg-vx-accent px-4 py-2 text-sm font-bold text-vx-accent-ink">Watch episode {episode.position}</Link>
          </div>
        </li>)}
      </ol>
    </section>
    <p className="mt-10 text-sm"><Link href="/social-cinema" className="underline">Back to Social Cinema</Link></p>
  </div></div></Main></>;
}
