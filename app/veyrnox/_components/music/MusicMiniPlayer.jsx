'use client';

import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { MusicPrivateAudio } from '../../_lib/useMusicAudioSrc';
import { idlePlayer, playerReducer } from '../../_lib/music/miniPlayer.mjs';

const PlayerContext = createContext(null);

/** The mini player controls, or null outside Music (a page rendered alone then shows no player button). */
export function useMusicPlayer() {
  return useContext(PlayerContext);
}

/**
 * Holds the one song that keeps playing across Music pages and draws its bar. It lives in the Music
 * layout, so moving between Music pages does not interrupt it. Pages that reload fully, such as Beats,
 * start fresh.
 */
export function MusicPlayerProvider({ children }) {
  const { t } = useI18n();
  const [state, dispatch] = useReducer(playerReducer, idlePlayer);
  const audio = useRef(null);
  const api = useMemo(() => ({
    track: state.track,
    playing: state.playing,
    play: (track) => dispatch({ type: 'play', track }),
    close: () => dispatch({ type: 'close' }),
  }), [state.track, state.playing]);

  // A new track starts as soon as its signed address is ready; the browser may still refuse autoplay.
  const trackId = state.track?.id;
  useEffect(() => {
    if (!trackId) return undefined;
    const element = audio.current;
    const start = () => { element?.play?.().catch(() => dispatch({ type: 'playing', value: false })); };
    element?.addEventListener('canplay', start, { once: true });
    return () => element?.removeEventListener('canplay', start);
  }, [trackId]);

  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) element.play().catch(() => dispatch({ type: 'playing', value: false }));
    else element.pause();
  }

  return (
    <PlayerContext.Provider value={api}>
      {children}
      {state.track ? <div aria-hidden="true" className="h-20" /> : null}
      {state.track ? (
        <section role="region" aria-label={t('app.music.beat.shell.playerLabel')} data-testid="music-mini-player"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-vx-border bg-vx-panel/95 px-4 py-2 backdrop-blur pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-7xl items-center gap-3">
            <button type="button" onClick={toggle} aria-pressed={state.playing}
              className="vx-press min-h-11 shrink-0 rounded-full bg-vx-accent px-5 text-sm font-extrabold text-vx-accent-ink">
              {state.playing ? t('app.music.beat.shell.playerPause') : t('app.music.beat.shell.playerPlay')}
            </button>
            <p className="min-w-0 flex-1 truncate text-sm font-bold text-vx-fg" aria-live="polite">
              {t('app.music.beat.shell.playerNow', { title: state.track.title })}
            </p>
            <MusicPrivateAudio key={state.track.id} ref={audio} src={state.track.audioUrl} preload="auto" controls
              aria-label={state.track.title} className="hidden h-10 w-64 shrink-0 md:block"
              onPlay={() => dispatch({ type: 'playing', value: true })} onPause={() => dispatch({ type: 'playing', value: false })}
              onEnded={() => dispatch({ type: 'playing', value: false })} />
            <button type="button" onClick={api.close}
              className="vx-press min-h-11 shrink-0 rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-muted hover:text-vx-fg">
              {t('app.music.beat.shell.playerClose')}
            </button>
          </div>
        </section>
      ) : null}
    </PlayerContext.Provider>
  );
}

/** A button that moves a song into the mini player so it keeps playing while the person browses. */
export function PlayInBarButton({ song, className = '' }) {
  const { t } = useI18n();
  const player = useMusicPlayer();
  if (!player || !song?.audio_url) return null;
  const current = player.track?.id === song.id;
  return (
    <button type="button" aria-pressed={current && player.playing} onClick={() => player.play({ id: song.id, title: song.title, audioUrl: song.audio_url })}
      className={`vx-press min-h-10 rounded-full border border-vx-border px-4 text-sm font-bold text-vx-fg-body hover:border-vx-accent ${className}`}>
      {t('app.music.beat.shell.playerKeep')}
    </button>
  );
}
