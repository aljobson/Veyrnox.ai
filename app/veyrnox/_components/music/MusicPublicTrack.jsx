'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';
import { MusicSocialBar } from './MusicSocialBar';
import { MusicTrackRails } from './MusicTrackRails';

export function MusicPublicTrack({ slug }) {
  const { t } = useI18n();
  const [track, setTrack] = useState(null); const [social, setSocial] = useState(null); const [rails, setRails] = useState(null); const [failed, setFailed] = useState(false);
  useEffect(() => { let live = true; fetch(`/api/music/public/${slug}`, { cache: 'no-store' }).then((r) => r.ok ? r.json() : Promise.reject()).then((r) => { if (live) { setTrack(r.track); setSocial(r.social || null); setRails(r.rails || null); } }).catch(() => { if (live) setFailed(true); }); return () => { live = false; }; }, [slug]);
  if (!track && !failed) return <div className="mx-auto max-w-3xl px-4 py-16" aria-busy="true"><div className="vx-shimmer h-96 rounded-2xl bg-vx-panel" /></div>;
  if (!track) return <div className="mx-auto max-w-3xl px-4 py-16"><section role="alert" className="rounded-2xl border border-vx-border bg-vx-panel p-8"><h1 className="font-vx text-3xl font-black">{t('music.track.unavailable')}</h1><p className="mt-3 text-vx-fg-muted">{t('music.track.unavailableHelp')}</p></section></div>;
  return <div className="mx-auto max-w-3xl px-4 py-12"><article className="overflow-hidden rounded-2xl border border-vx-border bg-vx-panel shadow-2xl"><div className="grid min-h-72 place-items-center bg-vx-panel-raised"><span aria-hidden="true" className="font-vx text-8xl font-black text-vx-accent">♪</span></div><div className="p-6 sm:p-8"><p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">{t('music.track.eyebrow')}</p><h1 className="mt-3 break-words font-vx text-4xl font-black">{track.title}</h1><p className="mt-2 text-sm text-vx-fg-muted">{t('music.track.version')} {track.version_number} {t('music.track.by')} <Link className="font-bold underline" href={`/music/creators/${track.handle}`}>{track.display_name}</Link></p><MusicPrivateAudio controls preload="metadata" src={track.audio_url} className="mt-6 w-full" aria-label={`${t('music.track.play')} ${track.title}`} /><MusicSocialBar slug={slug} handle={track.handle} social={social} /><MusicTrackRails track={{ slug, title: track.title, display_name: track.display_name }} rails={rails} /><div className="mt-6 grid gap-2 text-xs text-vx-fg-muted sm:grid-cols-2"><p>{t('music.track.comments')} {t(track.allow_comments ? 'music.track.allowed' : 'music.track.disabled')}</p><p>{t('music.track.remixes')} {t(track.allow_remixes ? 'music.track.allowed' : 'music.track.disabled')}</p></div><p className="mt-4 text-xs leading-5 text-vx-fg-faint">{t(track.commercial_status === 'plan_eligible_terms_apply' ? 'music.track.commercial' : 'music.track.personalEntitlement')}</p></div></article></div>;
}
