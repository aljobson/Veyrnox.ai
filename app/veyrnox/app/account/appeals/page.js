'use client';
import LegalLink from '../../../../../components/LegalLink';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

/**
 * What was recorded against this account, and the way to contest it
 * (ADR-0083). Reads /api/v1/appeals: warnings, removals and a content
 * freeze, each with its appeal state; the operator's reason is never sent.
 * One appeal per action; the outcome arrives by email.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { AccountBoundary } from '../../../_components/AccountBoundary';
import { Button } from '../../../_components/Button';
import { Chip } from '../../../_components/Chip';
import { gatewayFetch } from '../../../_lib/gateway';


export default function Page() {
  return <><AppNav /><Main className="max-w-[900px] mx-auto px-4 sm:px-8 py-10"><AccountBoundary><Appeals /></AccountBoundary></Main></>;
}

function Appeals() {
  const { t, locale } = useI18n();
  const when = iso => iso ? new Date(iso).toLocaleString(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const load = useCallback(async () => {
    const version = ++generation.current;
    try {
      const d = await gatewayFetch('/appeals');
      if (version === generation.current) setData(d);
    } catch (e) {
      if (version === generation.current) setError(e.code === 'no_token' || e.code === 'unauthenticated' ? t("app.account.appeals.signIn") : t("app.account.appeals.unavailable"));
    }
  }, [t]);

  // A request counter, not a DOM node: the cleanup must bump the live value.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);

  return (
    <>
      <Link href="/app/account" className="text-sm underline">{t("app.account.appeals.back")}</Link>
      <h1 className="text-3xl font-black mt-4 mb-2">{t("app.account.appeals")}</h1>
      <p className="text-vx-fg-body mb-6 max-w-[640px]">{t("app.account.appeals.introBefore")}<LegalLink element="a" href="/legal/aup" className="underline">{t("app.account.appeals.policy")}</LegalLink>{t("app.account.appeals.introAfter")}</p>
      {data?.hold_until && (
        <p role="status" className="mb-6 rounded-lg border border-vx-border bg-vx-panel p-4 text-sm">
          {t('app.account.appeals.hold', { date: when(data.hold_until) })}
        </p>
      )}
      {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
      {data && data.sanctions.length === 0 && <p className="text-sm text-vx-fg-muted">{t("app.account.appeals.empty")}</p>}
      <div className="space-y-4">
        {(data?.sanctions || []).map((s) => <Sanction key={s.action_id} sanction={s} onDone={load} />)}
      </div>
    </>
  );
}

function Sanction({ sanction: s, onDone }) {
  const { t, locale } = useI18n();
  const when = iso => iso ? new Date(iso).toLocaleString(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const [open, setOpen] = useState(false);
  const [statement, setStatement] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid = statement.trim().length >= 10 && statement.length <= 2000;

  async function submit(event) {
    event.preventDefault();
    if (!valid) return;
    setBusy(true); setError('');
    try {
      await gatewayFetch('/appeals', { method: 'POST', body: JSON.stringify({ action_id: s.action_id, statement: statement.trim() }) });
      setOpen(false); setStatement('');
      onDone();
    } catch (e) {
      setError(e.code === 'statement_invalid' ? t("app.account.appeals.length") : e.status === 429 ? t("cinema.creatorApplication.tooManyRequestsWaitAMinute") : t("app.account.appeals.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-vx-border p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">{tOr(t, `app.account.appeals.action.${s.action}`, s.action)}</h2>
          <div className="text-xs text-vx-fg-muted mt-1">{when(s.created_at)}{s.model_id ? ` · ${s.model_id}` : ''}{s.hold_until && new Date(s.hold_until) > new Date() ? t('app.account.appeals.pausedUntil', { date: when(s.hold_until) }) : ''}</div>
        </div>
        {s.appeal_status === 'open' && <Chip tone="neutral" noGlyph><span data-testid="appeal-under-review">{t("app.account.appeals.open")}</span></Chip>}
        {s.appeal_status === 'upheld' && <Chip tone="accent" noGlyph>{t("app.account.appeals.upheld")}</Chip>}
        {s.appeal_status === 'rejected' && <Chip tone="warn" noGlyph>{t("app.account.appeals.rejected")}</Chip>}
      </div>
      {!s.appeal_status && !open && <Button data-testid="open-appeal" className="mt-4" size="sm" variant="ghost" onClick={() => setOpen(true)}>{t("app.account.appeals.appeal")}</Button>}
      {open && (
        <form onSubmit={submit} className="mt-4 space-y-3" aria-label={t("app.account.appeals.appeal")}>
          <label className="block text-sm">{t("app.account.appeals.reason")}<textarea data-testid="appeal-statement" value={statement} onChange={(e) => setStatement(e.target.value)} required minLength={10} maxLength={2000} rows={4}
              className="mt-2 w-full rounded-lg border border-vx-border bg-vx-panel p-3 text-sm" />
          </label>
          <p className="text-xs text-vx-fg-muted">{t("app.account.appeals.once")}</p>
          {error && <p role="alert" className="text-vx-danger text-sm">{error}</p>}
          <div className="flex gap-2">
            <Button data-testid="send-appeal" type="submit" size="sm" disabled={busy || !valid}>{busy ? t("app.publish.inbox.sending") : t("app.account.appeals.send")}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{t("cinema.creatorWorkspace.cancel")}</Button>
          </div>
        </form>
      )}
    </section>
  );
}
