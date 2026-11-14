'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { getStoredUserId } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';
import { MUSIC_REACTIONS, MUSIC_REACTION_EMOJI } from '../../../../lib/musicReactions.js';

const key = (kind) => `${kind}.${crypto.randomUUID()}`;

/**
 * Reactions for a public track and a Follow button for its creator (0515).
 * `social` is the anonymous counts from the public route; it is absent when the
 * feature is off, and then nothing renders. Signed-in viewers also see their own
 * reaction and follow state.
 * @param {{ slug?: string, handle: string, social?: { reactions?: Record<string, number>, follower_count?: number } | null, showReactions?: boolean }} props
 */
export function MusicSocialBar({ slug, handle, social, showReactions = true }) {
  const { t } = useI18n();
  const [state, setState] = useState(social || null);
  const [mine, setMine] = useState({ my_reaction: null, following: false, is_own: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signedIn = Boolean(getStoredUserId());

  useEffect(() => {
    if (!social || !signedIn) return undefined;
    let live = true;
    const query = slug ? `slug=${encodeURIComponent(slug)}` : `handle=${encodeURIComponent(handle)}`;
    gatewayFetch(`/music/social?${query}`).then((r) => { if (live && r?.social) { setState(r.social); setMine(r.social); } }).catch(() => {});
    return () => { live = false; };
  }, [social, signedIn, slug, handle]);

  if (!state) return null;

  async function send(body) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await gatewayFetch('/music/social', { method: 'POST', body: JSON.stringify(body) });
      if (r?.social) { setState(r.social); setMine(r.social); }
    } catch (e) {
      setError(e?.status === 429 ? t('music.social.slowDown') : t('music.social.failed'));
    } finally {
      setBusy(false);
    }
  }

  const react = (reaction) => send({ slug, reaction: mine.my_reaction === reaction ? null : reaction, idempotency_key: key('react') });
  const follow = () => send({ handle, following: !mine.following, idempotency_key: key('follow') });
  const followers = Number(state.follower_count) || 0;

  return (
    <section aria-label={t('music.social.label')} className="mt-6 space-y-4">
      {showReactions && slug ? (
        <div role="group" aria-label={t('music.social.reactions')} className="flex flex-wrap gap-2">
          {MUSIC_REACTIONS.map((reaction) => {
            const count = Number(state.reactions?.[reaction]) || 0;
            const pressed = mine.my_reaction === reaction;
            return (
              <button key={reaction} type="button" disabled={!signedIn || busy} aria-pressed={pressed}
                aria-label={t('music.social.react', { reaction, count })} onClick={() => react(reaction)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${pressed ? 'border-vx-accent bg-vx-accent/15 text-vx-fg' : 'border-vx-border bg-vx-base text-vx-fg-body hover:border-vx-accent'}`}>
                <span aria-hidden="true" className="text-lg">{MUSIC_REACTION_EMOJI[reaction]}</span>
                <span className="font-vx-mono text-xs">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {!mine.is_own ? (
          <button type="button" disabled={!signedIn || busy} aria-pressed={mine.following} onClick={follow}
            className={`min-h-11 rounded-full px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60 ${mine.following ? 'border border-vx-border bg-vx-base text-vx-fg' : 'bg-vx-accent text-vx-accent-ink'}`}>
            {mine.following ? t('music.social.following') : t('music.social.follow')}
          </button>
        ) : null}
        <span className="text-sm text-vx-fg-muted">{t('music.social.followers', { count: followers })}</span>
        {!signedIn ? <Link href="/app/music/library" className="text-sm font-bold text-vx-accent underline-offset-4 hover:underline">{t('music.social.signIn')}</Link> : null}
      </div>
      {error ? <p role="alert" className="text-sm text-vx-danger">{error}</p> : null}
    </section>
  );
}
