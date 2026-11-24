'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { MusicSocialBar } from './MusicSocialBar';
import { gatewayFetch } from '../../_lib/gateway';
import { getSession } from '../../../lib/authClient';

export function MusicPublicProfile({ handle }) {
  const { t } = useI18n();
  const [data, setData] = useState(null); const [blocked, setBlocked] = useState(false); const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; const anonymous = () => fetch(`/api/music/profiles/${handle}`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : Promise.reject());
    const read = getSession()?.access_token
      ? gatewayFetch(`/music/explore/creators/${handle}`, { promptOnAuth: false }).catch((error) => error?.code === 'blocks_unavailable' ? anonymous() : Promise.reject(error))
      : anonymous();
    read.then((r) => { if (!live) return; if (r.blocked) setBlocked(true); else setData(r); }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, [handle]);
  if (blocked) return <div className="mx-auto max-w-3xl px-4 py-16"><section role="status" className="rounded-2xl border border-vx-border bg-vx-panel p-8"><h1 className="font-vx text-3xl font-black">{t('music.album.creatorBlocked')}</h1><p className="mt-3 text-vx-fg-body">{t('music.album.creatorBlockedHelp')}</p></section></div>;
  if (!data && !failed) return <div className="mx-auto max-w-4xl px-4 py-16" aria-busy="true"><div className="vx-shimmer h-80 rounded-2xl bg-vx-panel" /></div>;
  if (!data) return <div className="mx-auto max-w-3xl px-4 py-16"><section role="alert" className="rounded-2xl border border-vx-border bg-vx-panel p-8"><h1 className="font-vx text-3xl font-black">{t('music.profile.unavailable')}</h1></section></div>;
  return <div className="mx-auto max-w-4xl px-4 py-12"><header className="rounded-2xl border border-vx-border bg-vx-panel p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('music.profile.eyebrow')}</p><h1 className="mt-3 font-vx text-4xl font-black">{data.profile.display_name}</h1><p className="mt-2 text-vx-fg-muted">@{data.profile.handle}</p><MusicSocialBar handle={handle} social={data.social || null} showReactions={false} /></header>{data.albums?.length ? <section aria-labelledby="albums-title" className="mt-8"><h2 id="albums-title" className="font-vx text-2xl font-black">{t('music.album.albums')}</h2><ul className="mt-4 grid gap-3 sm:grid-cols-2">{data.albums.map(album=><li key={album.slug}><Link href={`/music/albums/${album.slug}`} className="flex min-h-28 gap-4 rounded-2xl border border-vx-border bg-vx-panel p-5 hover:border-vx-accent">{album.artwork_url?<img src={album.artwork_url} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover"/>:null}<span><strong className="block font-vx text-lg">{album.title}</strong><span className="mt-3 block text-xs text-vx-fg-muted">{t('music.album.trackCount',{count:album.tracks.length})}</span></span></Link></li>)}</ul></section>:null}<section aria-labelledby="tracks-title" className="mt-8"><h2 id="tracks-title" className="font-vx text-2xl font-black">{t('music.profile.published')}</h2>{data.tracks.length ? <ul className="mt-4 grid gap-3 sm:grid-cols-2">{data.tracks.map((track) => <li key={track.slug}><Link href={`/music/tracks/${track.slug}`} className="block min-h-28 rounded-2xl border border-vx-border bg-vx-panel p-5 hover:border-vx-accent"><strong className="block break-words font-vx text-lg">{track.title}</strong><span className="mt-3 block text-xs text-vx-fg-muted">{t(track.commercial_status === 'plan_eligible_terms_apply' ? 'music.profile.planEligible' : 'music.profile.personal')}</span></Link></li>)}</ul> : <p className="mt-4 text-vx-fg-muted">{t('music.profile.empty')}</p>}</section></div>;
}
