'use client';
import { localeTag } from '../../../../../lib/i18n/locales.mjs';
import { tOr } from '../../../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../../../components/I18nProvider';

import { useEffect, useState } from 'react';
import { NETWORKS } from '../../../../lib/socialConnectClient';
import { getSocialInboxAnalytics } from '../../../../lib/socialInboxClient';
import NetworkLogo from '../NetworkLogo';

const input = 'rounded-lg border border-vx-border bg-vx-panel px-3 py-2 text-sm focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-vx-accent';
const label = (network) => NETWORKS.find((item) => item.key === network)?.label || network;

export default function InboxAnalytics({ accountId, loadAnalytics = getSocialInboxAnalytics }) {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(localeTag(locale), { useGrouping: false });
  const dateLabel = value => locale === 'en' ? value : new Intl.DateTimeFormat(localeTag(locale), { timeZone: 'UTC' }).format(new Date(value));
  const [days, setDays] = useState(30), [data, setData] = useState(null), [error, setError] = useState('');
  useEffect(() => { let active = true; loadAnalytics({ accountId: accountId || undefined, days }).then((result) => { if (active) { setData(result); setError(''); } }).catch(() => { if (active) { setData(null); setError(t("app.publish.inboxAnalytics.failed")); } }); return () => { active = false; }; }, [accountId, days, loadAnalytics, t]);
  const summary = data?.summary || {}, trend = data?.trend || [], platforms = data?.platforms || [], heatmap = data?.heatmap || [];
  const maximum = Math.max(1, ...trend.map((item) => Number(item.received || 0) + Number(item.sent || 0)));
  const arrival = new Map(heatmap.map((item) => [`${item.weekday}:${item.hour}`, Number(item.received || 0)]));
  const hottest = Math.max(1, ...arrival.values());
  const response = summary.median_response_seconds == null ? '—' : summary.median_response_seconds < 60 ? t('app.publish.inboxAnalytics.seconds', { count: number.format(summary.median_response_seconds) }) : t('app.publish.inboxAnalytics.minutes', { count: number.format(Math.round(summary.median_response_seconds / 60)) });
  return <section aria-label={t("app.publish.inboxAnalytics.title")} className="min-w-0 max-w-full space-y-4 rounded-2xl border border-vx-border p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-black">{t("app.publish.inboxAnalytics.title")}</h2><p className="mt-1 text-sm text-vx-fg-muted">{t("app.publish.inboxAnalytics.intro")}</p></div><label className="text-xs font-bold text-vx-fg-muted">{t("app.publish.reports.period")}<select className={`${input} ms-2`} value={days} onChange={(event) => setDays(Number(event.target.value))}><option value={7}>{t("app.publish.analytics.period7")}</option><option value={30}>{t("app.publish.analytics.period30")}</option><option value={90}>{t("app.publish.analytics.period90")}</option></select></label></div>
    {error && <p role="alert" className="text-sm text-vx-danger">{error}</p>}
    {!data && !error ? <p className="text-sm text-vx-fg-muted">{t("app.publish.inboxAnalytics.loading")}</p> : data && <>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[[t("app.publish.inbox.conversations"),summary.conversations||0],[t("app.publish.inboxAnalytics.received"),summary.received||0],[t("app.publish.inboxAnalytics.sent"),summary.sent||0],[t('app.publish.inboxAnalytics.failure'),summary.failed||0],[t("app.publish.inboxAnalytics.markedRead"),summary.read_actions||0],[t("app.publish.inboxAnalytics.median"),response]].map(([name,value], index)=><div key={index} className="rounded-xl bg-vx-panel p-3"><p className="text-xs text-vx-fg-muted">{name}</p><p className="mt-1 text-xl font-black">{typeof value === 'number' ? number.format(value) : value}</p></div>)}</div>
      <div className="min-w-0"><h3 className="text-sm font-black">{t("app.publish.inboxAnalytics.daily")}</h3><div className="mt-3 min-w-0 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={t("app.publish.inboxAnalytics.dailyRegion")}><div className="flex h-28 w-max min-w-full items-end gap-1">{trend.map((item)=>{const received=Number(item.received||0),sent=Number(item.sent||0);return <div key={item.date} className="flex w-3 shrink-0 flex-col justify-end" title={t('app.publish.inboxAnalytics.dailyLabel', { date: dateLabel(item.date), received: number.format(received), sent: number.format(sent) })}><div className="bg-vx-accent" style={{height:`${Math.max(received?2:0,received/maximum*88)}px`}}/><div className="bg-vx-fg-muted" style={{height:`${Math.max(sent?2:0,sent/maximum*88)}px`}}/></div>;})}</div></div><p className="mt-2 text-xs text-vx-fg-muted"><span className="text-vx-accent">■</span> {t('app.publish.inboxAnalytics.received')} · <span>■</span>{' '}{t("app.publish.inboxAnalytics.sent")}</p></div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2"><div className="min-w-0"><h3 className="text-sm font-black">{t("app.publish.inboxAnalytics.platforms")}</h3>{platforms.length?<ul className="mt-2 space-y-2">{platforms.map((item)=><li key={item.network} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-vx-panel px-3 py-2 text-sm"><span className="flex items-center gap-2"><NetworkLogo network={item.network}/>{tOr(t, `app.publish.network.${item.network}`, label(item.network))}</span><span>{t('app.publish.inboxAnalytics.receivedCount', { count: number.format(item.received) })} · {t('app.publish.inboxAnalytics.sentCount', { count: number.format(item.sent) })}{item.failed?t('app.publish.inboxAnalytics.failedCount', { count: number.format(item.failed) }):''}</span></li>)}</ul>:<p className="mt-2 text-sm text-vx-fg-muted">{t("app.publish.inboxAnalytics.empty")}</p>}</div>
        <details className="min-w-0"><summary className="cursor-pointer text-sm font-black">{t("app.publish.inboxAnalytics.heatmap")}</summary><div className="mt-3 min-w-0 max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={t("app.publish.inboxAnalytics.heatRegion")}><div className="grid min-w-[576px] grid-cols-24 gap-1">{Array.from({length:168},(_,index)=>{const weekday=Math.floor(index/24)+1,hour=index%24,count=arrival.get(`${weekday}:${hour}`)||0;return <span key={index} title={t('app.publish.inboxAnalytics.heatLabel', { day: number.format(weekday), hour: number.format(hour), count: number.format(count) })} className="h-4 rounded-sm bg-vx-accent" style={{opacity:count?0.2+0.8*count/hottest:0.05}}/>;})}</div></div></details></div>
    </>}
  </section>;
}
