'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../components/I18nProvider';
import { readJobHistory, JOBS_CHANGED_EVENT } from '../_lib/jobHistory';
import { barRows } from '../_lib/generationProgress';

// One bar for every generation on every Veyrnox page. It reads the same job
// history JobWatcher and the studio write, so image, video, audio, chat and
// template jobs all show up without each page wiring its own. The percentage
// is an estimate (see generationProgress.mjs): providers only say whether a
// job is running, not how far along it is.
const TICK_MS = 1000;
const FINISH_HOLD_MS = 1400;
const MAX_ROWS = 3;
// Top of the screen and never interactive: the bottom edge holds Create's sticky
// cost card and Generate button, and a status line must not catch their taps.

// Rows to show: running jobs plus any that just succeeded and hold at 100%.
function useBarRows() {
  const [rows, setRows] = useState([]);
  const [finished, setFinished] = useState([]);
  const seen = useRef(new Map());

  useEffect(() => {
    let timer = null;
    const holds = new Set();

    function refresh() {
      const history = readJobHistory();
      const next = barRows(history);
      const nextIds = new Set(next.map((r) => r.job_id));
      // A job that left the list and settled as succeeded gets a full bar for
      // a moment. One that failed just goes: the toast says what happened.
      const done = [];
      for (const [id, row] of seen.current) {
        if (nextIds.has(id)) continue;
        seen.current.delete(id);
        if (history.find((h) => h.job_id === id)?.settled === 'succeeded') done.push({ ...row, percent: 100 });
      }
      for (const row of next) seen.current.set(row.job_id, row);
      setRows(next);
      if (done.length) {
        setFinished((prev) => [...prev, ...done]);
        const hold = setTimeout(() => {
          holds.delete(hold);
          setFinished((prev) => prev.filter((r) => !done.some((d) => d.job_id === r.job_id)));
        }, FINISH_HOLD_MS);
        holds.add(hold);
      }
    }

    refresh();
    timer = setInterval(refresh, TICK_MS);
    window.addEventListener(JOBS_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      clearInterval(timer);
      holds.forEach(clearTimeout);
      window.removeEventListener(JOBS_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return [...rows, ...finished.filter((f) => !rows.some((r) => r.job_id === f.job_id))];
}

function BarRow({ row }) {
  const { t } = useI18n();
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-xs text-vx-fg-body">
        <span className="truncate">{row.label || t('public.jobs.default')}</span>
        <span className="font-vx-mono tabular-nums text-vx-fg">{row.percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={row.percent}
        aria-label={t('public.jobs.progress.aria', { percent: row.percent })}
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-vx-border"
      >
        <div
          className="h-full rounded-full bg-vx-accent transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${row.percent}%` }}
        />
      </div>
    </li>
  );
}

export function GenerationStatusBar() {
  const { t } = useI18n();
  const shown = useBarRows();
  if (!shown.length) return null;
  const visible = shown.slice(0, MAX_ROWS);
  const hidden = shown.length - visible.length;

  return (
    <div className="pointer-events-none fixed inset-x-4 top-16 z-40 mx-auto max-w-md">
      <div className="rounded-2xl border border-vx-border bg-vx-panel px-4 py-3 shadow-lg">
        <p role="status" className="font-vx-mono text-[10px] tracking-[0.14em] text-vx-accent">
          {t('public.jobs.progress.title').toUpperCase()} · {t('public.jobs.progress.patient')}
        </p>
        <ul className="mt-2 space-y-2">
          {visible.map((row) => <BarRow key={row.job_id} row={row} />)}
        </ul>
        {hidden > 0 && <p className="mt-2 text-xs text-vx-fg-muted">{t('public.jobs.progress.more', { count: hidden })}</p>}
      </div>
    </div>
  );
}
