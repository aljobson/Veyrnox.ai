'use client';
import { useState } from 'react';
import { useI18n } from '../../../../../components/I18nProvider';
import { pluralKey } from '../../../../../lib/i18n/translate.mjs';
import { AppNav } from '../../../_components/NavBar';
import { Main } from '../../../_components/Main';
import { YourWinsCelebration } from '../../../_components/YourWinsCelebration';
import { useYourWins } from '../../../_lib/yourWins';
const colours = { image: 'bg-vx-accent', video: 'bg-vx-fg-body', audio: 'bg-vx-warn', other: 'bg-vx-fg-faint' };
export default function YourWins() {
    const { t, locale } = useI18n();
    const { owner, data, loading, celebrationData } = useYourWins();
    const [range, setRange] = useState('week');
    const nf = new Intl.NumberFormat(locale);
    const days = count => t(pluralKey(t, locale, 'wins.days', count), { count: nf.format(count) });
    const value = data?.[range];
    return <><AppNav /><Main className="mx-auto max-w-[900px] space-y-8 px-4 py-10 sm:px-8">
        <h1 className="text-3xl font-black">{t('wins.title')}</h1>
        {!value ? <p className="text-vx-fg-muted">{t(loading ? 'wins.loading' : 'wins.unavailable')}</p> : <>
            <div role="group" aria-label={t('wins.title')} className="flex gap-2">{Object.entries({ week: t('wins.week'), all: t('wins.all') }).map(([key, label]) => <button key={key} type="button" aria-pressed={range === key} onClick={() => setRange(key)} className={`min-h-11 rounded-full border px-5 ${range === key ? 'border-vx-accent bg-vx-accent/10' : 'border-vx-border'}`}>{label}</button>)}</div>
            <section className="rounded-2xl border border-vx-border bg-vx-panel p-6">
                <h2 className="text-sm text-vx-fg-body">{t('wins.creations')}</h2><p className="my-3 text-6xl font-bold tabular-nums">{nf.format(value.creations.total)}</p>
                <div aria-hidden="true" className="my-4 flex h-3 overflow-hidden rounded-full bg-vx-border">{Object.entries(value.creations.by_type).map(([key, n]) => n > 0 && <span key={key} className={colours[key]} style={{ width: `${n / value.creations.total * 100}%` }} />)}</div>
                <ul className="flex flex-wrap gap-4 text-sm">{Object.entries(value.creations.by_type).map(([key, n]) => (key !== 'other' || n > 0) && <li key={key} className="flex items-center gap-2"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${colours[key]}`} />{t(`wins.${key === 'video' ? 'videoType' : key}`)} <span className="tabular-nums">{nf.format(n)}</span></li>)}</ul>
            </section>
            <section><h2 className="mb-4 text-xl font-bold">{t('wins.what')}</h2><dl className="space-y-4">
                {[[t('wins.video'), t('wins.duration', { minutes: nf.format(Math.floor(value.video_seconds / 60)), seconds: nf.format(value.video_seconds % 60) })], [t('wins.credits'), nf.format(value.credits_used)], [t('wins.posts'), nf.format(value.posts)], ...(value.views ? [[t('wins.views'), nf.format(value.views.total)]] : [])].map(([label, n]) => <div key={label} className="flex justify-between gap-4 border-b border-vx-border pb-3"><dt>{label}</dt><dd className="tabular-nums">{n}</dd></div>)}
            </dl>{value.views && <p className="mt-2 text-sm text-vx-fg-muted">{t('wins.reported', { networks: value.views.networks.join(', ') })}</p>}</section>
            {data.streak && <section><h2 className="text-xl font-bold">{t('wins.streak')}</h2><p className="my-3 tabular-nums">{t('wins.current')}: {days(data.streak.current)} · {t('wins.best')}: {days(data.streak.best)}</p><div className="flex gap-2">{data.streak.last7.map((filled, i) => {
                const date = new Date(); date.setUTCDate(date.getUTCDate() - 6 + i);
                const label = `${new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date)}: ${t(filled ? 'wins.checked' : 'wins.empty')}`;
                return <span key={i} role="img" aria-label={label} title={label} className={`h-8 w-8 rounded-md border border-vx-border ${filled ? 'bg-vx-accent' : 'bg-vx-panel'}`} />;
            })}</div></section>}
            <section><h2 className="mb-4 text-xl font-bold">{t('wins.milestones')}</h2><ul className="grid gap-3 sm:grid-cols-2">{data.milestones.map(m => <li key={m.key} className="rounded-2xl border border-vx-border bg-vx-panel p-4"><h3 className="font-bold">{t(`wins.${m.key}`)}</h3><p className="mt-2 text-sm tabular-nums text-vx-fg-body">{m.reached_at ? t('wins.reached', { date: new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(m.reached_at)) }) : t('wins.locked', { progress: nf.format(m.progress), target: nf.format(m.target) })}</p></li>)}</ul></section>
            <p className="text-sm text-vx-fg-muted">{t('wins.footer')}</p>
            <YourWinsCelebration owner={owner} data={celebrationData} />
        </>}
    </Main></>;
}
