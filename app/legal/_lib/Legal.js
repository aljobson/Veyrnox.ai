import Link from 'next/link';
import VeyrnoxLayout from '../../veyrnox/layout';
import { Logo } from '../../veyrnox/_components/Logo';
import { Main } from '../../veyrnox/_components/Main';
import { ENTITY } from './entity';
import { localizedHref, localeInfo } from '../../../lib/i18n/locales.mjs';
import { rich } from '../../../lib/i18n/rich';

export { ENTITY } from './entity';

// Legal pages live outside app/veyrnox, so they borrow its layout for the
// brand type and tokens. A reading page: one 68ch column, nothing competing.
export function LegalPage({ title, updated, children, locale = 'en', document, c }) {
    const href = (path) => localizedHref(locale, path);
    return (
        <VeyrnoxLayout>
            <div {...(locale === 'en' ? {} : { lang: localeInfo(locale).hreflang, dir: localeInfo(locale).dir })} className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-8 pb-24">
                <header>
                    <Link href={href("/")} aria-label={c('home')} className="inline-flex">
                        <Logo size={26} wordmark />
                    </Link>
                </header>
                <Main className="max-w-[68ch] mt-16 sm:mt-20">
                    <h1 className="vx-display vx-title-detail">{title}</h1>
                    <p className="mt-5 text-[14px] text-vx-fg-muted leading-[1.6]">
                        {rich(c('company'), locale === 'en' ? { ...ENTITY, updated } : { ...ENTITY, companyNo: <bdi dir="ltr">{ENTITY.companyNo}</bdi>, updated: <bdi dir="ltr">{updated}</bdi> })}
                    </p>
                    {locale !== 'en' && <aside lang={localeInfo(locale).hreflang} dir={localeInfo(locale).dir} className="mt-6 border-s-4 border-vx-accent ps-4 text-sm" data-legal-translation={document}>
                        <h2 className="font-semibold">{c('translation')}</h2>
                        <p>{c('notice')}</p>
                        <a href={`/legal/${document}`} hrefLang="en" className="underline">{c('english')}</a>
                    </aside>}
                    <div className={(locale === 'en' ? "mt-12 border-t-2 border-vx-fg pt-4 space-y-5 text-[16px] leading-[1.7] text-vx-fg-body [&_h2]:font-vx [&_h2]:font-black [&_h2]:tracking-[-0.01em] [&_h2]:text-[22px] [&_h2]:leading-tight [&_h2]:text-vx-fg [&_h2]:mt-12 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_a]:text-vx-fg [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-vx-accent [&_strong]:text-vx-fg" : "mt-12 border-t-2 border-vx-fg pt-4 space-y-5 text-[16px] leading-[1.7] text-vx-fg-body [&_h2]:font-vx [&_h2]:font-black [&_h2]:tracking-[-0.01em] [&_h2]:text-[22px] [&_h2]:leading-tight [&_h2]:text-vx-fg [&_h2]:mt-12 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:ps-6 [&_ul]:space-y-2 [&_a]:text-vx-fg [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-vx-accent [&_strong]:text-vx-fg")}>
                        {children}
                    </div>
                </Main>
                <nav aria-label={c('nav')} className="mt-20 pt-6 border-t border-vx-border text-[14px] text-vx-fg-muted flex flex-wrap gap-x-6 gap-y-2">
                    <Link href={href("/legal/terms")} className="hover:text-vx-fg">{c('terms')}</Link>
                    <Link href={href("/legal/privacy")} className="hover:text-vx-fg">{c('privacy')}</Link>
                    <Link href={href("/legal/refund")} className="hover:text-vx-fg">{c('refund')}</Link>
                    <Link href={href("/legal/aup")} className="hover:text-vx-fg">{c('aup')}</Link>
                    <Link href={href("/legal/cinema-content")} className="hover:text-vx-fg">{c('cinema-content')}</Link>
                    <Link href={href("/legal/gdpr")} className="hover:text-vx-fg">{c('gdpr')}</Link>
                </nav>
            </div>
        </VeyrnoxLayout>
    );
}
