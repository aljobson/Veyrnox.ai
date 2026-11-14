'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../components/I18nProvider';
import { getStoredUserId } from '../../../lib/authClient';
import { gatewayFetch } from '../../_lib/gateway';
import { MUSIC_COMMENT_MAX, MUSIC_COMMENT_REPORT_CATEGORIES } from '../../../../lib/musicComments.js';

const time = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const newKey = (kind) => `${kind}.${crypto.randomUUID()}`;

/**
 * Comments on a public track (0518). `initial` is the anonymous first page of
 * approved comments from the public route; it is absent when the feature is off,
 * and then nothing renders. Every new comment waits for an administrator. Text
 * is rendered as text, never HTML.
 */
export function MusicTrackComments({ slug, initial }) {
  const { t } = useI18n();
  const signedIn = Boolean(getStoredUserId());
  const [data, setData] = useState(initial || null);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const attempt = useRef(null);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try { const r = await gatewayFetch(`/music/comments?slug=${encodeURIComponent(slug)}`); if (r?.comments) setData(r.comments); } catch { /* keep the public page */ }
  }, [signedIn, slug]);
  useEffect(() => { if (initial) load(); }, [initial, load]);

  if (!data) return null;

  const fail = (e) => setError(e?.status === 429 ? t('music.comments.slowDown') : e?.status === 409 ? t('music.comments.limit') : t('music.comments.failed'));

  async function submit(event) {
    event.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    const payload = { action: 'submit', slug, body: text, ...(replyTo ? { parent_id: replyTo.id } : {}) };
    const signature = JSON.stringify(payload);
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: newKey('comment') };
    setBusy(true); setError(''); setNotice('');
    try {
      await gatewayFetch('/music/comments', { method: 'POST', body: JSON.stringify({ ...payload, idempotency_key: attempt.current.key }) });
      setBody(''); setReplyTo(null); attempt.current = null; setNotice(t('music.comments.pending'));
      await load();
    } catch (e) { fail(e); } finally { setBusy(false); }
  }

  async function act(payload) {
    setError(''); setNotice('');
    try {
      await gatewayFetch('/music/comments', { method: 'POST', body: JSON.stringify({ ...payload, idempotency_key: newKey(payload.action) }) });
      setNotice(payload.action === 'report' ? t('music.comments.reported') : t('music.comments.withdrawn'));
      await load();
    } catch (e) { fail(e); }
  }

  const top = data.comments.filter((c) => !c.parent_id);
  const replies = (id) => data.comments.filter((c) => c.parent_id === id);

  return (
    <section aria-labelledby="music-comments" className="mt-8">
      <h2 id="music-comments" className="font-vx text-xl font-black">{t('music.comments.title')}</h2>
      {!data.allow_comments ? <p className="mt-2 text-sm text-vx-fg-muted">{t('music.comments.closed')}</p> : signedIn ? (
        <form onSubmit={submit} className="mt-3 space-y-2">
          {replyTo ? <p className="text-sm text-vx-fg-muted">{t('music.comments.replyingTo', { name: replyTo.author })} <button type="button" className="min-h-11 underline" onClick={() => setReplyTo(null)}>{t('music.comments.cancel')}</button></p> : null}
          <label htmlFor="music-comment-body" className="sr-only">{t('music.comments.label')}</label>
          <textarea id="music-comment-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={MUSIC_COMMENT_MAX} rows={3}
            className="w-full rounded-xl border border-vx-border bg-vx-panel p-3 text-vx-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-vx-accent" placeholder={t('music.comments.placeholder')} />
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-vx-fg-faint">{t('music.comments.review')} · {body.length}/{MUSIC_COMMENT_MAX}</span>
            <button type="submit" disabled={busy || !body.trim()} className="min-h-11 rounded-full bg-vx-accent px-5 text-sm font-bold text-vx-accent-ink disabled:opacity-50">{busy ? t('music.comments.sending') : t('music.comments.send')}</button>
          </div>
        </form>
      ) : <p className="mt-2 text-sm text-vx-fg-muted">{t('music.comments.signIn')}</p>}
      {notice ? <p role="status" className="mt-2 text-sm text-vx-fg-muted">{notice}</p> : null}
      {error ? <p role="alert" className="mt-2 text-sm text-vx-danger">{error}</p> : null}
      {data.own_comments?.length ? (
        <ul className="mt-4 space-y-2">
          {data.own_comments.map((c) => (
            <li key={c.id} className="rounded-xl border border-dashed border-vx-border p-3 text-sm">
              <p className="text-xs font-bold text-vx-fg-muted">{t(c.status === 'rejected' ? 'music.comments.rejectedLabel' : 'music.comments.pendingLabel')}</p>
              <p className="mt-1 whitespace-pre-wrap wrap-break-word">{c.body}</p>
              {c.status === 'pending' ? <button type="button" className="mt-1 min-h-11 text-xs underline" onClick={() => act({ action: 'withdraw', comment_id: c.id })}>{t('music.comments.withdraw')}</button> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {top.length === 0 ? <p className="mt-4 text-sm text-vx-fg-muted">{t('music.comments.empty')}</p> : (
        <ul className="mt-4 space-y-4">
          {top.map((c) => (
            <li key={c.id}>
              <Comment c={c} t={t} signedIn={signedIn} onReply={data.allow_comments ? () => setReplyTo(c) : null} onReport={(category, details) => act({ action: 'report', comment_id: c.id, category, details })} />
              {replies(c.id).length ? <ul className="ml-6 mt-2 space-y-2 border-l border-vx-border pl-4">{replies(c.id).map((r) => <li key={r.id}><Comment c={r} t={t} signedIn={signedIn} onReport={(category, details) => act({ action: 'report', comment_id: r.id, category, details })} /></li>)}</ul> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Comment({ c, t, signedIn, onReply, onReport }) {
  const [reporting, setReporting] = useState(false);
  const [category, setCategory] = useState('spam');
  const [details, setDetails] = useState('');
  return (
    <article className="rounded-xl border border-vx-border bg-vx-panel p-3">
      <p className="text-xs text-vx-fg-muted"><span className="font-bold text-vx-fg">{c.author}</span>{c.is_creator ? ` · ${t('music.comments.creator')}` : ''}{c.at_seconds !== null ? ` · ${t('music.comments.at', { time: time(c.at_seconds) })}` : ''}</p>
      <p className="mt-1 whitespace-pre-wrap wrap-break-word">{c.body}</p>
      {signedIn && !c.own ? (
        <div className="mt-1 flex gap-4 text-xs">
          {onReply ? <button type="button" className="min-h-11 underline" onClick={onReply}>{t('music.comments.reply')}</button> : null}
          <button type="button" className="min-h-11 underline" aria-expanded={reporting} onClick={() => setReporting(!reporting)}>{t('music.comments.report')}</button>
        </div>
      ) : null}
      {reporting ? (
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); if (details.trim().length >= 3) { onReport(category, details.trim()); setReporting(false); } }}>
          <label className="block text-xs">{t('music.comments.reportReason')}
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="ml-2 min-h-11 rounded-lg bg-vx-panel-raised p-2">
              {MUSIC_COMMENT_REPORT_CATEGORIES.map((k) => <option key={k} value={k}>{t(`music.comments.category.${k}`)}</option>)}
            </select>
          </label>
          <label className="block text-xs">{t('music.comments.reportDetails')}
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} minLength={3} maxLength={500} rows={2} className="mt-1 w-full rounded-lg bg-vx-panel-raised p-2" />
          </label>
          <button type="submit" className="min-h-11 rounded-full border border-vx-border px-4 text-xs font-bold">{t('music.comments.sendReport')}</button>
        </form>
      ) : null}
    </article>
  );
}
