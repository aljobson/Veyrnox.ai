'use client';
import Link from 'next/link';
import { pluralKey } from '../../../lib/i18n/translate.mjs';
import { useI18n } from '../../../components/I18nProvider';
import { useYourWins, nextMilestone } from '../_lib/yourWins';
import { VeyCardPeek } from './VeyCardPeek';
import { YourWinsCelebration } from './YourWinsCelebration';
export function YourWinsCard({ linkOnly = false }) {
    const { t, locale } = useI18n();
    const { owner, data, celebrationData } = useYourWins();
    if (!data) return null;
    if (linkOnly) return <Link href="/app/account/wins" className="flex min-h-11 items-center rounded-2xl border border-vx-border bg-vx-panel p-5 font-bold">{t('wins.title')} <span aria-hidden="true" className="ms-auto">→</span></Link>;
    const nf = new Intl.NumberFormat(locale);
    const next = nextMilestone(data);
    const stats = [[data.all.creations.total, 'creations'], [data.all.posts, 'posts'], ...(data.streak ? [[data.streak.current, 'streak']] : [])];
    const label = [t('wins.title'), ...stats.map(([n, key]) => `${t(`wins.${key}`)}: ${key === 'streak' ? t(pluralKey(t, locale, 'wins.days', n), { count: nf.format(n) }) : nf.format(n)}`), next && t('wins.next', { milestone: t(`wins.${next.key}`), progress: nf.format(next.progress), target: nf.format(next.target) })].filter(Boolean).join('. ');
    return <>
        <Link href="/app/account/wins" aria-label={label} className="relative mb-8 mt-24 block rounded-[20px] border border-vx-border bg-vx-panel p-5 hover:border-vx-accent">
            <VeyCardPeek />
            <h2 className="text-xl font-bold">{t('wins.title')}</h2>
            <div className="my-5 flex flex-wrap gap-8">{stats.map(([n, label]) => <div key={label}><p className="text-3xl font-bold tabular-nums">{nf.format(n)}</p><p className="text-sm text-vx-fg-body">{t(`wins.${label}`)}</p></div>)}</div>
            {next && <><p className="text-sm">{t('wins.next', { milestone: t(`wins.${next.key}`), progress: nf.format(next.progress), target: nf.format(next.target) })}</p><progress aria-label={t(`wins.${next.key}`)} className="mt-2 h-2 w-full accent-vx-accent" max={next.target} value={next.progress} /></>}
        </Link>
        <YourWinsCelebration owner={owner} data={celebrationData} />
    </>;
}
