'use client';
import { useI18n } from '../../../components/I18nProvider';
import { localeTag } from '../../../lib/i18n/locales.mjs';
import { tOr } from '../../../lib/i18n/translate.mjs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gatewayFetch } from '../_lib/gateway';

export function CreditStatement() {
  const { t, locale } = useI18n();
  const num = new Intl.NumberFormat(localeTag(locale,'en-US'), {signDisplay:'always'});
  const [entries, setEntries] = useState([]);
  const [next, setNext] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async (cursor = null) => {
    const seq = ++sequence.current;
    setBusy(true); setError(false);
    try {
      const query = cursor ? `?${new URLSearchParams(cursor)}` : '';
      const result = await gatewayFetch(`/ledger${query}`);
      if (seq !== sequence.current) return;
      setEntries(previous => cursor
        ? [...previous, ...result.entries.filter(row => !previous.some(p => p.id === row.id))]
        : result.entries);
      setNext(result.next);
    } catch { if (seq === sequence.current) setError(true); }
    finally { if (seq === sequence.current) setBusy(false); }
  }, []);
  useEffect(() => {
    load();
    const refresh = () => load();
    window.addEventListener('veyrnox:balance-changed', refresh);
    // A request counter, not a DOM node: the cleanup must bump the live value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { sequence.current++; window.removeEventListener('veyrnox:balance-changed', refresh); };
  }, [load]);
  return (
    <section className="max-w-[1200px] mx-auto px-4 sm:px-8 pb-10" aria-labelledby="credit-statement-title">
      <h2 id="credit-statement-title" className="text-xl font-black mb-2">{t("label.Credit statement")}</h2>
      <p className="text-sm text-vx-fg-muted mb-4">{t("app.credits.statement.help")}</p>
      {error && <p role="alert" className="text-sm text-vx-danger mb-3">{t("app.credits.statement.failed")}{' '}<button type="button" onClick={() => load()} className="underline">{t("recovery.retry")}</button></p>}
      {!entries.length && !error && <p className="rounded-2xl border border-vx-border bg-vx-panel p-6 text-sm text-vx-fg-muted" role="status">{busy ? t("app.credits.statement.loading") : t("app.credits.statement.empty")}</p>}
      {!!entries.length && <ul className="border-t-2 border-vx-fg max-w-[760px]">
        {entries.map(entry => <li key={entry.id} className="flex items-baseline gap-3 py-3 border-b border-vx-border">
          <div className="min-w-0">
            <div className="text-[15px] font-bold truncate">{tOr(t, `app.credits.statement.${entry.kind}`, t('app.credits.statement.adjustment'))}</div>
            <time dateTime={entry.created_at} className="text-xs text-vx-fg-muted">{new Date(entry.created_at).toLocaleString(localeTag(locale,'en-GB'))}</time>
          </div>
          <span aria-hidden className="vx-leader flex-1 self-start mt-3 text-vx-fg-muted" />
          <span className={`shrink-0 self-start font-vx-mono text-[15px] font-bold vx-num ${entry.delta > 0 ? 'text-vx-accent' : 'text-vx-money'}`}>{num.format(entry.delta)} cr</span>
        </li>)}
      </ul>}
      {next && <button type="button" disabled={busy} onClick={() => load(next)} className="vx-press mt-4 rounded-full border border-vx-border px-5 py-2 text-sm font-bold hover:border-vx-fg-muted disabled:opacity-50">{busy ? t("cinema.titlePage.loading") : t("app.credits.statement.older")}</button>}
    </section>
  );
}
