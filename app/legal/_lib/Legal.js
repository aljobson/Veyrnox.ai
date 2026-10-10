import Link from 'next/link';
import VeyrnoxLayout from '../../veyrnox/layout';
import { Logo } from '../../veyrnox/_components/Logo';
import { Main } from '../../veyrnox/_components/Main';

export const ENTITY = {
    name: 'Veyrnox Ltd',
    trading: 'Veyrnox.ai',
    companyNo: '17299951',
    jurisdiction: 'England & Wales',
    office: 'Suite RA01, 195-197 Wood Street, London, England, E17 3NU',
    email: 'legal@veyrnox.com',
    privacyEmail: 'privacy@veyrnox.com',
};

// Legal pages live outside app/veyrnox, so they borrow its layout for the
// brand type and tokens. A reading page: one 68ch column, nothing competing.
export function LegalPage({ title, updated, children }) {
    return (
        <VeyrnoxLayout>
            <div className="max-w-[1300px] mx-auto px-4 sm:px-6 pt-8 pb-24">
                <header>
                    <Link href="/" aria-label="Veyrnox.ai home" className="inline-flex">
                        <Logo size={26} wordmark />
                    </Link>
                </header>
                <Main className="max-w-[68ch] mt-16 sm:mt-20">
                    <h1 className="vx-display vx-title-detail">{title}</h1>
                    <p className="mt-5 text-[14px] text-vx-fg-muted leading-[1.6]">
                        {ENTITY.name}, trading as {ENTITY.trading}. Company no. {ENTITY.companyNo}. Last updated {updated}.
                    </p>
                    <div className="mt-12 border-t-2 border-vx-fg pt-4 space-y-5 text-[16px] leading-[1.7] text-vx-fg-body [&_h2]:font-vx [&_h2]:font-black [&_h2]:tracking-[-0.01em] [&_h2]:text-[22px] [&_h2]:leading-tight [&_h2]:text-vx-fg [&_h2]:mt-12 [&_h2]:mb-1 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_a]:text-vx-fg [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-4 [&_a:hover]:text-vx-accent [&_strong]:text-vx-fg">
                        {children}
                    </div>
                </Main>
                <nav aria-label="Legal" className="mt-20 pt-6 border-t border-vx-border text-[14px] text-vx-fg-muted flex flex-wrap gap-x-6 gap-y-2">
                    <Link href="/legal/terms" className="hover:text-vx-fg">Terms</Link>
                    <Link href="/legal/privacy" className="hover:text-vx-fg">Privacy</Link>
                    <Link href="/legal/refund" className="hover:text-vx-fg">Refunds</Link>
                    <Link href="/legal/aup" className="hover:text-vx-fg">Acceptable Use</Link>
                    <Link href="/legal/gdpr" className="hover:text-vx-fg">GDPR &amp; Data Rights</Link>
                </nav>
            </div>
        </VeyrnoxLayout>
    );
}
