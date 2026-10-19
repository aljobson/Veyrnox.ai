'use client';
import { useI18n } from '../../../../../components/I18nProvider';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { useEffect, useState } from 'react';
import { getSocialPostingInsights } from '../../../../lib/socialAnalyticsClient';
import { summarizePostingInsights, MIN_SLOT_POSTS, MIN_MEASURED_POSTS, MIN_HISTORY_DAYS } from '../../../../../lib/social/postingInsights.js';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
function labels(locale) {
  const number = new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 1 });
  const integer = value => locale === 'en' ? String(value) : Number(value).toLocaleString(localeTag(locale));
  const day = index => locale === 'en' ? DAYS[index] : new Intl.DateTimeFormat(localeTag(locale), { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2024, 0, 1 + index)));
  const hour = value => locale === 'en' ? String(value).padStart(2, '0') : new Intl.NumberFormat(localeTag(locale), { minimumIntegerDigits: 2 }).format(value);
  return { number, integer, day, hour, hourLabel: value => `${hour(value)}:${hour(0)}` };
}
const tones = ['bg-vx-accent/10', 'bg-vx-accent/20', 'bg-vx-accent/30', 'bg-vx-accent/40'];

export function PostingInsights({ accountId }) {
  const { t, locale } = useI18n();
  const { number, integer, day, hourLabel } = labels(locale);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        let active = true;
        getSocialPostingInsights(accountId).then((data) => { if (active) setResult(data); })
            .catch(() => { if (active) setError(true); });
        return () => { active = false; };
    }, [accountId, attempt]);
    if (error) return <section className="rounded-2xl border border-vx-border p-5">
        <h2 className="font-bold mb-2">{t("app.publish.insights.title")}</h2>
        <p role="alert" className="text-sm text-vx-danger mb-3">{t("app.publish.insights.failed")}</p>
        <button type="button" className="rounded-full border border-vx-border px-4 py-2 text-sm font-bold"
            onClick={() => { setError(false); setAttempt((n) => n + 1); }}>{t("recovery.retry")}</button>
    </section>;
    if (!result) return <p role="status" className="text-sm text-vx-fg-muted">{t("app.publish.insights.loading")}</p>;
    const data = result.insights;
    if (!data) return <section className="rounded-2xl border border-vx-border p-5">
        <h2 className="font-bold mb-2">{t("app.publish.insights.title")}</h2>
        <p className="text-sm text-vx-fg-body">{t("app.publish.insights.empty")}</p>
    </section>;
    const summary = summarizePostingInsights(data);
    const start = new Date(`${data.period_start}T12:00:00Z`).toLocaleDateString(localeTag(locale));
    const end = new Date(`${data.period_end}T12:00:00Z`).toLocaleDateString(localeTag(locale));
    return <div className="space-y-6">
        <section className="rounded-2xl border border-vx-border p-5 space-y-4" aria-labelledby="best-time-heading">
            <div>
                <h2 id="best-time-heading" className="font-bold">{t("app.publish.insights.bestTime")}</h2>
                <p className="text-xs text-vx-fg-muted mt-1">{t('app.publish.insights.period', { timezone: data.timezone, start, end })}</p>
            </div>
            {summary.topSlots.length ? <>
                <p className="text-sm text-vx-fg-body">{t('app.publish.insights.strongest', { slots: summary.topSlots.map(slot => t(pluralKey(t, locale, 'app.publish.insights.slot', slot.posts), { day: day(slot.day - 1), hour: hourLabel(slot.hour), score: number.format(slot.score), count: integer(slot.posts) })).join('; ') })}</p>
                <Heatmap summary={summary} />
                <p className="text-xs text-vx-fg-muted">{t('app.publish.insights.heatHelp', { minimum: integer(MIN_SLOT_POSTS), timezone: data.timezone })}</p>
            </> : <p className="text-sm text-vx-fg-body">{t('app.publish.insights.notEnough', { posts: integer(MIN_MEASURED_POSTS), days: integer(MIN_HISTORY_DAYS), slots: integer(MIN_SLOT_POSTS) })}</p>}
            <p className="text-xs text-vx-fg-muted">{t('app.publish.insights.measurement', { measured: integer(data.measured_posts), recorded: integer(data.recorded_posts) })}</p>
        </section>
        <section className="rounded-2xl border border-vx-border p-5 space-y-4" aria-labelledby="frequency-heading">
            <h2 id="frequency-heading" className="font-bold">{t("app.publish.insights.frequency")}</h2>
            <p className="text-sm text-vx-fg-body">{t("app.publish.insights.compareHelp")}</p>
            <div className="relative overflow-x-auto rounded-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent" tabIndex={0} role="region" aria-label={t("app.publish.insights.comparison")}>
                <table className="w-full text-sm">
                    <caption className="sr-only">{t("app.publish.insights.caption")}</caption>
                    <thead><tr className="text-start text-xs text-vx-fg-muted">
                        <th scope="col" className="pb-2 pe-3">{t("app.publish.insights.postsPerWeek")}</th>
                        <th scope="col" className="pb-2 pe-3">{t("app.publish.insights.weeks")}</th>
                        <th scope="col" className="pb-2 pe-3">{t("app.publish.insights.measured")}</th>
                        <th scope="col" className="pb-2 text-end">{t("app.publish.insights.average")}</th>
                    </tr></thead>
                    <tbody>{summary.frequency.map((group) => <tr key={group.postsPerWeek} className="border-t border-vx-border tabular-nums">
                        <th scope="row" className="py-2 pe-3 text-start">{integer(group.postsPerWeek)}</th>
                        <td className="py-2 pe-3">{integer(group.weeks)}</td>
                        <td className="py-2 pe-3">{integer(group.measuredPosts)}</td>
                        <td className="py-2 text-end">{group.score === null ? '—' : number.format(group.score)}</td>
                    </tr>)}</tbody>
                </table>
            </div>
            <p className="text-xs text-vx-fg-muted">{t('app.publish.insights.coverage', { date: new Date(data.computed_at).toLocaleString(localeTag(locale)) })}</p>
        </section>
    </div>;
}

