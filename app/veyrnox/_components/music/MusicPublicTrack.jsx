'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

export function MusicPublicTrack({ slug }) {
  const [track, setTrack] = useState(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; fetch(`/api/v1/music/public/${slug}`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : Promise.reject()).then((r) => { if (live) setTrack(r.track); }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, [slug]);
  if (!track && !failed) return <div className="mx-auto max-w-3xl px-4 py-16" aria-busy="true"><div className="vx-shimmer h-96 rounded-3xl bg-vx-panel" /></div>;
  if (!track) return <div className="mx-auto max-w-3xl px-4 py-16"><section role="alert" className="rounded-3xl border border-vx-border bg-vx-panel p-8"><h1 className="font-vx text-3xl font-black">This public track is unavailable.</h1><p className="mt-3 text-vx-fg-muted">It may have been unpublished or blocked.</p></section></div>;
  return <div className="mx-auto max-w-3xl px-4 py-12"><article className="overflow-hidden rounded-3xl border border-vx-border bg-vx-panel shadow-2xl"><div className="grid min-h-72 place-items-center bg-vx-panel-raised"><span aria-hidden="true" className="font-vx text-8xl font-black text-vx-accent">♪</span></div><div className="p-6 sm:p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Public Music track</p><h1 className="mt-3 break-words font-vx text-4xl font-black">{track.title}</h1><p className="mt-2 text-sm text-vx-fg-muted">Version {track.version_number} · by <Link className="font-bold underline" href={`/music/creators/${track.handle}`}>{track.display_name}</Link></p><audio controls preload="metadata" src={track.audio_url} className="mt-6 w-full" aria-label={`Play ${track.title}`} /><div className="mt-6 grid gap-2 text-xs text-vx-fg-muted sm:grid-cols-2"><p>Comments {track.allow_comments ? 'allowed' : 'disabled'}</p><p>Remixes {track.allow_remixes ? 'allowed' : 'disabled'}</p></div><p className="mt-4 text-xs leading-5 text-vx-fg-faint">{track.commercial_status === 'plan_eligible_terms_apply' ? 'Creator plan eligible for commercial use; applicable terms and third-party rights still apply.' : 'Personal-use entitlement. Public listening does not grant reuse rights.'}</p></div></article></div>;
}
