'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppNav } from '../NavBar';
import { Main } from '../Main';
import { MUSIC_PREVIEW_FLAG } from '../../_lib/music/previewStore';
import { useI18n } from '../../../../components/I18nProvider';
import { BrandName } from '../BrandName';
import { MusicPlayerProvider } from './MusicMiniPlayer';

const LINKS = [
  { href: '/app/music/create', label: 'Create', key: 'create' },
  { href: '/app/music/discover', label: 'Discover', key: 'discover', discover: true },
  { href: '/app/music/instruments', label: 'Instruments', key: 'instruments', discover: true },
  { href: '/app/music/library', label: 'Music Library', key: 'library' },
  { href: '/app/music/playlists', label: 'Playlists', key: 'playlists' },
  { href: '/app/music/albums', label: 'Albums', key: 'albums' },
  { href: '/app/music/beats', label: 'Beats', key: 'beats', beats: true },
  { href: '/app/music/labs', label: 'Labs', key: 'labs', labs: true },
  { href: '/app/music/studio', label: 'Studio', key: 'studio', studio: true },
];

const previewEvent = 'veyrnox:music-preview-gate';
const previewEnabled = () => {
  try { return process.env.NODE_ENV === 'development' && localStorage.getItem(MUSIC_PREVIEW_FLAG) === '1'; }
  catch { return false; }
};
const subscribePreview = (onChange) => {
  window.addEventListener('storage', onChange);
  window.addEventListener(previewEvent, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(previewEvent, onChange);
  };
};

export function MusicPreviewShell({ children, initialEnabled = false, serverMode = false, libraryMode = false, playlistsMode = false, albumsMode = false, studioMode = false, beatsMode = false, labsMode = false }) {
  const pathname = usePathname().replace(/^\/veyrnox/, '');
  const { t } = useI18n();
  const shell = (key) => t(`app.music.beat.shell.${key}`);
  const [enabled, setEnabled] = useState(initialEnabled);

  useEffect(() => {
    if (serverMode) return undefined;
    return subscribePreview(() => setEnabled(previewEnabled()));
  }, [serverMode]);

  function enable() {
    try {
      localStorage.setItem(MUSIC_PREVIEW_FLAG, '1');
      document.cookie = `${MUSIC_PREVIEW_FLAG}=1; Path=/; Max-Age=86400; SameSite=Lax`;
      window.dispatchEvent(new Event(previewEvent));
    } catch {}
  }

  return (
    <MusicPlayerProvider>
    <div className="min-h-screen bg-vx-base text-vx-fg">
      <AppNav active="music" readAccount={false} />
      {!(serverMode || enabled) ? (
        <Main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <section className="rounded-2xl border border-vx-border bg-vx-panel p-8 shadow-2xl">
            <p className="font-vx-mono text-xs font-bold uppercase tracking-widest text-vx-accent">Development preview</p>
            <h1 className="mt-3 font-vx text-4xl font-black tracking-tight">Music Studio is closed here.</h1>
            <p className="mt-4 max-w-2xl leading-7 text-vx-fg-body">
              This vertical slice uses browser-only mock credits and synthetic preview tones. It cannot spend real credits or contact a music provider.
            </p>
            {process.env.NODE_ENV === 'development' ? (
              <button type="button" onClick={enable} className="vx-press mt-6 min-h-12 rounded-full bg-vx-accent px-6 font-extrabold text-vx-accent-ink hover:bg-vx-accent-hover">
                Enable local Music preview
              </button>
            ) : (
              <Link href="/app" className="mt-6 inline-flex min-h-12 items-center rounded-full border border-vx-border px-6 font-bold text-vx-fg-body hover:border-vx-accent hover:text-vx-fg">
                Back to Explore
              </Link>
            )}
          </section>
        </Main>
      ) : (
        <>
          <div className="border-b border-vx-border bg-vx-panel/80">
            <div className="mx-auto flex max-w-7xl flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <p className="font-vx text-lg font-black tracking-tight"><BrandName>Veyrnox.ai Music</BrandName></p>
                <p className="text-xs text-vx-fg-muted">{shell(libraryMode ? 'subtitleLibrary' : serverMode ? 'subtitleServer' : 'subtitleLocal')}</p>
              </div>
              <nav aria-label={shell('nav')} className="flex max-w-full overflow-x-auto rounded-full border border-vx-border bg-vx-base p-1 text-sm font-bold">
                {LINKS.filter((link) => {
                  if (link.beats) return beatsMode && !studioMode;
                  if (link.labs) return labsMode;
                  if (link.studio) return studioMode;
                  if (link.discover) return true;
                  if (link.href.endsWith('/playlists')) return playlistsMode;
                  if (link.href.endsWith('/albums')) return albumsMode;
                  return !serverMode || libraryMode || link.href.endsWith('/create');
                }).map((entry) => {
                  const link = entry.studio && beatsMode ? { ...entry, href: '/app/music/beats', label: 'Beats', key: 'beats', beats: true } : entry;
                  const active = pathname === link.href
                    || pathname.startsWith(`${link.href}/`)
                    || (link.key === 'create' && pathname === '/app/music/sounds')
                    || (link.href.includes('library') && pathname.includes('/songs/'));
                  const NavigationLink = (link.beats || link.studio) && !pathname.startsWith('/app/music/beats') ? 'a' : Link;
                  return (
                    <NavigationLink key={link.href} href={link.href} aria-current={active ? 'page' : undefined} className={`vx-press inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-4 py-2 ${active ? 'bg-vx-fg text-vx-base' : 'text-vx-fg-body hover:text-vx-fg'}`}>
                      {shell(link.key)}
                    </NavigationLink>
                  );
                })}
              </nav>
            </div>
          </div>
          <Main>{children}</Main>
        </>
      )}
    </div>
    </MusicPlayerProvider>
  );
}