function Heatmap({ summary }) {
    const { t, locale } = useI18n();
    const { number, integer, day: dayLabel, hour: hourNumber, hourLabel } = labels(locale);
    return <div className="relative overflow-x-auto rounded-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent" tabIndex={0} role="region" aria-label={t("app.publish.insights.heatmap")}>
        <table className="w-full min-w-[680px] border-separate border-spacing-1 text-xs tabular-nums">
            <caption className="sr-only">{t("app.publish.insights.heatCaption")}</caption>
            <thead><tr><th scope="col"><span className="sr-only">{t('app.publish.insights.day')}</span></th>{HOURS.map((hour) =>
                <th scope="col" key={hour} className="font-normal text-vx-fg-muted">{hourNumber(hour)}</th>)}</tr></thead>
            <tbody>{DAYS.map((day, i) => <tr key={day}><th scope="row" className="pe-2 text-start font-bold">{dayLabel(i)}</th>
                {HOURS.map((hour) => {
                    const cell = summary.cells.find((c) => c.day === i + 1 && c.hour === hour);
                    const measured = cell?.posts >= MIN_SLOT_POSTS && Number.isFinite(cell.score);
                    const label = measured ? t(pluralKey(t, locale, 'app.publish.insights.cell', cell.posts), { score: number.format(cell.score), count: integer(cell.posts) }) : t(pluralKey(t, locale, 'app.publish.insights.insufficient', cell?.posts || 0), { count: integer(cell?.posts || 0) });
                    const tone = measured ? tones[Math.min(3, Math.floor(cell.score / summary.maxScore * 3))] : 'bg-vx-panel';
                    return <td key={hour} className={`${tone} rounded-sm px-1 py-2 text-center`} title={`${dayLabel(i)} ${hourLabel(hour)}: ${label}`}>
                        <span aria-hidden="true">{measured ? number.format(cell.score) : '—'}</span>
                        <span className="sr-only">{label}</span>
                    </td>;
                })}</tr>)}</tbody>
        </table>
    </div>;
}
