import { notFound } from 'next/navigation';
import { Main } from '../../veyrnox/_components/Main';
import { socialSmartLinksEnabled } from '../../../lib/social/publishFeature.js';
import { envConfig, rpc } from '../../../packages/db/supabase-client.js';

export const dynamic = 'force-dynamic';

async function read(slug, countView = false) {
  if (!socialSmartLinksEnabled()) return null;
  const cfg = envConfig(); if (!cfg.supabaseUrl || !cfg.serviceRoleKey) return null;
  const result = await rpc('read_social_smartlink_public', { p_slug: slug }, cfg);
  if (!result?.ok) return null;
  if (countView) await rpc('record_social_smartlink_view', { p_slug: slug }, cfg).catch(() => null);
  return result;
}

export async function generateMetadata({ params }) {
  const { slug } = await params; const result = await read(slug);
  return result ? { title: `${result.smartlink.title} — Veyrnox`, description: result.smartlink.bio || 'Links from Veyrnox Publish' } : { title: 'Link not found — Veyrnox' };
}

export default async function SmartLinkPage({ params }) {
  const { slug } = await params; const result = await read(slug, true); if (!result) notFound();
  const link = result.smartlink;
  const themes = { midnight: 'bg-[#080b14] text-white', light: 'bg-[#f5f5f2] text-[#171717]', sunset: 'bg-gradient-to-br from-[#35133d] via-[#9d3155] to-[#f49b55] text-white' };
  return <Main className={`min-h-screen px-5 py-14 ${themes[link.theme] || themes.midnight}`}>
    <div className="mx-auto max-w-xl text-center">
      {link.avatar_url ? <img src={link.avatar_url} alt="" className="mx-auto mb-5 h-24 w-24 rounded-full border-2 border-current/20 object-cover" /> : <div aria-hidden="true" className="mx-auto mb-5 grid h-24 w-24 place-items-center rounded-full bg-current/10 text-3xl font-black">{link.title.slice(0,1)}</div>}
      <h1 className="text-3xl font-black">{link.title}</h1>
      {link.bio && <p className="mx-auto mt-3 max-w-md opacity-75">{link.bio}</p>}
      <nav aria-label={`${link.title} links`} className="mt-8 grid gap-3">
        {result.items.map((item) => <a key={item.id} href={`/s/${encodeURIComponent(slug)}/go/${item.id}`} rel="nofollow" className="rounded-2xl border border-current/20 bg-current/10 px-5 py-4 font-bold backdrop-blur transition hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-offset-2">{item.label}</a>)}
      </nav>
      <a href="https://veyrnox.ai" className="mt-10 inline-block text-xs font-bold uppercase tracking-[0.2em] opacity-60">Made with Veyrnox</a>
    </div>
  </Main>;
}
